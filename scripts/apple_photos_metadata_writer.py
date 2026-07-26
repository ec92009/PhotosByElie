#!/usr/bin/env python3
"""Verified Apple Photos metadata give-back for approved and tombstoned assets.

The default operation is a dry-run. Commit is explicit and preserves unrelated
keywords. Fixture-local placement never leaves Owner.sqlite: Photos receives
only canonical approved metadata and the global PBE lifecycle markers.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
from typing import Any, Iterable, Protocol
import uuid

from fixture_pipeline import connect, editorial_version_hash, now_iso, record_delivery_receipt
from native_publication_pipeline import metadata_fingerprint


MANAGED_PREFIXES = ("PBE:Rating:", "PBE:Color:", "PBE-Rating-", "PBE-Color-", "PBE-Fixture-ID:")
MANAGED_EXACT = {"PBE:Approved", "PBE:Tombstone", "PBE-Approved"}


class PhotosMetadataAccess(Protocol):
    def read(self, asset_id: str) -> dict[str, Any]: ...
    def write(self, asset_id: str, title: str, caption: str, keywords: list[str]) -> None: ...


def _run_jxa(source: str, *args: str, timeout: float = 60) -> str:
    result = subprocess.run(
        ["osascript", "-l", "JavaScript", "-e", source, *args],
        check=False,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or "Apple Photos automation failed").strip())
    return result.stdout.strip()


class ApplePhotosAdapter:
    """Legacy in-process adapter retained only for isolated compatibility tests."""
    _READ = r"""
function run(argv) {
  const photos = Application('Photos');
  const id = String(argv[0] || '');
  const item = photos.mediaItems.byId(id);
  if (item.id() !== id) throw new Error(`Apple Photos asset not found: ${id}`);
  return JSON.stringify({title: item.name() || '', caption: item.description() || '', keywords: item.keywords() || []});
}
"""
    _WRITE = r"""
function run(argv) {
  const photos = Application('Photos');
  const id = String(argv[0] || '');
  const payload = JSON.parse(String(argv[1] || '{}'));
  const item = photos.mediaItems.byId(id);
  if (item.id() !== id) throw new Error(`Apple Photos asset not found: ${id}`);
  item.name = String(payload.title || '');
  item.description = String(payload.caption || '');
  item.keywords = Array.isArray(payload.keywords) ? payload.keywords.map(String) : [];
  return 'ok';
}
"""
    _APPLY = r"""
function run(argv) {
  const photos = Application('Photos');
  const id = String(argv[0] || '');
  const payload = JSON.parse(String(argv[1] || '{}'));
  const item = photos.mediaItems.byId(id);
  if (item.id() !== id) throw new Error(`Apple Photos asset not found: ${id}`);
  const before = {
    title: item.name() || '',
    caption: item.description() || '',
    keywords: item.keywords() || [],
  };
  const desired = Array.isArray(payload.keywords) ? payload.keywords.map(String) : [];
  const managed = Array.isArray(payload.managedKeywords) ? payload.managedKeywords.map(String) : [];
  const managedSet = new Set(managed);
  const isManaged = value =>
    value === 'PBE:Approved' ||
    value === 'PBE:Tombstone' ||
    value === 'PBE-Approved' ||
    value.startsWith('PBE:Rating:') ||
    value.startsWith('PBE:Color:') ||
    value.startsWith('PBE-Rating-') ||
    value.startsWith('PBE-Color-') ||
    value.startsWith('PBE-Fixture-ID:');
  const keywords = [];
  const seen = new Set();
  [...before.keywords.map(String), ...desired, ...managed].forEach(value => {
    const clean = String(value || '').trim();
    const key = clean.toLocaleLowerCase();
    if (!clean || seen.has(key) || (isManaged(clean) && !managedSet.has(clean))) return;
    seen.add(key);
    keywords.push(clean);
  });
  item.name = String(payload.title || '');
  item.description = String(payload.caption || '');
  item.keywords = keywords;
  const after = {
    title: item.name() || '',
    caption: item.description() || '',
    keywords: item.keywords() || [],
  };
  return JSON.stringify({before: before, after: after, keywords: keywords});
}
"""
    _APPLY_MANY = r"""
