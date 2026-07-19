#!/usr/bin/env python3
"""Verified Apple Photos metadata give-back for fixture-delivered assets.

The default operation is a dry-run.  Commit is explicit, preserves unrelated
keywords, and is gated on verified R2 delivery for the same editorial version.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from typing import Any, Iterable, Protocol

from fixture_pipeline import editorial_version_hash, record_delivery_receipt
from sidecar_state_db import connect


MANAGED_PREFIXES = ("PBE-Rating-", "PBE-Color-", "PBE-Fixture-ID:")
MANAGED_EXACT = {"PBE-Approved"}


class PhotosMetadataAccess(Protocol):
    def read(self, asset_id: str) -> dict[str, Any]: ...
    def write(self, asset_id: str, title: str, caption: str, keywords: list[str]) -> None: ...


def _run_jxa(source: str, *args: str) -> str:
    result = subprocess.run(
        ["osascript", "-l", "JavaScript", "-e", source, *args],
        check=False,
        capture_output=True,
        text=True,
        timeout=60,
    )
    if result.returncode:
        raise RuntimeError((result.stderr or result.stdout or "Apple Photos automation failed").strip())
    return result.stdout.strip()


class ApplePhotosAdapter:
    _READ = r"""
function run(argv) {
  const photos = Application('Photos');
  const id = String(argv[0] || '');
  const matches = photos.mediaItems.whose({id: id})();
  if (!matches.length) throw new Error(`Apple Photos asset not found: ${id}`);
  const item = matches[0];
  return JSON.stringify({title: item.name() || '', caption: item.description() || '', keywords: item.keywords() || []});
}
"""
    _WRITE = r"""
