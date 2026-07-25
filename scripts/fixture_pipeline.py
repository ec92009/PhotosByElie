#!/usr/bin/env python3
"""Universal fixture tree, culling-pool, placement, and delivery state.

This module is deliberately additive to Sidecar.  It owns fixture scope and
delivery orchestration, while ``sidecar_state_db`` remains the supported writer
for culling and editorial decisions.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from typing import Any, Iterable
import uuid

from sidecar_state_db import connect as connect_owner, editorial_version_hash as sidecar_editorial_version_hash


DESTINATIONS = {"r2", "apple_photos", "archive"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _read_json(value: Any, fallback: Any) -> Any:
    try:
        return json.loads(str(value or ""))
    except json.JSONDecodeError:
        return fallback


def _clean_name(value: Any) -> str:
    name = re.sub(r"\s+", " ", str(value or "").strip())
    if not name:
        raise ValueError("fixture name is required")
    if len(name) > 160:
        raise ValueError("fixture name must be 160 characters or fewer")
    return name


def _slug(value: Any) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").casefold()).strip("-")
    return slug[:120] or "fixture"


def _unique(values: Iterable[Any]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS fixtures (
          fixture_id TEXT PRIMARY KEY CHECK (trim(fixture_id) <> ''),
          parent_fixture_id TEXT,
          name TEXT NOT NULL CHECK (trim(name) <> ''),
          slug TEXT NOT NULL CHECK (trim(slug) <> ''),
          template_key TEXT,
          tags_json TEXT NOT NULL DEFAULT '[]',
          destination_defaults_json TEXT NOT NULL DEFAULT '["r2"]',
          access_gallery_key TEXT,
          legacy_identity_json TEXT NOT NULL DEFAULT '{}',
          archived_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (parent_fixture_id) REFERENCES fixtures(fixture_id),
          UNIQUE (parent_fixture_id, name COLLATE NOCASE)
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_fixtures_root_name
          ON fixtures(name COLLATE NOCASE) WHERE parent_fixture_id IS NULL;
        CREATE INDEX IF NOT EXISTS idx_fixtures_parent ON fixtures(parent_fixture_id, archived_at, name);

        CREATE TABLE IF NOT EXISTS fixture_source_batches (
          batch_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          source_identity TEXT NOT NULL,
          provenance_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id)
        );

        CREATE TABLE IF NOT EXISTS fixture_access_grants (
          grant_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          external_identity TEXT NOT NULL,
          subject_label TEXT,
          state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'revoked')),
          recovery_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          UNIQUE (fixture_id, provider, external_identity)
        );

        CREATE TABLE IF NOT EXISTS fixture_deliverables (
          deliverable_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          external_identity TEXT NOT NULL,
          kind TEXT NOT NULL,
          state TEXT NOT NULL,
          recovery_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          UNIQUE (fixture_id, provider, external_identity)
        );

        CREATE TABLE IF NOT EXISTS fixture_culling_pools (
          pool_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          name TEXT NOT NULL,
          criteria_json TEXT NOT NULL DEFAULT '{}',
          snapshot_hash TEXT NOT NULL,
          asset_count INTEGER NOT NULL DEFAULT 0,
          state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'archived')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          UNIQUE (fixture_id, snapshot_hash)
        );

        CREATE TABLE IF NOT EXISTS fixture_pool_assets (
          pool_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          source_identity TEXT NOT NULL,
          source_batch_id TEXT,
          snapshot_position INTEGER NOT NULL,
          provenance_json TEXT NOT NULL DEFAULT '{}',
          added_at TEXT NOT NULL,
          removed_at TEXT,
          PRIMARY KEY (pool_id, asset_id),
          FOREIGN KEY (pool_id) REFERENCES fixture_culling_pools(pool_id) ON DELETE CASCADE,
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id),
          FOREIGN KEY (source_batch_id) REFERENCES fixture_source_batches(batch_id)
        );
        CREATE INDEX IF NOT EXISTS idx_fixture_pool_assets_asset ON fixture_pool_assets(asset_id, removed_at);

        CREATE TABLE IF NOT EXISTS fixture_asset_placements (
          placement_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          source_pool_id TEXT,
          state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'removed')),
          placed_at TEXT NOT NULL,
          removed_at TEXT,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id),
          FOREIGN KEY (source_pool_id) REFERENCES fixture_culling_pools(pool_id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_fixture_asset_placement_active
          ON fixture_asset_placements(fixture_id, asset_id) WHERE state = 'active';
        CREATE INDEX IF NOT EXISTS idx_fixture_asset_placements_asset ON fixture_asset_placements(asset_id, state);

        CREATE TABLE IF NOT EXISTS fixture_placement_events (
          event_id TEXT PRIMARY KEY,
          placement_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          from_fixture_id TEXT,
          to_fixture_id TEXT,
          action TEXT NOT NULL CHECK (action IN ('place', 'move', 'remove', 'restore')),
          actor TEXT,
          reason TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY (placement_id) REFERENCES fixture_asset_placements(placement_id)
        );

        CREATE TABLE IF NOT EXISTS fixture_asset_destinations (
          fixture_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          destinations_json TEXT NOT NULL,
          version_hash TEXT NOT NULL,
          configured_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (fixture_id, asset_id),
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id)
        );

        CREATE TABLE IF NOT EXISTS fixture_delivery_receipts (
          receipt_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          asset_id TEXT NOT NULL,
          destination TEXT NOT NULL CHECK (destination IN ('r2', 'apple_photos', 'archive')),
          version_hash TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'verified', 'failed')),
          object_key TEXT,
          checksum_sha256 TEXT,
          visibility_policy TEXT,
          verification_json TEXT NOT NULL DEFAULT '{}',
          attempted_at TEXT,
          verified_at TEXT,
          error_text TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          FOREIGN KEY (asset_id) REFERENCES sidecar_assets(asset_id),
          UNIQUE (fixture_id, asset_id, destination, version_hash, object_key)
        );
        CREATE INDEX IF NOT EXISTS idx_fixture_delivery_receipts_state
          ON fixture_delivery_receipts(fixture_id, destination, status, updated_at);
        """
    )


def connect(repo_root: Path, db_path: Path | None = None) -> sqlite3.Connection:
    conn = connect_owner(repo_root, db_path)
    ensure_schema(conn)
    conn.commit()
    return conn