function run(argv) {
  const photos = Application('Photos');
  const requests = JSON.parse(String(argv[0] || '[]'));
  const managedPrefixes = ['PBE:Rating:', 'PBE:Color:', 'PBE-Rating-', 'PBE-Color-', 'PBE-Fixture-ID:'];
  const applyOne = payload => {
    const id = String(payload.assetId || '');
    try {
      const item = photos.mediaItems.byId(id);
      if (item.id() !== id) throw new Error(`Apple Photos asset not found: ${id}`);
      const before = {
        title: item.name() || '',
        caption: item.description() || '',
        keywords: item.keywords() || [],
      };
      const desired = Array.isArray(payload.keywords) ? payload.keywords.map(String) : [];
      const managed = Array.isArray(payload.managedKeywords) ? payload.managedKeywords.map(String) : [];
      const managedSet = new Set(managed);
      const isManaged = value =>
        value === 'PBE:Approved' ||
        value === 'PBE:Tombstone' ||
        value === 'PBE-Approved' ||
        managedPrefixes.some(prefix => value.startsWith(prefix));
      const keywords = [];
      const seen = new Set();
      [...before.keywords.map(String), ...desired, ...managed].forEach(value => {
        const clean = String(value || '').trim();
        const key = clean.toLocaleLowerCase();
        if (!clean || seen.has(key) || (isManaged(clean) && !managedSet.has(clean))) return;
        seen.add(key);
        keywords.push(clean);
      });
      item.name = String(payload.title || '');
      item.description = String(payload.caption || '');
      item.keywords = keywords;
      const after = {
        title: item.name() || '',
        caption: item.description() || '',
        keywords: item.keywords() || [],
      };
      return {assetId: id, before: before, after: after, keywords: keywords};
    } catch (error) {
      return {assetId: id, error: String(error)};
    }
  };
  return JSON.stringify(requests.map(applyOne));
}
"""

    def read(self, asset_id: str) -> dict[str, Any]:
        payload = json.loads(_run_jxa(self._READ, asset_id) or "{}")
        return {
            "title": str(payload.get("title") or ""),
            "caption": str(payload.get("caption") or ""),
            "keywords": [str(item) for item in payload.get("keywords") or [] if str(item).strip()],
        }

    def write(self, asset_id: str, title: str, caption: str, keywords: list[str]) -> None:
        _run_jxa(self._WRITE, asset_id, json.dumps({"title": title, "caption": caption, "keywords": keywords}, ensure_ascii=False))

    def apply(self, asset_id: str, title: str, caption: str, keywords: list[str], managed_keywords: list[str]) -> dict[str, Any]:
        """Write and reread one Photos item in a single automation transaction."""
        payload = json.loads(
            _run_jxa(
                self._APPLY,
                asset_id,
                json.dumps(
                    {
                        "title": title,
                        "caption": caption,
                        "keywords": keywords,
                        "managedKeywords": managed_keywords,
                    },
                    ensure_ascii=False,
                ),
            )
            or "{}"
        )
        return {
            "before": payload.get("before") or {},
            "after": payload.get("after") or {},
            "keywords": [str(value) for value in payload.get("keywords") or []],
        }

    def apply_many(self, requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Apply a verified metadata batch in one Photos automation process."""
        payload = json.loads(
            _run_jxa(
                self._APPLY_MANY,
                json.dumps(requests, ensure_ascii=False),
                timeout=max(60, len(requests) * 6),
            )
            or "[]"
        )
        return [dict(item) for item in payload]