function run(argv) {
  const photos = Application('Photos');
  const id = String(argv[0] || '');
  const payload = JSON.parse(String(argv[1] || '{}'));
  const matches = photos.mediaItems.whose({id: id})();
  if (!matches.length) throw new Error(`Apple Photos asset not found: ${id}`);
  const item = matches[0];
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
  const matches = photos.mediaItems.whose({id: id})();
  if (!matches.length) throw new Error(`Apple Photos asset not found: ${id}`);
  const item = matches[0];
  const before = {
    title: item.name() || '',
    caption: item.description() || '',
    keywords: item.keywords() || [],
  };
  const desired = Array.isArray(payload.keywords) ? payload.keywords.map(String) : [];
  const managed = Array.isArray(payload.managedKeywords) ? payload.managedKeywords.map(String) : [];
  const managedSet = new Set(managed);
  const isManaged = value =>
    value === 'PBE-Approved' ||
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


def _r2_verified(conn, fixture_id: str, asset_id: str, version_hash: str) -> bool:
    rows = conn.execute(
        """SELECT status, COALESCE(object_key, '') object_key
           FROM fixture_delivery_receipts
           WHERE fixture_id = ? AND asset_id = ? AND destination = 'r2' AND version_hash = ?""",
        (fixture_id, asset_id, version_hash),
    ).fetchall()
    actual = [row for row in rows if row["object_key"]]
    return bool(actual) and all(row["status"] == "verified" for row in actual)


def writeback_plan(
    repo_root: Path,
    fixture_id: str = "",
    asset_ids: Iterable[str] = (),
    *,
    adapter: PhotosMetadataAccess | None = None,
) -> dict[str, Any]:
    requested_ids = [str(item).strip() for item in asset_ids if str(item).strip()]
    params: list[Any] = []
    where = ["p.state = 'active'", "instr(x.destinations_json, '\"apple_photos\"') > 0"]
    if fixture_id:
        where.append("p.fixture_id = ?")
        params.append(fixture_id)
    if requested_ids:
        where.append(f"p.asset_id IN ({','.join('?' for _ in requested_ids)})")
        params.extend(requested_ids)
    with connect(repo_root) as conn:
        rows = conn.execute(
            f"""
            SELECT p.fixture_id, p.asset_id, x.version_hash, f.name fixture_name,
                   COALESCE(d.pick_state, 'undecided') pick_state,
                   COALESCE(d.metadata_state, 'unreviewed') metadata_state,
                   COALESCE(d.title, '') title, COALESCE(d.caption, '') caption,
                   COALESCE(d.keywords_json, '[]') keywords_json,
                   COALESCE(d.rating, 0) rating, COALESCE(d.color, '') color,
                   COALESCE(a.raw_json, '{{}}') raw_json
            FROM fixture_asset_placements p
            JOIN fixture_asset_destinations x ON x.fixture_id = p.fixture_id AND x.asset_id = p.asset_id
            JOIN fixtures f ON f.fixture_id = p.fixture_id
            JOIN sidecar_assets a ON a.asset_id = p.asset_id
            LEFT JOIN sidecar_decisions d ON d.asset_id = p.asset_id
            WHERE {' AND '.join(where)}
            ORDER BY p.asset_id, p.fixture_id
            """,
            params,
        ).fetchall()
        grouped: dict[str, dict[str, Any]] = {}
        blocked: list[dict[str, Any]] = []
        for row in rows:
            current_version = editorial_version_hash(conn, row["asset_id"])
            reason = ""
            if row["version_hash"] != current_version:
                reason = "editorial version changed after destination configuration"
            elif row["pick_state"] != "picked" or row["metadata_state"] != "approved":
                reason = "asset is not both picked and metadata-approved"
            elif not _r2_verified(conn, row["fixture_id"], row["asset_id"], current_version):
                reason = "same-version R2 delivery is not verified"
            if reason:
                blocked.append({"fixtureId": row["fixture_id"], "assetId": row["asset_id"], "reason": reason})
                continue
            item = grouped.setdefault(row["asset_id"], {
                "assetId": row["asset_id"], "versionHash": current_version,
                "photosAssetId": str(json.loads(row["raw_json"] or "{}").get("localIdentifier") or row["asset_id"]),
                "title": row["title"], "caption": row["caption"],
                "keywords": json.loads(row["keywords_json"] or "[]"),
                "rating": int(row["rating"] or 0), "color": row["color"] or "",
                "fixtureIds": [], "fixtureNames": [],
            })
            item["fixtureIds"].append(row["fixture_id"])
            item["fixtureNames"].append(row["fixture_name"])
        for item in grouped.values():
            managed = [f"PBE-Fixture-ID:{value}" for value in item["fixtureIds"]]
            managed.append(f"PBE-Rating-{item['rating']}")
            if item["color"]:
                managed.append(f"PBE-Color-{item['color'].title()}")
            managed.append("PBE-Approved")
            item["managedKeywords"] = managed
            item["intendedMetadata"] = {
                "title": item["title"],
                "caption": item["caption"],
                "keywords": [*item["keywords"], *managed],
            }
            if adapter is not None:
                try:
                    before = adapter.read(item["photosAssetId"])
                    after_keywords = merge_keywords(before.get("keywords") or [], item["keywords"], managed)
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
    adapter = adapter or ApplePhotosAdapter()
    plan = writeback_plan(repo_root, fixture_id, asset_ids)
    written: list[dict[str, Any]] = []
    failed: list[dict[str, Any]] = []
    for item in plan["items"]:
        try:
            apply = getattr(adapter, "apply", None)
            if callable(apply):
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
            payload_hash = hashlib.sha256(json.dumps({"title": item["title"], "caption": item["caption"], "keywords": keywords}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
            with connect(repo_root) as conn:
                for target_fixture_id in item["fixtureIds"]:
                    record_delivery_receipt(
                        repo_root, fixture_id=target_fixture_id, asset_id=item["assetId"],
                        destination="apple_photos", version_hash=item["versionHash"], status="verified",
                        object_key=f"apple-photos://{item['assetId']}", checksum_sha256=payload_hash,
                        visibility_policy="local-library", verification={"before": before, "after": after}, conn=conn,
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
        adapter=ApplePhotosAdapter(),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