def _fixture_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "fixtureId": row["fixture_id"],
        "parentFixtureId": row["parent_fixture_id"] or "",
        "name": row["name"],
        "slug": row["slug"],
        "templateKey": row["template_key"] or "",
        "tags": _read_json(row["tags_json"], []),
        "destinationDefaults": _read_json(row["destination_defaults_json"], ["r2"]),
        "accessGalleryKey": row["access_gallery_key"] or "",
        "legacyIdentity": _read_json(row["legacy_identity_json"], {}),
        "archivedAt": row["archived_at"] or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def create_fixture(
    repo_root: Path,
    name: str,
    *,
    parent_fixture_id: str = "",
    fixture_id: str = "",
    tags: Iterable[str] = (),
    template_key: str = "",
    destination_defaults: Iterable[str] = ("r2",),
    access_gallery_key: str = "",
    legacy_identity: dict[str, Any] | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    owns = conn is None
    conn = conn or connect(repo_root)
    timestamp = now_iso()
    clean_name = _clean_name(name)
    parent = str(parent_fixture_id or "").strip() or None
    destinations = _unique(destination_defaults)
    if not destinations or any(item not in DESTINATIONS for item in destinations):
        raise ValueError("destination defaults must use r2, apple_photos, or archive")
    try:
        if parent and not conn.execute("SELECT 1 FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL", (parent,)).fetchone():
            raise ValueError("parent fixture does not exist")
        existing = conn.execute(
            "SELECT * FROM fixtures WHERE parent_fixture_id IS ? AND name = ? COLLATE NOCASE AND archived_at IS NULL",
            (parent, clean_name),
        ).fetchone()
        if existing:
            return _fixture_row(existing)
        clean_id = str(fixture_id or "").strip() or f"fxt-{uuid.uuid4().hex[:16]}"
        conn.execute(
            """
            INSERT INTO fixtures (
              fixture_id, parent_fixture_id, name, slug, template_key, tags_json,
              destination_defaults_json, access_gallery_key, legacy_identity_json,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                clean_id, parent, clean_name, _slug(clean_name), str(template_key or "").strip() or None,
                _json(_unique(tags)), _json(destinations), str(access_gallery_key or "").strip() or None,
                _json(legacy_identity or {}), timestamp, timestamp,
            ),
        )
        if owns:
            conn.commit()
        return _fixture_row(conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (clean_id,)).fetchone())
    finally:
        if owns:
            conn.close()


def fixture_tree(repo_root: Path, *, include_archived: bool = False) -> list[dict[str, Any]]:
    with connect(repo_root) as conn:
        rows = conn.execute(
            f"SELECT * FROM fixtures {'WHERE archived_at IS NULL' if not include_archived else ''} ORDER BY name COLLATE NOCASE"
        ).fetchall()
    by_parent: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        item = _fixture_row(row)
        item["children"] = []
        by_parent.setdefault(item["parentFixtureId"], []).append(item)
    def attach(item: dict[str, Any], ancestors: tuple[str, ...]) -> dict[str, Any]:
        if item["fixtureId"] in ancestors:
            raise ValueError("fixture tree contains a cycle")
        item["children"] = [attach(child, (*ancestors, item["fixtureId"])) for child in by_parent.get(item["fixtureId"], [])]
        return item
    return [attach(root, ()) for root in by_parent.get("", [])]


def fixture_breadcrumbs(conn: sqlite3.Connection, fixture_id: str) -> list[dict[str, str]]:
    chain: list[dict[str, str]] = []
    seen: set[str] = set()
    current = str(fixture_id or "").strip()
    while current:
        if current in seen:
            raise ValueError("fixture tree contains a cycle")
        seen.add(current)
        row = conn.execute("SELECT fixture_id, parent_fixture_id, name FROM fixtures WHERE fixture_id = ?", (current,)).fetchone()
        if not row:
            raise ValueError("fixture does not exist")
        chain.append({"fixtureId": row["fixture_id"], "name": row["name"]})
        current = row["parent_fixture_id"] or ""
    return list(reversed(chain))


def record_source_batch(repo_root: Path, fixture_id: str, *, source_kind: str, source_identity: str, provenance: dict[str, Any] | None = None, batch_id: str = "") -> dict[str, Any]:
    timestamp = now_iso()
    stable_id = str(batch_id or "").strip() or f"batch-{hashlib.sha256(f'{fixture_id}|{source_kind}|{source_identity}'.encode()).hexdigest()[:16]}"
    with connect(repo_root) as conn:
        fixture_breadcrumbs(conn, fixture_id)
        conn.execute(
            """INSERT INTO fixture_source_batches (batch_id, fixture_id, source_kind, source_identity, provenance_json, created_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(batch_id) DO UPDATE SET provenance_json = excluded.provenance_json""",
            (stable_id, fixture_id, _clean_name(source_kind), _clean_name(source_identity), _json(provenance or {}), timestamp),
        )
        conn.commit()
    return {"batchId": stable_id, "fixtureId": fixture_id, "sourceKind": source_kind, "sourceIdentity": source_identity, "provenance": provenance or {}}


def move_fixture(repo_root: Path, fixture_id: str, parent_fixture_id: str = "") -> dict[str, Any]:
    with connect(repo_root) as conn:
        fixture = conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone()
        if not fixture:
            raise ValueError("fixture does not exist")
        parent = str(parent_fixture_id or "").strip() or None
        if parent == fixture_id:
            raise ValueError("fixture cannot be its own parent")
        if parent:
            ancestors = {item["fixtureId"] for item in fixture_breadcrumbs(conn, parent)}
            if fixture_id in ancestors:
                raise ValueError("fixture cannot be moved below one of its descendants")
        conn.execute("UPDATE fixtures SET parent_fixture_id = ?, updated_at = ? WHERE fixture_id = ?", (parent, now_iso(), fixture_id))
        conn.commit()
        return _fixture_row(conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone())


def rename_fixture(repo_root: Path, fixture_id: str, name: str) -> dict[str, Any]:
    """Rename a fixture while retaining its stable identity and relationships."""
    clean_name = _clean_name(name)
    with connect(repo_root) as conn:
        row = conn.execute("SELECT parent_fixture_id FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL", (fixture_id,)).fetchone()
        if not row:
            raise ValueError("fixture does not exist")
        duplicate = conn.execute(
            "SELECT fixture_id FROM fixtures WHERE parent_fixture_id IS ? AND name = ? COLLATE NOCASE AND archived_at IS NULL AND fixture_id <> ?",
            (row["parent_fixture_id"], clean_name, fixture_id),
        ).fetchone()
        if duplicate:
            raise ValueError("a sibling fixture already uses that name")
        conn.execute("UPDATE fixtures SET name = ?, slug = ?, updated_at = ? WHERE fixture_id = ?", (clean_name, _slug(clean_name), now_iso(), fixture_id))
        conn.commit()
        return _fixture_row(conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone())


def archive_fixture(repo_root: Path, fixture_id: str) -> dict[str, Any]:
    """Hide a fixture tree without deleting its stable IDs or relationships."""
    timestamp = now_iso()
    with connect(repo_root) as conn:
        row = conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone()
        if not row:
            raise ValueError("fixture does not exist")
        conn.execute(
            """WITH RECURSIVE subtree(fixture_id) AS (
                 SELECT fixture_id FROM fixtures WHERE fixture_id = ?
                 UNION ALL
                 SELECT f.fixture_id FROM fixtures f JOIN subtree s ON f.parent_fixture_id = s.fixture_id
               )
               UPDATE fixtures SET archived_at = ?, updated_at = ? WHERE fixture_id IN (SELECT fixture_id FROM subtree)""",
            (fixture_id, timestamp, timestamp),
        )
        conn.commit()
        return _fixture_row(conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone())


def reopen_fixture(repo_root: Path, fixture_id: str) -> dict[str, Any]:
    """Restore an archived fixture while preserving all attached state."""
    with connect(repo_root) as conn:
        row = conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone()
        if not row:
            raise ValueError("fixture does not exist")
        parent = row["parent_fixture_id"] or ""
        if parent:
            parent_row = conn.execute("SELECT archived_at FROM fixtures WHERE fixture_id = ?", (parent,)).fetchone()
            if parent_row and parent_row["archived_at"]:
                raise ValueError("reopen the archived parent fixture first")
        conn.execute(
            """WITH RECURSIVE subtree(fixture_id) AS (
                 SELECT fixture_id FROM fixtures WHERE fixture_id = ?
                 UNION ALL
                 SELECT f.fixture_id FROM fixtures f JOIN subtree s ON f.parent_fixture_id = s.fixture_id
               )
               UPDATE fixtures SET archived_at = NULL, updated_at = ? WHERE fixture_id IN (SELECT fixture_id FROM subtree)""",
            (fixture_id, now_iso()),
        )
        conn.commit()
        return _fixture_row(conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone())


def link_access_grant(repo_root: Path, fixture_id: str, *, provider: str, external_identity: str, subject_label: str = "", recovery: dict[str, Any] | None = None) -> dict[str, Any]:
    timestamp = now_iso()
    clean_provider = _clean_name(provider)
    clean_identity = _clean_name(external_identity)
    with connect(repo_root) as conn:
        fixture_breadcrumbs(conn, fixture_id)
        existing = conn.execute("SELECT grant_id FROM fixture_access_grants WHERE fixture_id = ? AND provider = ? AND external_identity = ?", (fixture_id, clean_provider, clean_identity)).fetchone()
        grant_id = existing["grant_id"] if existing else f"grant-{uuid.uuid4().hex[:16]}"
        conn.execute(
            """INSERT INTO fixture_access_grants (grant_id, fixture_id, provider, external_identity, subject_label, state, recovery_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
               ON CONFLICT(fixture_id, provider, external_identity) DO UPDATE SET subject_label = excluded.subject_label,
                 state = 'active', recovery_json = excluded.recovery_json, updated_at = excluded.updated_at""",
            (grant_id, fixture_id, clean_provider, clean_identity, str(subject_label or "").strip(), _json(recovery or {}), timestamp, timestamp),
        )
        conn.commit()
    return {"grantId": grant_id, "fixtureId": fixture_id, "provider": clean_provider, "externalIdentity": clean_identity, "state": "active"}


def link_deliverable(repo_root: Path, fixture_id: str, *, provider: str, external_identity: str, kind: str, state: str, recovery: dict[str, Any] | None = None) -> dict[str, Any]:
    timestamp = now_iso()
    clean_provider = _clean_name(provider)
    clean_identity = _clean_name(external_identity)
    clean_kind = _clean_name(kind)
    clean_state = _clean_name(state)
    with connect(repo_root) as conn:
        fixture_breadcrumbs(conn, fixture_id)
        existing = conn.execute("SELECT deliverable_id FROM fixture_deliverables WHERE fixture_id = ? AND provider = ? AND external_identity = ?", (fixture_id, clean_provider, clean_identity)).fetchone()
        deliverable_id = existing["deliverable_id"] if existing else f"dlv-{uuid.uuid4().hex[:16]}"
        conn.execute(
            """INSERT INTO fixture_deliverables (deliverable_id, fixture_id, provider, external_identity, kind, state, recovery_json, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(fixture_id, provider, external_identity) DO UPDATE SET kind = excluded.kind,
                 state = excluded.state, recovery_json = excluded.recovery_json, updated_at = excluded.updated_at""",
            (deliverable_id, fixture_id, clean_provider, clean_identity, clean_kind, clean_state, _json(recovery or {}), timestamp, timestamp),
        )
        conn.commit()
    return {"deliverableId": deliverable_id, "fixtureId": fixture_id, "provider": clean_provider, "externalIdentity": clean_identity, "kind": clean_kind, "state": clean_state}


def list_deliverables(repo_root: Path, fixture_id: str) -> dict[str, Any]:
    with connect(repo_root) as conn:
        breadcrumbs = fixture_breadcrumbs(conn, fixture_id)
        rows = conn.execute(
            """SELECT deliverable_id, provider, external_identity, kind, state,
                      recovery_json, created_at, updated_at
               FROM fixture_deliverables
               WHERE fixture_id = ?
               ORDER BY updated_at DESC, deliverable_id""",
            (fixture_id,),
        ).fetchall()
    items = [{
        "deliverableId": row["deliverable_id"],
        "fixtureId": fixture_id,
        "provider": row["provider"],
        "externalIdentity": row["external_identity"],
        "kind": row["kind"],
        "state": row["state"],
        "recovery": _read_json(row["recovery_json"], {}),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    } for row in rows]
    return {
        "ok": True,
        "fixtureId": fixture_id,
        "breadcrumbs": breadcrumbs,
        "count": len(items),
        "items": items,
    }


def publication_plan(
    repo_root: Path,
    fixture_id: str,
    asset_ids: Iterable[str] = (),
) -> dict[str, Any]:
    """Return exact public-fixture assets whose current R2 receipts are verified."""
    selected_ids = _unique(asset_ids)
    with connect(repo_root) as conn:
        fixture = conn.execute(
            "SELECT fixture_id, name, tags_json, archived_at FROM fixtures WHERE fixture_id = ?",
            (fixture_id,),
        ).fetchone()
        if not fixture or fixture["archived_at"]:
            raise ValueError("publication fixture does not exist or is archived")
        tags = _read_json(fixture["tags_json"], [])
        if "public" not in tags:
            raise ValueError("only a fixture tagged public can enter catalog publication")
        fixture_name = str(fixture["name"])
    delivery = delivery_plan(repo_root, fixture_id)
    eligible: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    selected = set(selected_ids)
    found: set[str] = set()
    for item in delivery["items"]:
        asset_id = str(item["assetId"])
        if selected and asset_id not in selected:
            continue
        found.add(asset_id)
        r2 = item.get("receipts", {}).get("r2", {})
        reason = ""
        if not item.get("approved"):
            reason = "asset is not both picked and metadata-approved"
        elif r2.get("status") != "verified":
            reason = "same-version R2 delivery is not verified"
        target = {
            "assetId": asset_id,
            "versionHash": item.get("versionHash") or "",
            "r2Status": r2.get("status") or "pending",
        }
        (blocked if reason else eligible).append({**target, **({"reason": reason} if reason else {})})
    for missing in selected - found:
        blocked.append({"assetId": missing, "reason": "asset is not actively placed in this fixture"})
    return {
        "ok": not blocked,
        "fixtureId": fixture_id,
        "fixtureName": fixture_name,
        "tags": tags,
        "eligibleCount": len(eligible),
        "blockedCount": len(blocked),
        "eligible": eligible,
        "blocked": blocked,
        "published": False,
    }


def search_assets(repo_root: Path, filters: dict[str, Any] | None = None, *, limit: int = 500, offset: int = 0) -> dict[str, Any]:
    filters = filters or {}
    predicates = ["(a.missing_at IS NULL OR a.missing_at = '')"]
    params: list[Any] = []
    exact_ids = _unique(filters.get("assetIds") or filters.get("albumAssetIds") or [])
    if exact_ids:
        predicates.append(f"a.asset_id IN ({','.join('?' for _ in exact_ids)})")
        params.extend(exact_ids)
    for key, column in (("dateFrom", "a.captured_at"), ("dateTo", "a.captured_at")):
        value = str(filters.get(key) or "").strip()
        if value:
            predicates.append(f"{column} {'>=' if key == 'dateFrom' else '<='} ?")
            params.append(value)
    for key, column in (("mediaTypes", "a.media_type"), ("ratings", "COALESCE(d.rating, 0)"), ("colors", "COALESCE(d.color, '')"), ("pickStates", "COALESCE(d.pick_state, 'undecided')"), ("metadataStates", "COALESCE(d.metadata_state, 'unreviewed')")):
        values = _unique(filters.get(key) or [])
        if values:
            predicates.append(f"{column} IN ({','.join('?' for _ in values)})")
            params.extend(values)
    fixture_id = str(filters.get("fixtureId") or "").strip()
    if fixture_id:
        predicates.append("EXISTS (SELECT 1 FROM fixture_asset_placements p WHERE p.asset_id = a.asset_id AND p.fixture_id = ? AND p.state = 'active')")
        params.append(fixture_id)
    for album_id in _unique(filters.get("albumIds") or []):
        predicates.append("lower(COALESCE(a.raw_json, '')) LIKE ? ESCAPE '\\'")
        params.append(f"%{album_id.casefold().replace('%', '\\%').replace('_', '\\_')}%")
    for key in ("camera", "lens"):
        value = str(filters.get(key) or "").strip().casefold()
        if value:
            predicates.append("lower(COALESCE(a.raw_json, '')) LIKE ? ESCAPE '\\'")
            params.append(f"%{value.replace('%', '\\%').replace('_', '\\_')}%")
    delivery_states = _unique(filters.get("deliveryStates") or [])
    if delivery_states:
        predicates.append(f"EXISTS (SELECT 1 FROM fixture_delivery_receipts r WHERE r.asset_id = a.asset_id AND r.status IN ({','.join('?' for _ in delivery_states)}))")
        params.extend(delivery_states)
    if bool(filters.get("dedupeExact")):
        predicates.append(
            """a.asset_id = (SELECT min(a2.asset_id) FROM sidecar_assets a2
               WHERE (
                   COALESCE(NULLIF(json_extract(a2.raw_json, '$.localIdentifier'), ''), NULLIF(a2.source_anchor, ''), a2.asset_id) =
                   COALESCE(NULLIF(json_extract(a.raw_json, '$.localIdentifier'), ''), NULLIF(a.source_anchor, ''), a.asset_id)
                   OR (
                     COALESCE(json_extract(a.raw_json, '$.checksumSha256'), '') <> ''
                     AND json_extract(a2.raw_json, '$.checksumSha256') = json_extract(a.raw_json, '$.checksumSha256')
                   )
               )
                 AND (a2.missing_at IS NULL OR a2.missing_at = ''))"""
        )
    query = str(filters.get("query") or filters.get("q") or "").strip().casefold()
    for term in re.findall(r"[^\s,;]+", query)[:8]:
        like = f"%{term.replace('%', '\\%').replace('_', '\\_')}%"
        columns = ["a.asset_id", "a.filename", "a.photos_title", "a.photos_keywords_json", "a.location_label", "a.metadata_seed_title", "a.metadata_seed_keywords_json", "d.title", "d.caption", "d.keywords_json"]
        predicates.append("(" + " OR ".join(f"lower(COALESCE({column}, '')) LIKE ? ESCAPE '\\'" for column in columns) + ")")
        params.extend([like] * len(columns))
    where = " AND ".join(predicates)
    safe_limit = max(1, min(int(limit or 500), 5000))
    safe_offset = max(0, int(offset or 0))
    with connect(repo_root) as conn:
        count = int(conn.execute(f"SELECT count(*) FROM sidecar_assets a LEFT JOIN sidecar_decisions d ON d.asset_id = a.asset_id WHERE {where}", params).fetchone()[0])
        rows = conn.execute(
            f"""
            SELECT a.asset_id, a.source_anchor, a.filename, a.media_type, a.captured_at,
                   a.pixel_width, a.pixel_height, a.photos_title, a.photos_keywords_json,
                   a.location_label, COALESCE(d.rating, 0) rating, COALESCE(d.color, '') color,
                   COALESCE(d.pick_state, 'undecided') pick_state,
                   COALESCE(d.metadata_state, 'unreviewed') metadata_state,
                   COALESCE(d.title, '') decision_title, COALESCE(d.caption, '') decision_caption,
                   COALESCE(d.keywords_json, '[]') decision_keywords, COALESCE(a.raw_json, '{{}}') raw_json
            FROM sidecar_assets a LEFT JOIN sidecar_decisions d ON d.asset_id = a.asset_id
            WHERE {where}
            ORDER BY a.captured_at DESC, a.asset_id
            LIMIT ? OFFSET ?
            """,
            [*params, safe_limit, safe_offset],
        ).fetchall()
    items = []
    for row in rows:
        raw = _read_json(row["raw_json"], {})
        camera = raw.get("cameraMetadata") or raw.get("camera") or {}
        lens = raw.get("lensMetadata") or raw.get("lens") or camera.get("lensModel") or ""
        source_anchor = str(row["source_anchor"] or "")
        source_kind = "apple_photos" if source_anchor.startswith(("apple-photos", "ph://")) or raw.get("localIdentifier") else "photosbyelie"
        items.append({
        "assetId": row["asset_id"], "sourceKind": source_kind, "sourceIdentity": source_anchor,
        "filename": row["filename"] or "", "mediaType": row["media_type"] or "", "capturedAt": row["captured_at"] or "",
        "pixelWidth": int(row["pixel_width"] or 0), "pixelHeight": int(row["pixel_height"] or 0),
        "title": row["decision_title"] or row["photos_title"] or "", "keywords": _read_json(row["decision_keywords"], []) or _read_json(row["photos_keywords_json"], []),
        "caption": row["decision_caption"] or "", "camera": camera, "lens": lens,
        "locationLabel": row["location_label"] or "", "rating": int(row["rating"] or 0), "color": row["color"] or "",
        "pickState": row["pick_state"], "metadataState": row["metadata_state"],
        "missingFields": [field for field, value in (("camera", camera), ("lens", lens)) if not value],
        "exactIdentity": raw.get("localIdentifier") or source_anchor,
        "checksumSha256": raw.get("checksumSha256") or raw.get("sha256") or "",
    })
    return {"ok": True, "count": len(items), "totalCount": count, "offset": safe_offset, "limit": safe_limit, "filters": filters, "items": items, "readOnly": True}


def _snapshot_hash(asset_ids: Iterable[str], criteria: dict[str, Any]) -> str:
    payload = {"assetIds": sorted(_unique(asset_ids)), "criteria": criteria}
    return hashlib.sha256(_json(payload).encode("utf-8")).hexdigest()


def create_pool(repo_root: Path, fixture_id: str, asset_ids: Iterable[str], *, name: str = "", criteria: dict[str, Any] | None = None) -> dict[str, Any]:
    clean_ids = _unique(asset_ids)
    if not clean_ids:
        raise ValueError("select at least one asset")
    criteria = criteria or {}
    timestamp = now_iso()
    snapshot_hash = _snapshot_hash(clean_ids, criteria)
    with connect(repo_root) as conn:
        breadcrumbs = fixture_breadcrumbs(conn, fixture_id)
        existing = conn.execute("SELECT pool_id FROM fixture_culling_pools WHERE fixture_id = ? AND snapshot_hash = ?", (fixture_id, snapshot_hash)).fetchone()
        if existing:
            return get_pool(repo_root, existing["pool_id"], conn=conn)
        placeholders = ",".join("?" for _ in clean_ids)
        rows = conn.execute(f"SELECT asset_id, source_anchor, raw_json FROM sidecar_assets WHERE asset_id IN ({placeholders})", clean_ids).fetchall()
        by_id = {row["asset_id"]: row for row in rows}
        missing = [asset_id for asset_id in clean_ids if asset_id not in by_id]
        if missing:
            raise ValueError(f"{len(missing)} selected asset(s) are not indexed")
        pool_id = f"pool-{uuid.uuid4().hex[:16]}"
        pool_name = _clean_name(name or f"{' / '.join(item['name'] for item in breadcrumbs)} pool")
        conn.execute("INSERT INTO fixture_culling_pools (pool_id, fixture_id, name, criteria_json, snapshot_hash, asset_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (pool_id, fixture_id, pool_name, _json(criteria), snapshot_hash, len(clean_ids), timestamp, timestamp))
        for position, asset_id in enumerate(clean_ids):
            row = by_id[asset_id]
            raw = _read_json(row["raw_json"], {})
            provenance = {"sourceAnchor": row["source_anchor"], "albums": raw.get("albums") or raw.get("albumLocalIdentifiers") or []}
            source_kind = str(raw.get("sourceKind") or ("apple_photos" if raw.get("localIdentifier") or str(row["source_anchor"] or "").startswith("apple-photos") else "photosbyelie"))
            source_batch_id = str(raw.get("sourceBatchId") or (criteria.get("sourceBatchIdsByAsset") or {}).get(asset_id) or "").strip() or None
            if source_batch_id and not conn.execute("SELECT 1 FROM fixture_source_batches WHERE batch_id = ?", (source_batch_id,)).fetchone():
                raise ValueError(f"source batch is not registered: {source_batch_id}")
            conn.execute("INSERT INTO fixture_pool_assets (pool_id, asset_id, source_kind, source_identity, source_batch_id, snapshot_position, provenance_json, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", (pool_id, asset_id, source_kind, row["source_anchor"], source_batch_id, position, _json(provenance), timestamp))
        conn.commit()
        return get_pool(repo_root, pool_id, conn=conn)


def get_pool(repo_root: Path, pool_id: str, *, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    owns = conn is None
    conn = conn or connect(repo_root)
    try:
        row = conn.execute("SELECT * FROM fixture_culling_pools WHERE pool_id = ?", (pool_id,)).fetchone()
        if not row:
            raise ValueError("culling pool does not exist")
        assets = conn.execute(
            """
            SELECT p.asset_id, p.source_kind, p.source_identity, p.source_batch_id,
                   p.snapshot_position, p.provenance_json, p.added_at,
                   COALESCE(d.title, a.photos_title, '') AS title,
                   COALESCE(a.filename, '') AS filename,
                   COALESCE(a.media_type, '') AS media_type,
                   COALESCE(a.raw_json, '{}') AS raw_json
            FROM fixture_pool_assets p
            LEFT JOIN sidecar_assets a ON a.asset_id = p.asset_id
            LEFT JOIN sidecar_decisions d ON d.asset_id = p.asset_id
            WHERE p.pool_id = ? AND p.removed_at IS NULL
            ORDER BY p.snapshot_position
            """,
            (pool_id,),
        ).fetchall()
        return {
            "poolId": row["pool_id"], "fixtureId": row["fixture_id"], "name": row["name"], "criteria": _read_json(row["criteria_json"], {}),
            "snapshotHash": row["snapshot_hash"], "assetCount": len(assets), "state": row["state"], "createdAt": row["created_at"], "updatedAt": row["updated_at"],
            "breadcrumbs": fixture_breadcrumbs(conn, row["fixture_id"]),
            "assets": [{
                "assetId": item["asset_id"],
                "sourceKind": item["source_kind"],
                "sourceIdentity": item["source_identity"],
                "photoLibraryIdentifier": str(
                    _read_json(item["raw_json"], {}).get("localIdentifier") or ""
                ),
                "sourceBatchId": item["source_batch_id"] or "",
                "position": item["snapshot_position"],
                "title": item["title"],
                "filename": item["filename"],
                "mediaType": item["media_type"],
                "provenance": _read_json(item["provenance_json"], {}),
                "addedAt": item["added_at"],
            } for item in assets],
        }
    finally:
        if owns:
            conn.close()


def pool_asset_ids(repo_root: Path, pool_id: str) -> list[str]:
    return [item["assetId"] for item in get_pool(repo_root, pool_id)["assets"]]


def preview_pool_refresh(repo_root: Path, pool_id: str) -> dict[str, Any]:
    pool = get_pool(repo_root, pool_id)
    search = search_assets(repo_root, pool["criteria"], limit=5000)
    before = [item["assetId"] for item in pool["assets"]]
    after = [item["assetId"] for item in search["items"]]
    return {"ok": True, "poolId": pool_id, "beforeCount": len(before), "afterCount": len(after), "additions": [item for item in after if item not in set(before)], "removals": [item for item in before if item not in set(after)], "applied": False}


def apply_pool_refresh(repo_root: Path, pool_id: str) -> dict[str, Any]:
    """Create a new idempotent snapshot after an explicit refresh preview."""
    preview = preview_pool_refresh(repo_root, pool_id)
    original = get_pool(repo_root, pool_id)
    search = search_assets(repo_root, original["criteria"], limit=5000)
    refreshed = create_pool(
        repo_root,
        original["fixtureId"],
        [item["assetId"] for item in search["items"]],
        name=f"{original['name']} refresh",
        criteria=original["criteria"],
    )
    return {**preview, "applied": True, "originalPoolId": pool_id, "pool": refreshed}


def place_assets(repo_root: Path, fixture_id: str, asset_ids: Iterable[str], *, source_pool_id: str = "", actor: str = "owner", reason: str = "") -> dict[str, Any]:
    timestamp = now_iso()
    clean_ids = _unique(asset_ids)
    with connect(repo_root) as conn:
        fixture_breadcrumbs(conn, fixture_id)
        placed = []
        for asset_id in clean_ids:
            if not conn.execute("SELECT 1 FROM sidecar_assets WHERE asset_id = ?", (asset_id,)).fetchone():
                raise ValueError(f"asset is not indexed: {asset_id}")
            existing = conn.execute("SELECT placement_id FROM fixture_asset_placements WHERE fixture_id = ? AND asset_id = ? AND state = 'active'", (fixture_id, asset_id)).fetchone()
            if existing:
                placed.append(existing["placement_id"])
                continue
            placement_id = f"plc-{uuid.uuid4().hex[:16]}"
            conn.execute("INSERT INTO fixture_asset_placements (placement_id, fixture_id, asset_id, source_pool_id, placed_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", (placement_id, fixture_id, asset_id, source_pool_id or None, timestamp, timestamp))
            conn.execute("INSERT INTO fixture_placement_events (event_id, placement_id, asset_id, to_fixture_id, action, actor, reason, created_at) VALUES (?, ?, ?, ?, 'place', ?, ?, ?)", (f"evt-{uuid.uuid4().hex[:16]}", placement_id, asset_id, fixture_id, actor, reason, timestamp))
            placed.append(placement_id)
        conn.commit()
    return {"ok": True, "fixtureId": fixture_id, "assetCount": len(clean_ids), "placementIds": placed}


def list_placements(repo_root: Path, asset_ids: Iterable[str] = (), *, fixture_id: str = "") -> dict[str, Any]:
    clean_ids = _unique(asset_ids)
    predicates = ["1 = 1"]
    params: list[Any] = []
    if clean_ids:
        predicates.append(f"p.asset_id IN ({','.join('?' for _ in clean_ids)})")
        params.extend(clean_ids)
    if fixture_id:
        predicates.append("p.fixture_id = ?")
        params.append(fixture_id)
    with connect(repo_root) as conn:
        rows = conn.execute(
            f"""SELECT p.*, f.name fixture_name
                FROM fixture_asset_placements p JOIN fixtures f ON f.fixture_id = p.fixture_id
                WHERE {' AND '.join(predicates)}
                ORDER BY p.asset_id, p.state, p.updated_at DESC""",
            params,
        ).fetchall()
        items = []
        for row in rows:
            items.append({
                "placementId": row["placement_id"], "fixtureId": row["fixture_id"],
                "fixtureName": row["fixture_name"], "breadcrumbLabel": " / ".join(item["name"] for item in fixture_breadcrumbs(conn, row["fixture_id"])),
                "assetId": row["asset_id"], "sourcePoolId": row["source_pool_id"] or "",
                "state": row["state"], "placedAt": row["placed_at"], "removedAt": row["removed_at"] or "",
                "updatedAt": row["updated_at"],
            })
    return {"ok": True, "count": len(items), "items": items}


def move_placement(repo_root: Path, placement_id: str, to_fixture_id: str, *, actor: str = "owner", reason: str = "") -> dict[str, Any]:
    timestamp = now_iso()
    with connect(repo_root) as conn:
        fixture_breadcrumbs(conn, to_fixture_id)
        row = conn.execute("SELECT * FROM fixture_asset_placements WHERE placement_id = ? AND state = 'active'", (placement_id,)).fetchone()
        if not row:
            raise ValueError("active placement does not exist")
        existing = conn.execute("SELECT placement_id FROM fixture_asset_placements WHERE fixture_id = ? AND asset_id = ? AND state = 'active'", (to_fixture_id, row["asset_id"])).fetchone()
        if existing:
            raise ValueError("asset is already placed in the destination fixture")
        conn.execute("UPDATE fixture_asset_placements SET fixture_id = ?, updated_at = ? WHERE placement_id = ?", (to_fixture_id, timestamp, placement_id))
        conn.execute("INSERT INTO fixture_placement_events (event_id, placement_id, asset_id, from_fixture_id, to_fixture_id, action, actor, reason, created_at) VALUES (?, ?, ?, ?, ?, 'move', ?, ?, ?)", (f"evt-{uuid.uuid4().hex[:16]}", placement_id, row["asset_id"], row["fixture_id"], to_fixture_id, actor, reason, timestamp))
        conn.commit()
        return {"ok": True, "placementId": placement_id, "assetId": row["asset_id"], "fromFixtureId": row["fixture_id"], "toFixtureId": to_fixture_id}


def remove_placement(repo_root: Path, placement_id: str, *, actor: str = "owner", reason: str = "") -> dict[str, Any]:
    timestamp = now_iso()
    with connect(repo_root) as conn:
        row = conn.execute("SELECT * FROM fixture_asset_placements WHERE placement_id = ? AND state = 'active'", (placement_id,)).fetchone()
        if not row:
            raise ValueError("active placement does not exist")
        conn.execute("UPDATE fixture_asset_placements SET state = 'removed', removed_at = ?, updated_at = ? WHERE placement_id = ?", (timestamp, timestamp, placement_id))
        conn.execute("INSERT INTO fixture_placement_events (event_id, placement_id, asset_id, from_fixture_id, action, actor, reason, created_at) VALUES (?, ?, ?, ?, 'remove', ?, ?, ?)", (f"evt-{uuid.uuid4().hex[:16]}", placement_id, row["asset_id"], row["fixture_id"], actor, reason, timestamp))
        conn.commit()
        return {"ok": True, "placementId": placement_id, "assetId": row["asset_id"], "fixtureId": row["fixture_id"], "state": "removed"}


def restore_placement(repo_root: Path, placement_id: str, *, actor: str = "owner", reason: str = "") -> dict[str, Any]:
    timestamp = now_iso()
    with connect(repo_root) as conn:
        row = conn.execute("SELECT * FROM fixture_asset_placements WHERE placement_id = ? AND state = 'removed'", (placement_id,)).fetchone()
        if not row:
            raise ValueError("removed placement does not exist")
        if conn.execute("SELECT 1 FROM fixture_asset_placements WHERE fixture_id = ? AND asset_id = ? AND state = 'active'", (row["fixture_id"], row["asset_id"])).fetchone():
            raise ValueError("an active placement already exists for this asset and fixture")
        conn.execute("UPDATE fixture_asset_placements SET state = 'active', removed_at = NULL, updated_at = ? WHERE placement_id = ?", (timestamp, placement_id))
        conn.execute("INSERT INTO fixture_placement_events (event_id, placement_id, asset_id, to_fixture_id, action, actor, reason, created_at) VALUES (?, ?, ?, ?, 'restore', ?, ?, ?)", (f"evt-{uuid.uuid4().hex[:16]}", placement_id, row["asset_id"], row["fixture_id"], actor, reason, timestamp))
        conn.commit()
        return {"ok": True, "placementId": placement_id, "assetId": row["asset_id"], "fixtureId": row["fixture_id"], "state": "active"}


def editorial_version_hash(conn: sqlite3.Connection, asset_id: str) -> str:
    return sidecar_editorial_version_hash(conn, asset_id)


def _verified_upload_results(value: Any) -> tuple[list[dict[str, Any]], str]:
    results = _read_json(value, [])
    if not isinstance(results, list) or not results:
        return [], "no R2 upload results were recorded"
    verified: list[dict[str, Any]] = []
    for result in results:
        if not isinstance(result, dict):
            return [], "an R2 upload result is malformed"
        checksum = str(result.get("checksumSha256") or "")
        remote_checksum = str(result.get("remoteChecksumSha256") or "")
        local_md5 = str(result.get("checksumMd5") or "").strip().lower()
        remote_etag_md5 = str(result.get("remoteEtagMd5") or "").strip().lower()
        verification_method = str(result.get("verificationMethod") or "")
        checksum_verified = bool(checksum and remote_checksum == checksum)
        etag_verified = bool(
            verification_method == "etag-md5-content-length"
            and checksum
            and local_md5
            and remote_etag_md5 == local_md5
        )
        if (
            str(result.get("status") or "") != "uploaded"
            or not bool(result.get("remoteVerified"))
            or not (checksum_verified or etag_verified)
            or not str(result.get("key") or "")
        ):
            return [], "not every R2 upload result is checksum-verified"
        verified.append(result)
    return verified, ""


def plan_upload_run_adoption(
    repo_root: Path,
    run_id: str,
    fixture_id: str,
    *,
    historical_backfill: bool = False,
    revalidate_recorded_content: bool = False,
    asset_ids: Iterable[str] = (),
) -> dict[str, Any]:
    """Dry-run adoption of completed Upload Bridge rows into one explicit fixture."""
    selected_run_id = str(run_id or "").strip()
    selected_fixture_id = str(fixture_id or "").strip()
    if not selected_run_id:
        raise ValueError("upload run id is required")
    if not selected_fixture_id:
        raise ValueError("fixture id is required")
    selected_asset_ids = _unique(asset_ids)
    with connect(repo_root) as conn:
        run = conn.execute(
            "SELECT run_id, execute_upload, status, started_at, created_at FROM sidecar_upload_bridge_runs WHERE run_id = ?",
            (selected_run_id,),
        ).fetchone()
        if not run:
            raise ValueError("upload run does not exist")
        if not int(run["execute_upload"] or 0):
            raise ValueError("only a real upload run can be adopted")
        fixture = conn.execute(
            "SELECT fixture_id, name FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL",
            (selected_fixture_id,),
        ).fetchone()
        if not fixture:
            raise ValueError("destination fixture does not exist or is archived")
        breadcrumbs = fixture_breadcrumbs(conn, selected_fixture_id)
        run_started_at = str(run["started_at"] or run["created_at"] or "")
        asset_filter = ""
        params: list[Any] = [selected_run_id]
        if selected_asset_ids:
            asset_filter = f" AND i.asset_id IN ({','.join('?' for _ in selected_asset_ids)})"
            params.extend(selected_asset_ids)
        rows = conn.execute(
            f"""
            SELECT i.run_item_id, i.asset_id, i.photo_id, i.filename, i.status,
                   i.export_status, i.upload_status, i.planned_keys_json, i.upload_keys_json,
                   COALESCE(i.editorial_version_hash, '') captured_version_hash,
                   COALESCE(a.updated_at, '') asset_updated_at,
                   COALESCE(d.updated_at, '') decision_updated_at,
                   COALESCE(d.title, '') title,
                   COALESCE(d.keywords_json, '[]') keywords_json,
                   COALESCE(d.pick_state, 'undecided') pick_state,
                   COALESCE(d.metadata_state, 'unreviewed') metadata_state,
                   COALESCE(t.tombstone_state, '') tombstone_state
            FROM sidecar_upload_bridge_run_items i
            JOIN sidecar_assets a ON a.asset_id = i.asset_id
            LEFT JOIN sidecar_decisions d ON d.asset_id = i.asset_id
            LEFT JOIN sidecar_tombstones t
              ON t.asset_id = i.asset_id AND t.tombstone_state = 'active'
            WHERE i.run_id = ?
              AND i.status = 'uploaded'
              AND i.export_status = 'materialized'
              AND i.upload_status IN ('uploaded', 'uploaded_with_skips')
              {asset_filter}
            ORDER BY i.updated_at, i.run_item_id
            """,
            params,
        ).fetchall()
        total_row = conn.execute(
            "SELECT COUNT(*) total FROM sidecar_upload_bridge_run_items WHERE run_id = ?",
            (selected_run_id,),
        ).fetchone()
        eligible: list[dict[str, Any]] = []
        blocked: list[dict[str, Any]] = []
        for row in rows:
            reason = ""
            results, verification_error = _verified_upload_results(row["upload_keys_json"])
            planned = _read_json(row["planned_keys_json"], [])
            planned_pairs = {
                (str(item.get("bucket") or ""), str(item.get("key") or ""))
                for item in planned if isinstance(item, dict)
            }
            result_pairs = {
                (str(item.get("bucket") or ""), str(item.get("key") or ""))
                for item in results
            }
            current_version = editorial_version_hash(conn, row["asset_id"])
            historical = not bool(row["captured_version_hash"])
            retirement_keywords = {
                str(value).strip().casefold()
                for value in _read_json(row["keywords_json"], [])
                if str(value).strip()
            }
            ai_retired = any(value.startswith("ai generated") for value in retirement_keywords) or bool(
                retirement_keywords & {"generative ai", "ai artwork"}
            )
            stained_retired = any(value.startswith("stained") for value in retirement_keywords)
            if selected_fixture_id == "fixture-expo" and (ai_retired or stained_retired):
                reason = (
                    "AI-generated assets are retired from Expo"
                    if ai_retired
                    else "Stained assets are retired from Expo"
                )
            elif verification_error:
                reason = verification_error
            elif not planned_pairs or not planned_pairs.issubset(result_pairs):
                reason = "the uploaded R2 objects do not cover every planned key"
            elif row["pick_state"] != "picked" or row["metadata_state"] != "approved":
                reason = "asset is not both picked and metadata-approved"
            elif row["tombstone_state"] == "active":
                reason = "asset is tombstoned"
            elif historical and not historical_backfill:
                reason = "historical run requires explicit backfill acknowledgement"
            elif historical and (
                not run_started_at
                or str(row["asset_updated_at"] or "") > run_started_at
                or str(row["decision_updated_at"] or "") > run_started_at
            ) and not revalidate_recorded_content:
                reason = "editorial state changed after this historical run started"
            elif (
                not historical
                and row["captured_version_hash"] != current_version
                and not revalidate_recorded_content
            ):
                reason = "editorial state changed after upload planning"
            recorded_content_revalidated = bool(
                revalidate_recorded_content
                and (
                    historical
                    or row["captured_version_hash"] != current_version
                )
            )
            item = {
                "runItemId": row["run_item_id"],
                "assetId": row["asset_id"],
                "photoId": row["photo_id"] or "",
                "filename": row["filename"] or "",
                "title": row["title"] or "",
                "versionHash": current_version,
                "historicalBackfill": historical,
                "recordedContentRevalidated": recorded_content_revalidated,
                "capturedVersionHash": row["captured_version_hash"] or "",
                "uploadResults": results,
            }
            if reason:
                blocked.append({**item, "reason": reason})
            else:
                eligible.append(item)
    return {
        "ok": True,
        "mode": "dry-run",
        "runId": selected_run_id,
        "runStatus": str(run["status"] or ""),
        "fixtureId": selected_fixture_id,
        "fixtureName": fixture["name"],
        "fixtureBreadcrumbs": breadcrumbs,
        "totalRunItemCount": int(total_row["total"] or 0),
        "completedUploadCount": len(rows),
        "selectedAssetCount": len(selected_asset_ids) if selected_asset_ids else len(rows),
        "eligibleCount": len(eligible),
        "blockedCount": len(blocked),
        "historicalBackfill": historical_backfill,
        "revalidateRecordedContent": revalidate_recorded_content,
        "items": eligible,
        "blocked": blocked,
        "applied": False,
    }


def adopt_upload_run(
    repo_root: Path,
    run_id: str,
    fixture_id: str,
    *,
    historical_backfill: bool = False,
    revalidate_recorded_content: bool = False,
    asset_ids: Iterable[str] = (),
    actor: str = "owner",
) -> dict[str, Any]:
    """Adopt only verified completed run items, then reconstruct their R2 receipts."""
    plan = plan_upload_run_adoption(
        repo_root,
        run_id,
        fixture_id,
        historical_backfill=historical_backfill,
        revalidate_recorded_content=revalidate_recorded_content,
        asset_ids=asset_ids,
    )
    if plan["blockedCount"]:
        raise ValueError("upload run adoption is blocked; review the dry-run details")
    if not plan["eligibleCount"]:
        raise ValueError("upload run has no completed eligible items to adopt")
    timestamp = now_iso()
    placements: list[str] = []
    receipt_count = 0
    with connect(repo_root) as conn:
        fixture = conn.execute(
            "SELECT fixture_id FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL",
            (fixture_id,),
        ).fetchone()
        if not fixture:
            raise ValueError("destination fixture does not exist or is archived")
        for item in plan["items"]:
            existing = conn.execute(
                "SELECT placement_id FROM fixture_asset_placements WHERE fixture_id = ? AND asset_id = ? AND state = 'active'",
                (fixture_id, item["assetId"]),
            ).fetchone()
            if existing:
                placement_id = existing["placement_id"]
            else:
                placement_id = f"plc-{uuid.uuid4().hex[:16]}"
                conn.execute(
                    "INSERT INTO fixture_asset_placements (placement_id, fixture_id, asset_id, placed_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                    (placement_id, fixture_id, item["assetId"], timestamp, timestamp),
                )
                conn.execute(
                    """INSERT INTO fixture_placement_events
                       (event_id, placement_id, asset_id, to_fixture_id, action, actor, reason, created_at)
                       VALUES (?, ?, ?, ?, 'place', ?, ?, ?)""",
                    (
                        f"evt-{uuid.uuid4().hex[:16]}", placement_id, item["assetId"], fixture_id,
                        actor, f"Adopt verified Upload Bridge run {run_id}", timestamp,
                    ),
                )
            placements.append(placement_id)
            conn.execute(
                """
                INSERT INTO fixture_asset_destinations
                  (fixture_id, asset_id, destinations_json, version_hash, configured_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(fixture_id, asset_id) DO UPDATE SET
                  destinations_json = excluded.destinations_json,
                  version_hash = excluded.version_hash,
                  updated_at = excluded.updated_at
                """,
                (fixture_id, item["assetId"], _json(["r2", "apple_photos"]), item["versionHash"], timestamp, timestamp),
            )
            conn.execute(
                """INSERT OR IGNORE INTO fixture_delivery_receipts
                   (receipt_id, fixture_id, asset_id, destination, version_hash, status,
                    object_key, created_at, updated_at)
                   VALUES (?, ?, ?, 'apple_photos', ?, 'pending', '', ?, ?)""",
                (f"rcp-{uuid.uuid4().hex[:16]}", fixture_id, item["assetId"], item["versionHash"], timestamp, timestamp),
            )
            for result in item["uploadResults"]:
                record_delivery_receipt(
                    repo_root,
                    fixture_id=fixture_id,
                    asset_id=item["assetId"],
                    destination="r2",
                    version_hash=item["versionHash"],
                    status="verified",
                    object_key=str(result.get("key") or ""),
                    checksum_sha256=str(result.get("checksumSha256") or ""),
                    visibility_policy="public" if str(result.get("bucket") or "").endswith("public") else "private",
                    verification={
                        "source": "upload-bridge-adoption",
                        "runId": run_id,
                        "runItemId": item["runItemId"],
                        "historicalBackfill": bool(item["historicalBackfill"]),
                        "recordedContentRevalidated": bool(item["recordedContentRevalidated"]),
                        "capturedVersionHash": item["capturedVersionHash"],
                        "adoptedVersionHash": item["versionHash"],
                        "bucket": result.get("bucket"),
                        "bytes": result.get("bytes"),
                        "contentType": result.get("contentType"),
                        "remoteVerified": True,
                        "remoteChecksumSha256": result.get("remoteChecksumSha256"),
                        "verificationMethod": result.get("verificationMethod") or "sha256-download",
                        "checksumMd5": result.get("checksumMd5") or "",
                        "remoteEtagMd5": result.get("remoteEtagMd5") or "",
                    },
                    conn=conn,
                )
                receipt_count += 1
            if item["historicalBackfill"]:
                conn.execute(
                    "UPDATE sidecar_upload_bridge_run_items SET editorial_version_hash = ?, updated_at = ? WHERE run_item_id = ?",
                    (item["versionHash"], timestamp, item["runItemId"]),
                )
        conn.commit()
    return {
        **plan,
        "mode": "commit",
        "applied": True,
        "placementCount": len(placements),
        "placementIds": placements,
        "r2ReceiptCount": receipt_count,
        "destinations": ["r2", "apple_photos"],
    }


def configure_asset_destinations(repo_root: Path, fixture_id: str, asset_ids: Iterable[str], destinations: Iterable[str]) -> dict[str, Any]:
    selected = _unique(destinations)
    if not selected or any(item not in DESTINATIONS for item in selected):
        raise ValueError("destinations must use r2, apple_photos, or archive")
    timestamp = now_iso()
    clean_ids = _unique(asset_ids)
    with connect(repo_root) as conn:
        fixture_breadcrumbs(conn, fixture_id)
        for asset_id in clean_ids:
            version_hash = editorial_version_hash(conn, asset_id)
            conn.execute("""
              INSERT INTO fixture_asset_destinations (fixture_id, asset_id, destinations_json, version_hash, configured_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(fixture_id, asset_id) DO UPDATE SET destinations_json = excluded.destinations_json,
                version_hash = excluded.version_hash, updated_at = excluded.updated_at
            """, (fixture_id, asset_id, _json(selected), version_hash, timestamp, timestamp))
            for destination in selected:
                conn.execute("""
                  INSERT OR IGNORE INTO fixture_delivery_receipts
                    (receipt_id, fixture_id, asset_id, destination, version_hash, status, object_key, created_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, 'pending', '', ?, ?)
                """, (f"rcp-{uuid.uuid4().hex[:16]}", fixture_id, asset_id, destination, version_hash, timestamp, timestamp))
        conn.commit()
    return {"ok": True, "fixtureId": fixture_id, "assetCount": len(clean_ids), "destinations": selected}


def record_delivery_receipt(
    repo_root: Path,
    *,
    fixture_id: str,
    asset_id: str,
    destination: str,
    version_hash: str,
    status: str,
    object_key: str = "",
    checksum_sha256: str = "",
    visibility_policy: str = "",
    verification: dict[str, Any] | None = None,
    error_text: str = "",
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    if destination not in DESTINATIONS:
        raise ValueError("destination must use r2, apple_photos, or archive")
    if status not in {"pending", "running", "verified", "failed"}:
        raise ValueError("receipt status is invalid")
    if status == "verified" and not checksum_sha256:
        raise ValueError("verified receipts require a checksum")
    timestamp = now_iso()
    owns = conn is None
    conn = conn or connect(repo_root)
    try:
        if object_key:
            conn.execute(
                """DELETE FROM fixture_delivery_receipts
                   WHERE fixture_id = ? AND asset_id = ? AND destination = ?
                     AND version_hash = ? AND COALESCE(object_key, '') = ''""",
                (fixture_id, asset_id, destination, version_hash),
            )
        existing = conn.execute(
            """SELECT receipt_id FROM fixture_delivery_receipts
               WHERE fixture_id = ? AND asset_id = ? AND destination = ?
                 AND version_hash = ? AND COALESCE(object_key, '') = ?""",
            (fixture_id, asset_id, destination, version_hash, object_key),
        ).fetchone()
        receipt_id = existing["receipt_id"] if existing else f"rcp-{uuid.uuid4().hex[:16]}"
        conn.execute(
            """
            INSERT INTO fixture_delivery_receipts (
              receipt_id, fixture_id, asset_id, destination, version_hash, status,
              object_key, checksum_sha256, visibility_policy, verification_json,
              attempted_at, verified_at, error_text, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(fixture_id, asset_id, destination, version_hash, object_key)
            DO UPDATE SET status = excluded.status, checksum_sha256 = excluded.checksum_sha256,
              visibility_policy = excluded.visibility_policy,
              verification_json = excluded.verification_json,
              attempted_at = excluded.attempted_at, verified_at = excluded.verified_at,
              error_text = excluded.error_text, updated_at = excluded.updated_at
            """,
            (
                receipt_id, fixture_id, asset_id, destination, version_hash, status,
                object_key, checksum_sha256, visibility_policy, _json(verification or {}),
                timestamp, timestamp if status == "verified" else None, error_text,
                timestamp, timestamp,
            ),
        )
        if owns:
            conn.commit()
        return {
            "receiptId": receipt_id,
            "fixtureId": fixture_id,
            "assetId": asset_id,
            "destination": destination,
            "versionHash": version_hash,
            "status": status,
            "objectKey": object_key,
            "checksumSha256": checksum_sha256,
        }
    finally:
        if owns:
            conn.close()


def record_r2_upload_results(repo_root: Path, asset_id: str, upload_results: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Attach R2 results to active, R2-enabled placements at the configured editorial version."""
    results = [item for item in upload_results if isinstance(item, dict)]
    receipts: list[dict[str, Any]] = []
    with connect(repo_root) as conn:
        current_version = editorial_version_hash(conn, asset_id)
        rows = conn.execute(
            """
            SELECT p.fixture_id, x.version_hash, x.destinations_json
            FROM fixture_asset_placements p
            JOIN fixture_asset_destinations x
              ON x.fixture_id = p.fixture_id AND x.asset_id = p.asset_id
            WHERE p.asset_id = ? AND p.state = 'active'
            """,
            (asset_id,),
        ).fetchall()
        for row in rows:
            if "r2" not in _read_json(row["destinations_json"], []):
                continue
            if row["version_hash"] != current_version:
                continue
            for result in results:
                upload_status = str(result.get("status") or "failed")
                checksum = str(result.get("checksumSha256") or "")
                remote_checksum = str(result.get("remoteChecksumSha256") or "")
                verified = (
                    upload_status == "uploaded"
                    and bool(result.get("remoteVerified"))
                    and bool(checksum)
                    and remote_checksum == checksum
                )
                receipts.append(record_delivery_receipt(
                    repo_root,
                    fixture_id=row["fixture_id"],
                    asset_id=asset_id,
                    destination="r2",
                    version_hash=current_version,
                    status="verified" if verified else "failed",
                    object_key=str(result.get("key") or ""),
                    checksum_sha256=checksum,
                    visibility_policy="public" if str(result.get("bucket") or "").endswith("public") else "private",
                    verification={
                        "backend": result.get("backend"),
                        "bucket": result.get("bucket"),
                        "bytes": result.get("bytes"),
                        "contentType": result.get("contentType"),
                        "uploadStatus": upload_status,
                        "remoteVerified": bool(result.get("remoteVerified")),
                        "remoteChecksumSha256": remote_checksum,
                    },
                    error_text=str(result.get("error") or result.get("verificationError") or "remote R2 object was not checksum-verified") if not verified else "",
                    conn=conn,
                ))
        conn.commit()
    return {"ok": True, "assetId": asset_id, "receiptCount": len(receipts), "receipts": receipts}


def delivery_plan(repo_root: Path, fixture_id: str) -> dict[str, Any]:
    with connect(repo_root) as conn:
        breadcrumbs = fixture_breadcrumbs(conn, fixture_id)
        fixture = conn.execute("SELECT destination_defaults_json FROM fixtures WHERE fixture_id = ?", (fixture_id,)).fetchone()
        defaults = _read_json(fixture["destination_defaults_json"], ["r2"])
        rows = conn.execute("""
          SELECT p.asset_id, COALESCE(d.pick_state, 'undecided') pick_state,
                 COALESCE(d.metadata_state, 'unreviewed') metadata_state, x.destinations_json,
                 x.version_hash
          FROM fixture_asset_placements p
          LEFT JOIN sidecar_decisions d ON d.asset_id = p.asset_id
          LEFT JOIN fixture_asset_destinations x ON x.fixture_id = p.fixture_id AND x.asset_id = p.asset_id
          WHERE p.fixture_id = ? AND p.state = 'active'
          ORDER BY p.placed_at, p.asset_id
        """, (fixture_id,)).fetchall()
        items = []
        for row in rows:
            destinations = _read_json(row["destinations_json"], defaults)
            version_hash = row["version_hash"] or editorial_version_hash(conn, row["asset_id"])
            receipts = conn.execute("SELECT destination, status, object_key, checksum_sha256, verified_at, error_text FROM fixture_delivery_receipts WHERE fixture_id = ? AND asset_id = ? AND version_hash = ? ORDER BY updated_at", (fixture_id, row["asset_id"], version_hash)).fetchall()
            receipt_map: dict[str, dict[str, Any]] = {}
            for destination in destinations:
                destination_receipts = [dict(item) for item in receipts if item["destination"] == destination]
                actual = [item for item in destination_receipts if item.get("object_key")]
                destination_verified = bool(actual) and all(item.get("status") == "verified" for item in actual)
                errors = [str(item.get("error_text") or "") for item in destination_receipts if item.get("error_text")]
                receipt_map[destination] = {
                    "status": "verified" if destination_verified else ("failed" if errors else "pending"),
                    "items": destination_receipts,
                    "errorText": "; ".join(errors),
                }
            approved = row["pick_state"] == "picked" and row["metadata_state"] == "approved"
            complete = approved and all(receipt_map.get(destination, {}).get("status") == "verified" for destination in destinations)
            items.append({"assetId": row["asset_id"], "pickState": row["pick_state"], "metadataState": row["metadata_state"], "approved": approved, "destinations": destinations, "versionHash": version_hash, "receipts": receipt_map, "complete": complete})
    return {"ok": True, "fixtureId": fixture_id, "breadcrumbs": breadcrumbs, "assetCount": len(items), "approvedCount": sum(item["approved"] for item in items), "completeCount": sum(item["complete"] for item in items), "items": items, "clientMessageSent": False}


def migrate_la_concha_tree(repo_root: Path) -> dict[str, Any]:
    with connect(repo_root) as conn:
        existing_root = conn.execute("SELECT * FROM fixtures WHERE fixture_id = ?", ("fixture-la-concha",)).fetchone()
        root = _fixture_row(existing_root) if existing_root else create_fixture(repo_root, "La Concha", fixture_id="fixture-la-concha", tags=["real-estate"], template_key="real-estate", access_gallery_key="la-concha", legacy_identity={"track": "RE", "fixture": "La Concha"}, conn=conn)
        apartment_1 = create_fixture(repo_root, "Apartment 1", parent_fixture_id=root["fixtureId"], fixture_id="fixture-la-concha-apartment-1", conn=conn)
        apartment_2 = create_fixture(repo_root, "Apartment 2", parent_fixture_id=root["fixtureId"], fixture_id="fixture-la-concha-apartment-2", conn=conn)
        common = create_fixture(repo_root, "Common", parent_fixture_id=root["fixtureId"], fixture_id="fixture-la-concha-common", conn=conn)
        children = [create_fixture(repo_root, name, parent_fixture_id=common["fixtureId"], fixture_id=f"fixture-la-concha-{_slug(name)}", conn=conn) for name in ("Street", "Main lobby", "Pool", "Tennis court")]
        conn.commit()
    access_grant = link_access_grant(
        repo_root,
        root["fixtureId"],
        provider="acs",
        external_identity="gallery:la-concha:client:corine",
        subject_label="Corine",
        recovery={"galleryKey": "la-concha", "livePolicyChanged": False, "clientMessageSent": False},
    )
    return {"ok": True, "root": root, "apartments": [apartment_1, apartment_2], "common": common, "commonChildren": children, "accessGrant": access_grant, "tree": fixture_tree(repo_root)}


def migrate_access_fixture_tree(repo_root: Path) -> dict[str, Any]:
    """Converge universal fixtures on the public Expo/Travel and private RE policy."""
    with connect(repo_root) as conn:
        expo = create_fixture(
            repo_root,
            "Expo",
            fixture_id="fixture-expo",
            tags=["public"],
            access_gallery_key="expo",
            legacy_identity={"track": "Expo"},
            conn=conn,
        )
        real_estate = create_fixture(
            repo_root,
            "RE",
            fixture_id="fixture-re",
            tags=["real-estate", "private"],
            template_key="real-estate",
            legacy_identity={"track": "RE"},
            conn=conn,
        )
        travel = create_fixture(
            repo_root,
            "Travel",
            fixture_id="fixture-travel",
            tags=["public", "travel"],
            access_gallery_key="travel",
            legacy_identity={"track": "Travel"},
            conn=conn,
        )
        conn.commit()

    la_concha = migrate_la_concha_tree(repo_root)["root"]
    move_fixture(repo_root, la_concha["fixtureId"], real_estate["fixtureId"])
    timestamp = now_iso()
    corine_identity = "corine.bn2007@yahoo.fr"
    with connect(repo_root) as conn:
        conn.execute(
            "UPDATE fixtures SET access_gallery_key = ?, updated_at = ? WHERE fixture_id = ?",
            ("corine-real-estate", timestamp, la_concha["fixtureId"]),
        )
        conn.execute(
            "UPDATE fixture_access_grants SET state = 'revoked', updated_at = ? WHERE fixture_id = ? AND external_identity <> ? AND state = 'active'",
            (timestamp, la_concha["fixtureId"], corine_identity),
        )
        conn.execute(
            "UPDATE fixtures SET archived_at = ?, updated_at = ? WHERE fixture_id = ? AND archived_at IS NULL",
            (timestamp, timestamp, "fixture-universal-parity-rehearsal"),
        )
        conn.commit()
    grant = link_access_grant(
        repo_root,
        la_concha["fixtureId"],
        provider="acs",
        external_identity=corine_identity,
        subject_label="Corine",
        recovery={
            "galleryKey": "corine-real-estate",
            "inheritToDescendants": True,
            "rootReGrant": False,
            "livePolicyChanged": True,
            "clientMessageSent": False,
        },
    )
    return {
        "ok": True,
        "publicRoots": [expo, travel],
        "privateRoot": real_estate,
        "exclusiveFixture": la_concha,
        "accessGrant": grant,
        "tree": fixture_tree(repo_root),
    }