class SignedPhotosBridgeAdapter:
    """Read and write metadata through the stable signed Photos Bridge app."""

    def __init__(self, repo_root: Path):
        self.repo_root = repo_root.resolve()

    def _run(self, command: str, requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
        from sidecar_server import _run_apple_photos_bridge_app_task

        input_path = (
            self.repo_root
            / "tmp"
            / "sidecar-bridge-input"
            / f"metadata-{uuid.uuid4().hex}.json"
        )
        input_path.parent.mkdir(parents=True, exist_ok=True)
        input_path.write_text(json.dumps(requests, ensure_ascii=False), encoding="utf-8")
        try:
            result = _run_apple_photos_bridge_app_task(
                self.repo_root,
                [command, "--input", str(input_path)],
                timeout=max(60, len(requests) * 6),
            )
        finally:
            input_path.unlink(missing_ok=True)
        if not result.get("ok"):
            raise RuntimeError(
                str(result.get("error") or result.get("code") or "Signed Photos Bridge failed.")
            )
        items = result.get("items")
        if not isinstance(items, list):
            raise RuntimeError("Signed Photos Bridge returned no metadata item receipts.")
        return [dict(item) for item in items if isinstance(item, dict)]

    def read_many(self, requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self._run("metadata-read-many", requests)

    def read(self, asset_id: str) -> dict[str, Any]:
        rows = self.read_many([{"assetId": asset_id}])
        if not rows:
            raise RuntimeError(f"Signed Photos Bridge returned no metadata for {asset_id}")
        row = rows[0]
        if row.get("error"):
            raise RuntimeError(str(row["error"]))
        return {
            "title": str(row.get("title") or ""),
            "caption": str(row.get("caption") or ""),
            "keywords": [str(item) for item in row.get("keywords") or [] if str(item).strip()],
        }

    def write(self, asset_id: str, title: str, caption: str, keywords: list[str]) -> None:
        raise RuntimeError("Single-item direct writes are disabled; use signed batch apply.")

    def apply_many(self, requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return self._run("metadata-apply-many", requests)


def _is_managed(keyword: str) -> bool:
    return keyword in MANAGED_EXACT or keyword.startswith(MANAGED_PREFIXES)


def merge_keywords(existing: Iterable[str], desired: Iterable[str], managed: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in [*(str(item) for item in existing), *(str(item) for item in desired), *(str(item) for item in managed)]:
        clean = value.strip()
        key = clean.casefold()
        if not clean or key in seen or (_is_managed(clean) and clean not in managed):
            continue
        seen.add(key)
        result.append(clean)
    return result


def writeback_plan(
    repo_root: Path,
    fixture_id: str = "",
    asset_ids: Iterable[str] = (),
    *,
    adapter: PhotosMetadataAccess | None = None,
) -> dict[str, Any]:
    requested_ids = [str(item).strip() for item in asset_ids if str(item).strip()]
    params: list[Any] = []
    where = [
        """(
          editorial.editorial_state = 'approved'
          OR EXISTS (
            SELECT 1 FROM sidecar_tombstones AS tombstone
            WHERE tombstone.asset_id = a.asset_id
              AND tombstone.tombstone_state = 'active'
          )
        )"""
    ]
    if fixture_id:
        where.append(
            """EXISTS (
              SELECT 1 FROM fixture_asset_decisions AS scoped
              WHERE scoped.fixture_id = ?
                AND scoped.asset_id = a.asset_id
                AND scoped.eligibility_state = 'active'
                AND scoped.placement_state = 'picked'
            )"""
        )
        params.append(fixture_id)
    if requested_ids:
        where.append(f"a.asset_id IN ({','.join('?' for _ in requested_ids)})")
        params.extend(requested_ids)
    with connect(repo_root) as conn:
        rows = conn.execute(
            f"""
            SELECT a.asset_id,
                   editorial.editorial_state,
                   CASE WHEN EXISTS (
                     SELECT 1 FROM sidecar_tombstones AS tombstone
                     WHERE tombstone.asset_id = a.asset_id
                       AND tombstone.tombstone_state = 'active'
                   ) THEN 1 ELSE 0 END tombstoned,
                   COALESCE(d.title, '') title, COALESCE(d.caption, '') caption,
                   COALESCE(d.keywords_json, '[]') keywords_json,
                   COALESCE(d.rating, 0) rating, COALESCE(d.color, '') color,
                   COALESCE(a.raw_json, '{{}}') raw_json
            FROM sidecar_assets AS a
            JOIN asset_editorial_state AS editorial
              ON editorial.asset_id = a.asset_id
            LEFT JOIN sidecar_decisions d ON d.asset_id = a.asset_id
            WHERE {' AND '.join(where)}
            ORDER BY a.asset_id
            """,
            params,
        ).fetchall()
        grouped: dict[str, dict[str, Any]] = {}
        blocked: list[dict[str, Any]] = []
        for row in rows:
            current_version = editorial_version_hash(conn, row["asset_id"])
            fixture_rows = conn.execute(
                """
                SELECT decision.fixture_id, fixture.name
                FROM fixture_asset_decisions AS decision
                JOIN fixtures AS fixture ON fixture.fixture_id = decision.fixture_id
                WHERE decision.asset_id = ?
                  AND decision.eligibility_state = 'active'
                  AND decision.placement_state = 'picked'
                  AND fixture.archived_at IS NULL
                ORDER BY fixture.fixture_id
                """,
                (row["asset_id"],),
            ).fetchall()
            approved = str(row["editorial_state"]) == "approved"
            item = grouped.setdefault(row["asset_id"], {
                "assetId": row["asset_id"], "versionHash": current_version,
                "photosAssetId": str(json.loads(row["raw_json"] or "{}").get("localIdentifier") or row["asset_id"]),
                "approved": approved,
                "tombstoned": bool(row["tombstoned"]),
                "title": row["title"] if approved else "",
                "caption": row["caption"] if approved else "",
                "keywords": json.loads(row["keywords_json"] or "[]") if approved else [],
                "rating": int(row["rating"] or 0), "color": row["color"] or "",
                "fixtureIds": [str(value["fixture_id"]) for value in fixture_rows],
                "fixtureNames": [str(value["name"]) for value in fixture_rows],
            })
        for item in grouped.values():
            managed: list[str] = []
            if item["approved"]:
                managed.append("PBE:Approved")
                if 1 <= item["rating"] <= 5:
                    managed.append(f"PBE:Rating:{item['rating']}")
                clean_color = str(item["color"] or "").strip().casefold()
                if clean_color in {"red", "yellow", "green", "blue"}:
                    managed.append(f"PBE:Color:{clean_color.title()}")
            if item["tombstoned"]:
                managed.append("PBE:Tombstone")
            item["managedKeywords"] = managed
            item["intendedMetadata"] = {
                "title": item["title"],
                "caption": item["caption"],
                "keywords": [*item["keywords"], *managed],
            }
        current_rows: dict[str, dict[str, Any]] = {}
        if adapter is not None and callable(read_many := getattr(adapter, "read_many", None)) and grouped:
            try:
                current_rows = {
                    str(row.get("assetId") or ""): row
                    for row in read_many([
                        {"assetId": item["photosAssetId"]}
                        for item in grouped.values()
                    ])
                    if isinstance(row, dict)
                }
            except Exception as error:  # noqa: BLE001 - the dry-run remains non-mutating.
                current_rows = {
                    item["photosAssetId"]: {"error": str(error)}
                    for item in grouped.values()
                }
        for item in grouped.values():
            if adapter is not None:
                try:
                    current = current_rows.get(item["photosAssetId"])
                    if current and current.get("error"):
                        raise RuntimeError(str(current["error"]))
                    before = {
                        "title": str(current.get("title") or ""),
                        "caption": str(current.get("caption") or ""),
                        "keywords": [str(value) for value in current.get("keywords") or []],
                    } if current is not None else adapter.read(item["photosAssetId"])
                    if not item["approved"]:
                        item["title"] = str(before.get("title") or "")
                        item["caption"] = str(before.get("caption") or "")
                        item["keywords"] = [
                            str(value)
                            for value in before.get("keywords") or []
                            if not _is_managed(str(value))
                        ]
                    after_keywords = merge_keywords(
                        before.get("keywords") or [],
                        item["keywords"],
                        item["managedKeywords"],
                    )
                    after = {"title": item["title"], "caption": item["caption"], "keywords": after_keywords}
                    item["currentMetadata"] = before
                    item["intendedMetadata"] = after
                    item["changes"] = {
                        field: {"before": before.get(field), "after": after.get(field)}
                        for field in ("title", "caption", "keywords")
                        if before.get(field) != after.get(field)
                    }
                    item["changedFields"] = list(item["changes"])
                except Exception as error:  # noqa: BLE001 - dry-run remains non-mutating and auditable.
                    item["currentReadError"] = str(error)
    return {"ok": True, "mode": "dry-run", "count": len(grouped), "blockedCount": len(blocked), "items": list(grouped.values()), "blocked": blocked}


def commit_writeback(
    repo_root: Path,
    fixture_id: str = "",
    asset_ids: Iterable[str] = (),
    *,
    adapter: PhotosMetadataAccess | None = None,
) -> dict[str, Any]:
    adapter = adapter or SignedPhotosBridgeAdapter(repo_root)
    plan = writeback_plan(repo_root, fixture_id, asset_ids, adapter=adapter)
    written: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    bulk_results: dict[str, dict[str, Any]] = {}
    apply_many = getattr(adapter, "apply_many", None)
    if callable(apply_many) and plan["items"]:
        requests = [
            {
                "assetId": item["photosAssetId"],
                "title": item["title"],
                "caption": item["caption"],
                "keywords": item["keywords"],
                "managedKeywords": item["managedKeywords"],
            }
            for item in plan["items"]
        ]
        try:
            bulk_results = {str(result.get("assetId") or ""): result for result in apply_many(requests)}
        except Exception as error:  # noqa: BLE001 - all items remain independently retryable.
            bulk_results = {
                item["photosAssetId"]: {"assetId": item["photosAssetId"], "error": str(error)}
                for item in plan["items"]
            }
    for item in plan["items"]:
        try:
            bulk = bulk_results.get(item["photosAssetId"])
            if bulk is not None:
                if bulk.get("error"):
                    raise RuntimeError(str(bulk["error"]))
                before = bulk.get("before") or {}
                after = bulk.get("after") or {}
                keywords = [str(value) for value in bulk.get("keywords") or []]
            elif callable(apply := getattr(adapter, "apply", None)):
                applied = apply(
                    item["photosAssetId"], item["title"], item["caption"],
                    item["keywords"], item["managedKeywords"],
                )
                before = applied["before"]
                after = applied["after"]
                keywords = applied["keywords"]
            else:
                before = adapter.read(item["photosAssetId"])
                keywords = merge_keywords(before.get("keywords") or [], item["keywords"], item["managedKeywords"])
                adapter.write(item["photosAssetId"], item["title"], item["caption"], keywords)
                after = adapter.read(item["photosAssetId"])
            expected = {value.casefold() for value in keywords}
            actual = {str(value).casefold() for value in after.get("keywords") or []}
            if after.get("title") != item["title"] or after.get("caption") != item["caption"] or not expected.issubset(actual):
                raise RuntimeError("Apple Photos metadata did not verify after write")
            payload_hash = metadata_fingerprint(
                item["title"],
                item["caption"],
                keywords,
            )
            timestamp = now_iso()
            with connect(repo_root) as conn:
                for target_fixture_id in item["fixtureIds"]:
                    record_delivery_receipt(
                        repo_root, fixture_id=target_fixture_id, asset_id=item["assetId"],
                        destination="apple_photos", version_hash=item["versionHash"], status="verified",
                        object_key=f"apple-photos://{item['assetId']}", checksum_sha256=payload_hash,
                        visibility_policy="local-library", verification={"before": before, "after": after}, conn=conn,
                    )
                conn.execute(
                    """
                    INSERT INTO asset_sync_state (
                      asset_id, photos_asset_id, last_giveback_fingerprint,
                      last_giveback_at, last_error, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, '', ?, ?)
                    ON CONFLICT(asset_id) DO UPDATE SET
                      photos_asset_id = excluded.photos_asset_id,
                      last_giveback_fingerprint = excluded.last_giveback_fingerprint,
                      last_giveback_at = excluded.last_giveback_at,
                      last_error = '',
                      updated_at = excluded.updated_at
                    """,
                    (
                        item["assetId"],
                        item["photosAssetId"],
                        payload_hash,
                        timestamp,
                        timestamp,
                        timestamp,
                    ),
                )
                conn.execute(
                    """UPDATE sidecar_pending_sync SET status = 'committed', error_text = NULL, updated_at = datetime('now')
                       WHERE asset_id = ? AND status = 'pending'""",
                    (item["assetId"],),
                )
                conn.commit()
            written.append({"assetId": item["assetId"], "fixtureIds": item["fixtureIds"], "checksumSha256": payload_hash})
        except Exception as error:  # noqa: BLE001 - each item stays independently retryable.
            failed.append({"assetId": item["assetId"], "error": str(error)})
            with connect(repo_root) as conn:
                timestamp = now_iso()
                conn.execute(
                    """
                    INSERT INTO asset_sync_state (
                      asset_id, photos_asset_id, last_error, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(asset_id) DO UPDATE SET
                      photos_asset_id = excluded.photos_asset_id,
                      last_error = excluded.last_error,
                      updated_at = excluded.updated_at
                    """,
                    (
                        item["assetId"],
                        item.get("photosAssetId", ""),
                        str(error),
                        timestamp,
                        timestamp,
                    ),
                )
                conn.execute(
                    """UPDATE sidecar_pending_sync SET status = 'failed', error_text = ?, updated_at = datetime('now')
                       WHERE asset_id = ? AND status = 'pending'""",
                    (str(error), item["assetId"]),
                )
                conn.commit()
    return {"ok": not failed, "mode": "commit", "writtenCount": len(written), "failedCount": len(failed), "written": written, "failed": failed, "blocked": plan["blocked"]}


def main() -> None:
    parser = argparse.ArgumentParser(description="Plan or commit verified fixture metadata to Apple Photos.")
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--fixture-id", default="")
    parser.add_argument("--asset-id", action="append", default=[])
    parser.add_argument("--commit", action="store_true")
    args = parser.parse_args()
    result = commit_writeback(args.repo_root, args.fixture_id, args.asset_id) if args.commit else writeback_plan(
        args.repo_root,
        args.fixture_id,
        args.asset_id,
        adapter=SignedPhotosBridgeAdapter(args.repo_root),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
