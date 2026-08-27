#!/usr/bin/env python3
"""Stage a disposable RE Review fixture from an approved synthetic image pair."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil

from fixture_pipeline import create_fixture, set_fixture_asset_state
from sidecar_state_db import connect, upsert_assets
from visual_repair_proposals import (
    VISUAL_REPAIR_CATEGORIES,
    materialize_visual_repair_proposal,
    request_visual_repair_proposal,
)


ASSET_ID = "synthetic-openai-pbe-144"
SOURCE_VERSION_ID = "synthetic-openai-pbe-144-source-v1"
RE_FIXTURE_ID = "fixture-re"
CHILD_FIXTURE_ID = "fixture-re-pbe-144-synthetic"


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _copy_artifact(source: Path, destination: Path) -> Path:
    source = source.expanduser().resolve()
    if not source.is_file():
        raise ValueError(f"synthetic fixture image does not exist: {source}")
    if source.suffix.casefold() not in {".jpg", ".jpeg", ".png", ".heic"}:
        raise ValueError(f"synthetic fixture image has an unsupported type: {source.suffix}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)
    return destination


def stage_fixture(output_root: Path, original: Path, proposed: Path) -> dict:
    output_root = output_root.expanduser().resolve()
    if output_root.exists() and any(output_root.iterdir()):
        raise ValueError("output root must be new or empty; existing data is never replaced")
    output_root.mkdir(parents=True, exist_ok=True)
    artifact_root = output_root / "assets/owner-actions/visual-repair-artifacts/pbe-144"
    original_copy = _copy_artifact(original, artifact_root / f"original{original.suffix.casefold()}")
    proposed_copy = _copy_artifact(proposed, artifact_root / f"proposed{proposed.suffix.casefold()}")
    original_sha256 = _sha256(original_copy)
    proposed_sha256 = _sha256(proposed_copy)
    if original_sha256 == proposed_sha256:
        raise ValueError("synthetic before and proposed images must differ")

    upsert_assets(output_root, [{
        "localIdentifier": ASSET_ID,
        "filename": "PBE-144 Synthetic OpenAI Interior.png",
        "mediaType": "photo",
        "creationDate": "2026-08-27T16:38:00Z",
        "title": "Synthetic Mediterranean apartment interior",
        "keywords": ["Synthetic", "Real Estate", "PBE-144"],
    }])
    create_fixture(
        output_root,
        "RE",
        fixture_id=RE_FIXTURE_ID,
        template_key="real-estate",
    )
    create_fixture(
        output_root,
        "PBE-144 Synthetic OpenAI",
        parent_fixture_id=RE_FIXTURE_ID,
        fixture_id=CHILD_FIXTURE_ID,
    )
    set_fixture_asset_state(output_root, RE_FIXTURE_ID, [ASSET_ID], "picked")
    set_fixture_asset_state(output_root, CHILD_FIXTURE_ID, [ASSET_ID], "picked")
    with connect(output_root) as conn:
        conn.execute(
            """
            INSERT INTO asset_source_versions (
              version_id, asset_id, metadata_fingerprint, rendered_fingerprint,
              source_exists, state, created_at
            ) VALUES (?, ?, ?, ?, 1, 'approved', ?)
            """,
            (
                SOURCE_VERSION_ID,
                ASSET_ID,
                original_sha256,
                original_sha256,
                "2026-08-27T16:38:00Z",
            ),
        )
        conn.commit()

    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    proposal = request_visual_repair_proposal(
        output_root,
        CHILD_FIXTURE_ID,
        ASSET_ID,
        SOURCE_VERSION_ID,
        VISUAL_REPAIR_CATEGORIES,
        generator="synthetic",
        idempotency_key="pbe-144-synthetic-openai-request-v1",
        generated_at=generated_at,
    )
    provider_reference = (
        "openai-synthetic://built-in-imagegen/pbe-144/" + proposed_sha256[:24]
    )
    materialized = materialize_visual_repair_proposal(
        output_root,
        proposal["proposalId"],
        original_copy,
        proposed_copy,
        provider_reference=provider_reference,
        idempotency_key="pbe-144-synthetic-openai-materialize-v1",
        generated_at=generated_at,
    )
    receipt = {
        "schemaVersion": 1,
        "syntheticOnly": True,
        "fixtureId": CHILD_FIXTURE_ID,
        "assetId": ASSET_ID,
        "sourceVersionId": SOURCE_VERSION_ID,
        "proposalId": materialized["proposalId"],
        "status": materialized["status"],
        "readOnlyComparison": materialized["readOnlyComparison"],
        "derivedAvailable": materialized["derivedAvailable"],
        "defectCategories": materialized["defectCategories"],
        "originalPreviewSha256": materialized["originalPreviewSha256"],
        "derivedSha256": materialized["derivedSha256"],
        "providerReference": provider_reference,
        "outputRoot": str(output_root),
        "canonicalOwnerStateChanged": False,
    }
    receipt_path = output_root / "pbe-144-synthetic-openai-receipt.json"
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--original", type=Path, required=True)
    parser.add_argument("--proposed", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(stage_fixture(args.output_root, args.original, args.proposed), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
