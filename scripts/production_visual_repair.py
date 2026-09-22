"""Production visual drafts, bound to explicit RE requests and immutable sources."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
import subprocess
import sys
import time
import uuid

import backstage_photos_job  # Load only the signed runtime's bundled Pillow.
from backstage_photos_client import request_preview
from openai_visual_editor import MODEL, configuration, edit_image, image_dimensions
import visual_repair_proposals as visual
from visual_generation_queue import generation_slot

ACTIVE = {"queued", "running"}


@contextmanager
def connect(root: Path):
    """Use the established Owner index without rerunning library-wide backfills."""
    path = root / "assets/owner-actions/Owner.sqlite"
    conn = sqlite3.connect(path.resolve().as_uri() + "?mode=rw", uri=True, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def _row(conn, proposal_id):
    row = conn.execute("SELECT * FROM visual_repair_proposals WHERE proposal_id = ?", (proposal_id,)).fetchone()
    if not row:
        raise ValueError("Visual draft does not exist.")
    return row


def validate_request(conn, fixture_id, asset_id, source_version_id):
    """Revalidate saved intent and the current source before capture and completion."""
    chain = visual._require_re_scope(conn, fixture_id)
    if any(row["archived_at"] for row in chain):
        raise ValueError("Visual repair is unavailable for archived fixtures.")
    visual._review_asset_source(conn, chain, asset_id, source_version_id)
    for fixture in reversed(chain):
        decision = conn.execute("SELECT placement_state,eligibility_state FROM fixture_asset_decisions WHERE fixture_id=? AND asset_id=?",
                                (fixture["fixture_id"], asset_id)).fetchone()
        if decision:
            if decision["placement_state"] != "picked" or decision["eligibility_state"] != "active":
                raise ValueError("The photo is no longer picked in this fixture.")
            break
    else:
        raise ValueError("Visual generation requires an explicit picked decision.")
    if visual._table_exists(conn, "external_edit_asset_locks") and conn.execute(
            "SELECT 1 FROM external_edit_asset_locks WHERE asset_id=?", (asset_id,)).fetchone():
        raise ValueError("Finish this photo's external edit before visual generation.")
    from fixture_editions import enabled as editions_enabled
    if editions_enabled(conn):
        latest = conn.execute("SELECT source_version_id FROM fixture_asset_editions WHERE asset_id=? AND fixture_id=?", (asset_id, fixture_id)).fetchone()
        editorial = conn.execute("SELECT visual_ai_request_json FROM fixture_asset_editions WHERE asset_id=? AND fixture_id=?", (asset_id, fixture_id)).fetchone()
    else:
        latest = conn.execute("SELECT version_id FROM asset_source_versions WHERE asset_id=? AND source_exists=1 ORDER BY created_at DESC,version_id DESC LIMIT 1", (asset_id,)).fetchone()
        editorial = conn.execute("SELECT visual_ai_request_json FROM asset_editorial_state WHERE asset_id=?", (asset_id,)).fetchone()
    if not latest or latest[0] != source_version_id:
        raise ValueError("The fixture image version changed; request visual repair again.")
    request = visual._read_json(editorial[0], {}) if editorial else {}
    if request.get("sourceVersionId") != source_version_id or not request.get("requestedAt"):
        raise ValueError("Save an explicit visual AI request for this source version first.")
    request["reasons"] = visual._normalize_categories(request.get("reasons", []))
    asset = conn.execute("SELECT source_anchor,raw_json FROM sidecar_assets WHERE asset_id=?", (asset_id,)).fetchone()
    raw = visual._read_json(asset["raw_json"], {})
    anchor = str(asset["source_anchor"] or "")
    photo_id = raw.get("localIdentifier") or (anchor[len("apple-photos://"):] if anchor.startswith("apple-photos://") else asset_id)
    return request, photo_id


def artifact_root(root: Path, proposal_id: str) -> Path:
    if not proposal_id.startswith("visual-repair-") or any(c not in "abcdefghijklmnopqrstuvwxyz0123456789-" for c in proposal_id):
        raise ValueError("Invalid visual proposal identity.")
    base = root.resolve() / "assets/owner-actions/visual-repair-artifacts"
    destination = (base / proposal_id).resolve()
    destination.relative_to(root.resolve())
    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
    return destination


def _state(root, proposal_id, state, error="", **values):
    with connect(root) as conn:
        visual.ensure_schema(conn)
        row = _row(conn, proposal_id)
        if row["generation_state"] == "cancelled":
            return visual._proposal_json(row)
        updates = {"generation_state": state, "generation_error": error,
                   "updated_at": visual.now_iso(), **values}
        conn.execute("UPDATE visual_repair_proposals SET " + ",".join(name+"=?" for name in updates) + " WHERE proposal_id=?",
                     [*updates.values(), proposal_id])
        conn.commit()
        return visual._proposal_json(_row(conn, proposal_id))


def start_generation(root: Path, fixture_id: str, asset_id: str, source_version_id: str,
                     categories, *, idempotency_key="", regenerate=False,
                     preview_runner=request_preview, launch_worker=True) -> dict:
    """Commit intent, capture one permitted preview, then launch a bounded worker."""
    if not configuration()["configured"]:
        raise ValueError(configuration()["message"])
    with connect(root) as conn:
        visual.ensure_schema(conn)
        conn.commit()
        conn.execute("BEGIN IMMEDIATE")
        request, photo_id = validate_request(conn, fixture_id, asset_id, source_version_id)
        categories = visual._normalize_categories(categories)
        if categories != request["reasons"]:
            raise ValueError("Visual reasons changed; save Needs AI before generating.")
        key = idempotency_key or str(uuid.uuid4())
        replay = conn.execute("SELECT * FROM visual_repair_proposals WHERE idempotency_key=?", (key,)).fetchone()
        if replay:
            if (replay["fixture_id"], replay["asset_id"], replay["source_version_id"]) != (fixture_id, asset_id, source_version_id):
                raise ValueError("Visual request key already belongs to another source.")
            return visual._proposal_json(replay, idempotent_replay=True)
        previous = conn.execute("SELECT * FROM visual_repair_proposals WHERE fixture_id=? AND asset_id=? AND source_version_id=? AND status!='superseded' ORDER BY attempt DESC,created_at DESC LIMIT 1",
                                (fixture_id, asset_id, source_version_id)).fetchone()
        if previous and previous["generation_state"] in ACTIVE:
            from datetime import datetime, timezone
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(previous["updated_at"].replace("Z", "+00:00"))).total_seconds()
            if age > 1200:
                conn.execute("UPDATE visual_repair_proposals SET generation_state='failed',generation_error='Generation worker expired; no automatic retry was made.' WHERE proposal_id=?", (previous["proposal_id"],))
                previous = _row(conn, previous["proposal_id"])
        if previous and previous["generation_state"] in ACTIVE:
            return visual._proposal_json(previous, idempotent_replay=True)
        if (previous and previous["generation_state"] == "ready" and previous["status"] != "rejected"
                and previous["request_fingerprint"] == visual._json(request) and not regenerate):
            return visual._proposal_json(previous, idempotent_replay=True)
        if previous and previous["status"] == "accepted":
            raise ValueError("The accepted visual draft cannot be replaced by regeneration.")
        attempt = int(previous["attempt"]) + 1 if previous else 1
        ladder = visual._model_ladder(conn)
        rung = min(attempt, len(ladder))
        proposal_id = "visual-repair-" + uuid.uuid4().hex
        timestamp = visual.now_iso()
        record = dict(proposal_id=proposal_id, fixture_id=fixture_id, asset_id=asset_id,
            source_version_id=source_version_id, defect_categories_json=visual._json(categories),
            ladder_rung=rung, model_ladder_json=visual._json(ladder),
            requested_generator_model=ladder[rung-1]["model"], resolved_model=MODEL,
            reasoning_effort=ladder[rung-1]["effort"], vision=1, attempt=attempt, status="draft",
            original_reference="immutable-source-version://"+source_version_id, derived_reference="",
            derived_available=0, generator_reference="openai-image-edit://pending", request_fingerprint=visual._json(request),
            idempotency_key=key, previous_proposal_id=previous["proposal_id"] if previous else None,
            generated_at="", created_at=timestamp, updated_at=timestamp, generation_state="queued")
        conn.execute("INSERT INTO visual_repair_proposals ("+",".join(record)+") VALUES ("+",".join("?" for _ in record)+")", list(record.values()))
        visual._record_event(conn, proposal_id=proposal_id, action="request", before_status="", after_status="draft",
            idempotency_key=key+":request", reason="Requested an OpenAI image-edit draft from an explicitly requested RE photo.", created_at=timestamp)
        conn.commit()
    try:
        destination = artifact_root(root, proposal_id)
        before = destination / "before.jpg"
        from fixture_editions import enabled, render_selected_preview
        with connect(root) as conn:
            rendered = enabled(conn) and render_selected_preview(conn,fixture_id,asset_id,before,1800)
        if not rendered:
            preview_runner(photo_id, before, 1800, timeout=60)
        data = before.read_bytes()
        if len(data) > 8 * 1024 * 1024:
            raise ValueError("Visual preview exceeds its size limit.")
        image_dimensions(data)
        _state(root, proposal_id, "queued", original_preview_reference=before.as_uri(),
               original_preview_sha256=hashlib.sha256(data).hexdigest())
        if launch_worker:
            # No PhotoKit capability, prompts, image bytes or credentials in argv.
            subprocess.Popen([sys.executable, "-I", "-B", "-c",
                "import runpy,sys;sys.path.insert(0,sys.argv[1]);sys.argv=sys.argv[2:];runpy.run_path(sys.argv[0],run_name='__main__')",
                str(Path(__file__).resolve().parent), str(Path(__file__).resolve()), str(root.resolve()), proposal_id],
                cwd=root, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                start_new_session=True, env={"PATH": "/usr/bin:/bin:/usr/sbin:/sbin"})
    except Exception as error:
        return _state(root, proposal_id, "failed", str(error)[:500])
    with connect(root) as conn:
        return visual._proposal_json(_row(conn, proposal_id))


def run_generation(root: Path, proposal_id: str, *, editor=edit_image) -> dict:
    """Bound parallel provider work; publish only a still-current decoded draft."""
    heartbeat_at = 0.0

    def keep_waiting():
        """Retain live queued jobs without masking cancellation or dead workers."""
        nonlocal heartbeat_at
        with connect(root) as conn:
            row = _row(conn, proposal_id)
            if row["generation_state"] not in ACTIVE or row["status"] != "draft":
                return False
            now = time.monotonic()
            if now >= heartbeat_at:
                conn.execute("UPDATE visual_repair_proposals SET updated_at=? WHERE proposal_id=? AND generation_state='queued' AND status='draft'",
                             (visual.now_iso(), proposal_id))
                heartbeat_at = now + 30
            return True

    directory = artifact_root(root, proposal_id).parent
    with generation_slot(directory, proposal_id, keep_waiting) as admitted:
        if not admitted:
            with connect(root) as conn:
                return visual._proposal_json(_row(conn, proposal_id))
        try:
            with connect(root) as conn:
                row = _row(conn, proposal_id)
                if row["generation_state"] not in ACTIVE or row["status"] != "draft":
                    return visual._proposal_json(row)
                request, _ = validate_request(conn, row["fixture_id"], row["asset_id"], row["source_version_id"])
                if visual._json(request) != row["request_fingerprint"]:
                    raise ValueError("The saved visual request changed. Generate from the current request.")
                categories = request["reasons"]
                before = artifact_root(root, proposal_id) / "before.jpg"
                if hashlib.sha256(before.read_bytes()).hexdigest() != row["original_preview_sha256"]:
                    raise ValueError("The visual input changed after capture.")
            _state(root, proposal_id, "running")
            note = str(request.get("note") or "")
            rendered, receipt = editor(before, categories, note=note) if note else editor(before, categories)
            image_dimensions(rendered)
            digest = hashlib.sha256(rendered).hexdigest()
            if digest == row["original_preview_sha256"]:
                raise ValueError("The provider returned an unchanged source, not an after image.")
            after = artifact_root(root, proposal_id) / "after.png"
            temporary = after.with_suffix(".partial")
            temporary.write_bytes(rendered)
            os.chmod(temporary, 0o600)
            temporary.replace(after)
            with connect(root) as conn:
                conn.execute("BEGIN IMMEDIATE")
                row = _row(conn, proposal_id)
                if row["generation_state"] not in ACTIVE:
                    return visual._proposal_json(row)
                request, _ = validate_request(conn, row["fixture_id"], row["asset_id"], row["source_version_id"])
                if visual._json(request) != row["request_fingerprint"] or row["status"] != "draft":
                    raise ValueError("Visual request changed during generation; the result was not attached.")
                timestamp = visual.now_iso()
                conn.execute("UPDATE visual_repair_proposals SET generation_state='ready',generation_error='',derived_reference=?,derived_sha256=?,derived_available=1,generator_reference=?,provider_receipt_json=?,generated_at=?,materialized_at=?,updated_at=? WHERE proposal_id=?",
                    (after.as_uri(), digest, "openai-image-edit://"+str(receipt.get("requestId") or proposal_id), visual._json(receipt), timestamp, timestamp, timestamp, proposal_id))
                if row["previous_proposal_id"]:
                    conn.execute("UPDATE visual_repair_proposals SET status='superseded',derived_available=0,updated_at=? WHERE proposal_id=? AND status!='accepted'", (timestamp,row["previous_proposal_id"]))
                visual._record_event(conn, proposal_id=proposal_id, action="materialize", before_status="draft", after_status="draft", idempotency_key=proposal_id+":materialize", reason="Stored a checksum-bound OpenAI visual draft; original and workflow decisions unchanged.", created_at=timestamp)
                conn.commit()
                return visual._proposal_json(_row(conn, proposal_id))
        except Exception as error:
            return _state(root, proposal_id, "failed", str(error)[:500])


def cancel_generation(root, fixture_id, proposal_id):
    """Cancel attachment of queued/running output; an in-flight provider may finish."""
    with connect(root) as conn:
        visual.ensure_schema(conn)
        row = _row(conn, proposal_id)
        if row["fixture_id"] != fixture_id:
            raise ValueError("Visual cancellation fixture mismatch.")
        if row["generation_state"] in ACTIVE:
            conn.execute("UPDATE visual_repair_proposals SET generation_state='cancelled',generation_error='Cancelled; an in-flight provider request may still finish.',updated_at=? WHERE proposal_id=?", (visual.now_iso(),proposal_id))
            conn.commit()
        return visual._proposal_json(_row(conn, proposal_id))


if __name__ == "__main__":
    run_generation(Path(sys.argv[1]), sys.argv[2])
