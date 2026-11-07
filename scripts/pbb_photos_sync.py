"""PBB's private Apple Photos consumer cursor. Never writes Apple Photos state.

The existing source importer remains the metadata writer. Its successful source
batches may replay after a failure; only a complete scan can commit this cursor.
"""
from __future__ import annotations

import json
from pathlib import Path

PREFIX = "photos.pbb-sync.v1:"


def _saved_token(value):
    token = value.get("token") if isinstance(value, dict) and value.get("schemaVersion") == 1 else None
    return token if isinstance(token, str) and token else None


class ScanReceipt:
    """Validate one snapshot's pages and retain only bounded identity metadata."""
    def __init__(self, root: Path, session: str):
        from sidecar_state_db import connect
        self.session = session
        self.known = set()
        self.locals = {}
        self.removed = set()
        self.recovered = set()
        self.report = {}
        with connect(root) as conn:
            for row in conn.execute("SELECT asset_id,raw_json FROM sidecar_assets WHERE source_anchor LIKE 'apple-photos%'"):
                self.known.add(row["asset_id"])
                local = json.loads(row["raw_json"] or "{}").get("localIdentifier")
                if local:
                    self.locals.setdefault(local, set()).add(row["asset_id"])

    def accept(self, payload: dict, rows: list[dict], offset: int, limit: int) -> int:
        end = payload.get("nextOffset")
        total = payload.get("totalCount")
        if (payload.get("syncSession") != self.session or not payload.get("nextChangeToken")
                or not isinstance(end, int) or not isinstance(total, int)
                or not offset <= end <= min(offset + limit, total)
                or not isinstance(payload.get("hasMore"), bool)
                or payload["hasMore"] != (end < total) or (payload["hasMore"] and end == offset)):
            raise ValueError("PBB Photos sync returned an invalid snapshot page")
        if self.report and any(payload.get(key) != self.report[key] for key in ("nextChangeToken", "syncBaseline", "totalCount")):
            raise ValueError("PBB Photos sync snapshot changed between pages")
        for row in rows:
            # Cloud identity is authoritative; don't merge distinct clouds
            # merely because historical local IDs or filenames happen to match.
            local = row.get("localIdentifier")
            candidates = self.locals.get(local, set())
            if row.get("assetId") == local and len(candidates) == 1:
                row["assetId"] = next(iter(candidates))
            if row.get("assetId") not in self.known:
                self.recovered.add(row["assetId"])
        self.removed.update(payload.get("removedLocalIdentifiers") or [])
        self.report = {key: payload[key] for key in
                       ("syncSession", "nextChangeToken", "syncBaseline", "scannedCount", "totalCount")}
        self.report.update(syncComplete=not payload["hasMore"], removedLocalIdentifiers=sorted(self.removed),
                           recoveredCount=len(self.recovered))
        return end


def checkpoint(root: Path, consumer: str) -> dict:
    from sidecar_state_db import connect
    with connect(root) as conn:
        row = conn.execute("SELECT setting_value FROM owner_settings WHERE setting_key=?", (PREFIX + consumer,)).fetchone()
    try:
        value = json.loads(row[0]) if row else {}
        return value if _saved_token(value) else {}
    except (TypeError, ValueError):
        return {}


def _mark_removed(conn, consumer: str, removed: set[str], now: str) -> int:
    # Resolve the identity projection ONCE. An OR/json_extract scan per absent
    # RAW would turn a large first inventory into billions of row inspections
    # while holding the writer lock. Mutations below use the asset primary key.
    assets = set()
    for row in conn.execute("SELECT asset_id,raw_json FROM sidecar_assets WHERE source_anchor LIKE 'apple-photos%'"):
        local = json.loads(row["raw_json"] or "{}").get("localIdentifier")
        if row["asset_id"] in removed or local in removed:
            assets.add(row["asset_id"])
    missing = 0
    ids = sorted(assets)
    for start in range(0, len(ids), 500):
        batch = ids[start:start + 500]
        marks = ",".join("?" for _ in batch)
        changed = conn.execute(f"""UPDATE sidecar_assets SET missing_at=?,updated_at=?
            WHERE asset_id IN ({marks}) AND COALESCE(missing_at,'')=''""", [now, now, *batch])
        missing += changed.rowcount
    conn.executemany("DELETE FROM pbb_photos_sync_members WHERE consumer=? AND local_identifier=?",
                     [(consumer, local) for local in removed])
    return missing


def complete(root: Path, consumer: str, previous_token: str | None, path: Path, report: dict) -> dict:
    from sidecar_state_db import connect, now_iso
    if not consumer or not report.get("syncComplete") or not report.get("nextChangeToken"):
        raise ValueError("Incomplete PBB Photos sync cannot advance its checkpoint")
    now = now_iso()
    with connect(root) as conn:
        # A concurrent PBB job may have completed while this snapshot scanned.
        # Never replace its newer cursor with this job's older one.
        conn.execute("BEGIN IMMEDIATE")
        row = conn.execute("SELECT setting_value FROM owner_settings WHERE setting_key=?", (PREFIX + consumer,)).fetchone()
        try:
            saved_token = _saved_token(json.loads(row[0])) if row else None
        except (TypeError, ValueError):
            saved_token = None
        if saved_token != previous_token:
            raise ValueError("PBB Photos checkpoint changed during sync; retry from the saved checkpoint")
        conn.execute("""CREATE TABLE IF NOT EXISTS pbb_photos_sync_members (
            consumer TEXT NOT NULL, local_identifier TEXT NOT NULL, asset_id TEXT NOT NULL,
            PRIMARY KEY(consumer,local_identifier)) WITHOUT ROWID""")
        present = {}
        with path.open(encoding="utf-8") as stream:
            for line in stream:
                source = json.loads(line)
                if source.get("localIdentifier") and source.get("assetId"):
                    present[source["localIdentifier"]] = source["assetId"]
        removed = set(report.get("removedLocalIdentifiers") or [])
        if report.get("syncBaseline"):
            owned = conn.execute("SELECT local_identifier FROM pbb_photos_sync_members WHERE consumer=?", (consumer,))
            removed.update(row[0] for row in owned if row[0] not in present)
        missing = _mark_removed(conn, consumer, removed - present.keys(), now) if removed else 0
        conn.executemany("""INSERT INTO pbb_photos_sync_members VALUES (?,?,?)
            ON CONFLICT(consumer,local_identifier) DO UPDATE SET asset_id=excluded.asset_id""",
            [(consumer, local, asset) for local, asset in present.items()])
        value = dict(schemaVersion=1, token=report["nextChangeToken"], completedAt=now,
                     baseline=bool(report.get("syncBaseline")), scannedCount=report.get("scannedCount", 0),
                     importedCount=report.get("count", 0), recoveredCount=report.get("recoveredCount", 0))
        conn.execute("""INSERT INTO owner_settings VALUES (?,?,?) ON CONFLICT(setting_key)
            DO UPDATE SET setting_value=excluded.setting_value,updated_at=excluded.updated_at""",
            (PREFIX + consumer, json.dumps(value, separators=(",", ":")), now))
    return dict({key: item for key, item in value.items() if key != "token"}, missingMarkedCount=missing)
