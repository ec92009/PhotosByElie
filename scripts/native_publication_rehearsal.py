#!/usr/bin/env python3
"""Run the isolated PBB-63 native publication lifecycle rehearsal.

The rehearsal drives the same connector modes used by PhotosByElie Backstage
against temporary Owner and catalog databases.  Uploads and deletes use
synthetic in-process adapters, while the real Owner database and public/client
artifacts are protected by before/after hashes.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import platform
import plistlib
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from fixture_pipeline import (  # noqa: E402
    apply_fixture_review_action,
    connect,
    create_fixture,
    link_access_grant,
    set_fixture_asset_state,
)
import local_server  # noqa: E402
from native_owner_parity_rehearsal import (  # noqa: E402
    PUBLIC_GUARD_PATHS,
    guarded_hashes,
)
from native_publication_pipeline import (  # noqa: E402
    create_upload_run,
    reconcile_r2_objects,
    run_upload_batch,
)
from owner_catalog_projection import APPROVED_POLICY, import_projection  # noqa: E402
from sidecar_state_db import upsert_assets  # noqa: E402


ASSET_SOLD = "pbb63-sold"
ASSET_RESTORED = "pbb63-restored"
ASSET_RETRY = "pbb63-retry"
ASSET_CONFLICT = "pbb63-conflict"
ALL_ASSETS = (ASSET_SOLD, ASSET_RESTORED, ASSET_RETRY, ASSET_CONFLICT)

PRIVATE_BUCKET = "photosbyelie-private"
PUBLIC_BUCKET = "photosbyelie-public"
SOLD_MASTER = "masters/pbb63-sold.jpg"
SOLD_DERIVATIVES = (
    "expo/pbb63-sold_900.jpg",
    "expo/pbb63-sold_1800.jpg",
)
RESTORABLE_KEY = "masters/pbb63-restored.jpg"
ORPHAN_KEY = "masters/pbb63-orphan.jpg"


def connector_action(mode: str, **manifest: Any) -> dict[str, Any]:
    """Build the claimed local connector envelope used by Backstage."""
    return {
        "connectorId": "pbb-63-rehearsal",
        "action": {
            "id": f"pbb63-{mode}",
            "type": "sidecar-culling-review",
            "state": "claimed",
            "claim": {"connectorId": "pbb-63-rehearsal"},
            "payload": {"manifest": {"mode": mode, **manifest}},
        },
    }


def run_connector(root: Path, mode: str, **manifest: Any) -> dict[str, Any]:
    """Execute one operation through the native Backstage connector path."""
    return local_server.new_owner_connector_result(
        root,
        connector_action(mode, **manifest),
    )["result"]


def verified_object(
    key: str,
    *,
    bucket: str = PRIVATE_BUCKET,
    kind: str = "private-master",
) -> dict[str, Any]:
    """Return a deterministic checksum-verified synthetic R2 receipt."""
    checksum = ("a" if bucket == PRIVATE_BUCKET else "b") * 64
    return {
        "status": "uploaded",
        "bucket": bucket,
        "key": key,
        "checksumSha256": checksum,
        "remoteChecksumSha256": checksum,
        "remoteVerified": True,
        "bytes": 1024,
        "objectKind": kind,
        "kind": kind,
    }


def public_object_set(asset_id: str) -> list[dict[str, Any]]:
    """Return the private master and bounded public derivatives for one photo."""
    return [
        verified_object(f"masters/{asset_id}.jpg"),
        verified_object(
            f"expo/{asset_id}_900.jpg",
            bucket=PUBLIC_BUCKET,
            kind="public-preview",
        ),
        verified_object(
            f"expo/{asset_id}_1800.jpg",
            bucket=PUBLIC_BUCKET,
            kind="public-preview",
        ),
    ]


def installed_backstage() -> dict[str, Any]:
    """Describe the signed native app installed on this Mac, if present."""
    candidates = (
        Path.home() / "Applications/PhotosByElie Backstage.app",
        Path("/Applications/PhotosByElie Backstage.app"),
    )
    app_path = next((path for path in candidates if path.is_dir()), None)
    if app_path is None:
        return {
            "present": False,
            "path": "",
            "version": "",
            "build": "",
            "codeSignatureValid": False,
        }
    info_path = app_path / "Contents/Info.plist"
    with info_path.open("rb") as handle:
        info = plistlib.load(handle)
    verification = subprocess.run(
        ["codesign", "--verify", "--deep", "--strict", str(app_path)],
        check=False,
        capture_output=True,
        text=True,
    )
    return {
        "present": True,
        "path": str(app_path),
        "version": str(info.get("CFBundleShortVersionString") or ""),
        "build": str(info.get("CFBundleVersion") or ""),
        "codeSignatureValid": verification.returncode == 0,
    }


def machine_name() -> str:
    """Return the user-facing Mac name with a portable fallback."""
    result = subprocess.run(
        ["scutil", "--get", "ComputerName"],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() or platform.node()


def seed_rehearsal(root: Path, repo_root: Path) -> tuple[str, str]:
    """Create an isolated public fixture, assets, approval, and ACS grant."""
    catalog_source = repo_root / "assets/catalog/photosbyelie.sqlite"
    catalog_target = root / "assets/catalog/photosbyelie.sqlite"
    catalog_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(catalog_source, catalog_target)

    upsert_assets(
        root,
        [
            {
                "localIdentifier": asset_id,
                "filename": f"{asset_id}.jpg",
                "mediaType": "photo",
                "creationDate": f"2026-08-06T10:0{index}:00Z",
            }
            for index, asset_id in enumerate(ALL_ASSETS)
        ],
    )
    with connect(root) as connection:
        for asset_id in ALL_ASSETS:
            connection.execute(
                """
                UPDATE sidecar_assets
                SET pixel_width = 2400, pixel_height = 1600,
                    captured_at = '2026-08-06T10:00:00Z',
                    location_label = 'Spain Barcelona'
                WHERE asset_id = ?
                """,
                (asset_id,),
            )
        connection.commit()

    expo = create_fixture(
        root,
        "Expo",
        fixture_id="fixture-pbb63-expo",
        template_key="expo",
    )
    child = create_fixture(
        root,
        "PBB-63 Native Rehearsal",
        fixture_id="fixture-pbb63-native",
        parent_fixture_id=expo["fixtureId"],
    )
    set_fixture_asset_state(root, expo["fixtureId"], ALL_ASSETS, "picked")
    set_fixture_asset_state(root, child["fixtureId"], ALL_ASSETS, "picked")
    apply_fixture_review_action(
        root,
        child["fixtureId"],
        ALL_ASSETS,
        "approve",
        actor="pbb-63-rehearsal",
    )
    link_access_grant(
        root,
        expo["fixtureId"],
        provider="acs",
        external_identity="pbb63-rehearsal@example.invalid",
        subject_label="PBB-63 synthetic buyer",
    )
    return expo["fixtureId"], child["fixtureId"]


def snapshots(rendered_conflict: str = "render-conflict-a") -> list[dict[str, Any]]:
    """Return the deterministic PhotoKit snapshot used by the rehearsal."""
    return [
        {
            "assetId": asset_id,
            "photosAssetId": f"photos-{asset_id}",
            "title": f"PBB-63 {asset_id.removeprefix('pbb63-').title()}",
            "keywords": ["PBE:Approved", "Spain", "Barcelona"],
            "renderedFingerprint": (
                rendered_conflict
                if asset_id == ASSET_CONFLICT
                else f"render-{asset_id}"
            ),
        }
        for asset_id in ALL_ASSETS
    ]


def database_evidence(root: Path) -> dict[str, Any]:
    """Return compact final evidence from the isolated Owner/catalog stores."""
    with connect(root) as connection:
        sold_states = {
            str(row["object_key"]): str(row["lifecycle_state"])
            for row in connection.execute(
                """
                SELECT object_key, lifecycle_state FROM r2_objects
                WHERE object_key IN (?, ?, ?)
                """,
                (SOLD_MASTER, *SOLD_DERIVATIVES),
            )
        }
        quarantine_states = {
            str(row["object_key"]): str(row["state"])
            for row in connection.execute(
                """
                SELECT object_key, state FROM r2_quarantine
                WHERE object_key IN (?, ?, ?)
                """,
                (SOLD_MASTER, RESTORABLE_KEY, ORPHAN_KEY),
            )
        }
        publication = connection.execute(
            """
            SELECT state, media_id FROM public_catalog_publications
            WHERE asset_id = ? ORDER BY updated_at DESC LIMIT 1
            """,
            (ASSET_SOLD,),
        ).fetchone()
        conflict = connection.execute(
            """
            SELECT editorial.editorial_state, delivery.delivery_state
            FROM asset_editorial_state AS editorial
            JOIN asset_delivery_state AS delivery USING (asset_id)
            WHERE editorial.asset_id = ?
            """,
            (ASSET_CONFLICT,),
        ).fetchone()
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    with sqlite3.connect(root / "assets/catalog/photosbyelie.sqlite") as catalog:
        catalog_count = catalog.execute(
            "SELECT count(*) FROM media_items WHERE media_id = ?",
            (ASSET_SOLD,),
        ).fetchone()[0]
    return {
        "soldObjectStates": sold_states,
        "quarantineStates": quarantine_states,
        "catalogPublication": dict(publication) if publication else {},
        "catalogMediaRows": int(catalog_count),
        "appearanceConflict": dict(conflict) if conflict else {},
        "ownerIntegrity": str(integrity),
    }


def run_rehearsal(
    repo_root: Path,
    *,
    require_installed_app: bool = True,
) -> dict[str, Any]:
    """Run the complete isolated PBB-63 native publication rehearsal."""
    repo_root = repo_root.resolve()
    guard_before = guarded_hashes(repo_root)
    app = installed_backstage()
    deleted: list[tuple[str, str]] = []

    with tempfile.TemporaryDirectory(prefix="pbe-pbb63-rehearsal-") as temp_dir:
        root = Path(temp_dir)
        _expo_id, fixture_id = seed_rehearsal(root, repo_root)
        import_projection(
            (root / "assets/owner-actions/Owner.sqlite").resolve(),
            (root / "assets/catalog/photosbyelie.sqlite").resolve(),
            approved_policy=APPROVED_POLICY,
        )

        baseline = run_connector(root, "photos-sync-snapshot", items=snapshots())
        repeated = run_connector(root, "photos-sync-snapshot", items=snapshots())
        conflict = run_connector(
            root,
            "photos-sync-snapshot",
            items=[snapshots(rendered_conflict="render-conflict-b")[-1]],
        )

        access = run_connector(
            root,
            "fixture-access-effective",
            fixtureId=fixture_id,
        )["access"]

        first_run = create_upload_run(
            root,
            [ASSET_SOLD, ASSET_RETRY],
            limit=2,
            concurrency=1,
        )

        def partial_upload(asset_id: str) -> list[dict[str, Any]]:
            if asset_id == ASSET_RETRY:
                raise RuntimeError("synthetic retryable upload failure")
            return public_object_set(asset_id)

        partial = run_upload_batch(root, first_run["runId"], partial_upload)
        retry_run = create_upload_run(root, [ASSET_RETRY], limit=1, concurrency=1)
        retry = run_upload_batch(
            root,
            retry_run["runId"],
            lambda asset_id: public_object_set(asset_id),
        )

        sold_item = next(
            item for item in partial["items"] if item["asset_id"] == ASSET_SOLD
        )
        sale_manifest = {
            "orderId": "PBB63-SYNTHETIC-ORDER",
            "assetId": ASSET_SOLD,
            "sourceVersionHash": sold_item["source_version_hash"],
            "checksumSha256": "a" * 64,
            "masterKey": SOLD_MASTER,
            "derivativeKeys": list(SOLD_DERIVATIVES),
        }
        sale_first = run_connector(root, "asset-sale-reference-record", **sale_manifest)
        sale_again = run_connector(root, "asset-sale-reference-record", **sale_manifest)

        with connect(root) as connection:
            for asset_id, key in (
                (ASSET_RESTORED, RESTORABLE_KEY),
                ("pbb63-orphan", ORPHAN_KEY),
            ):
                connection.execute(
                    """
                    INSERT INTO r2_objects (
                      bucket, object_key, photo_id, object_kind,
                      lifecycle_state, first_seen_at, updated_at
                    ) VALUES (?, ?, ?, 'private-master', 'current', ?, ?)
                    """,
                    (
                        PRIVATE_BUCKET,
                        key,
                        asset_id,
                        "2026-08-06T00:00:00Z",
                        "2026-08-06T00:00:00Z",
                    ),
                )
            connection.commit()

        reconciliation_plan = run_connector(root, "r2-reconciliation-plan")[
            "reconciliation"
        ]
        first_reconciliation = run_connector(
            root,
            "r2-reconciliation-commit",
        )["reconciliation"]

        restore_run = create_upload_run(
            root,
            [ASSET_RESTORED],
            limit=1,
            concurrency=1,
        )
        restored_upload = run_upload_batch(
            root,
            restore_run["runId"],
            lambda _asset_id: [verified_object(RESTORABLE_KEY)],
        )
        second_reconciliation = run_connector(
            root,
            "r2-reconciliation-commit",
        )["reconciliation"]
        final_reconciliation = reconcile_r2_objects(
            root,
            commit=True,
            now="2099-01-01T00:00:00Z",
            delete_object=lambda bucket, key: deleted.append((bucket, key)),
        )
        evidence = database_evidence(root)

    guard_after = guarded_hashes(repo_root)
    checks = {
        "installedBackstagePresent": app["present"],
        "installedBackstageSigned": app["codeSignatureValid"],
        "photosBaselineImported": baseline["photosSync"]["changes"]["baseline"]
        == len(ALL_ASSETS),
        "photosRepeatIsIdempotent": repeated["photosSync"]["changes"]["unchanged"]
        == len(ALL_ASSETS),
        "appearanceConflictReturnsToReview": (
            conflict["photosSync"]["changes"]["appearance"] == 1
            and evidence["appearanceConflict"]
            == {"editorial_state": "unreviewed", "delivery_state": "not-ready"}
        ),
        "acsGrantInherited": (
            access["count"] == 1
            and access["items"][0]["inherited"] is True
            and access["items"][0]["externalIdentity"]
            == "pbb63-rehearsal@example.invalid"
        ),
        "partialFailureIsolated": (
            partial["status"] == "completed-with-errors"
            and partial["processed"] == 2
            and partial["failed"] == 1
        ),
        "failedUploadRetriesCleanly": (
            retry["status"] == "completed"
            and retry["processed"] == 1
            and retry["failed"] == 0
        ),
        "publicCatalogRegisteredOnce": (
            evidence["catalogPublication"].get("state") == "local"
            and evidence["catalogMediaRows"] == 1
        ),
        "saleReferenceIsIdempotent": (
            sale_first["saleReference"]["sourceVersionHash"]
            == sale_again["saleReference"]["sourceVersionHash"]
        ),
        "previewShowsProtectionAndQuarantine": (
            reconciliation_plan["protected"] == 3
            and reconciliation_plan["quarantined"] == 2
            and reconciliation_plan["committed"] is False
        ),
        "firstPassProtectsSoldObjects": (
            first_reconciliation["protected"] == 3
            and first_reconciliation["quarantined"] == 2
            and all(
                state == "current"
                for state in evidence["soldObjectStates"].values()
            )
        ),
        "referencedObjectRestored": (
            restored_upload["status"] == "completed"
            and second_reconciliation["restored"] == 1
            and evidence["quarantineStates"].get(RESTORABLE_KEY) == "restored"
        ),
        "orphanDeletedOnlyOnLaterPass": (
            final_reconciliation["eligibleDelete"] == 1
            and final_reconciliation["deleted"] == 1
            and deleted == [(PRIVATE_BUCKET, ORPHAN_KEY)]
            and evidence["quarantineStates"].get(ORPHAN_KEY) == "deleted"
        ),
        "soldObjectsRemainProtected": (
            evidence["quarantineStates"].get(SOLD_MASTER) == "protected"
            and all(
                state == "current"
                for state in evidence["soldObjectStates"].values()
            )
        ),
        "ownerDatabaseIntegrityPasses": evidence["ownerIntegrity"] == "ok",
        "liveOwnerDatabaseUnchanged": (
            guard_before["assets/owner-actions/Owner.sqlite"]
            == guard_after["assets/owner-actions/Owner.sqlite"]
        ),
        "publicClientArtifactsUnchanged": all(
            guard_before[path] == guard_after[path] for path in PUBLIC_GUARD_PATHS
        ),
        "allGuardedArtifactsUnchanged": guard_before == guard_after,
    }
    required_checks = dict(checks)
    if not require_installed_app:
        required_checks.pop("installedBackstagePresent")
        required_checks.pop("installedBackstageSigned")
    report = {
        "schema": "photosbyelie.nativePublicationRehearsal.v1",
        "ticket": "PBB-63",
        "generatedAt": datetime.now(timezone.utc).isoformat().replace(
            "+00:00", "Z"
        ),
        "machine": {
            "computerName": machine_name(),
            "platform": platform.platform(),
            "backstage": app,
        },
        "scenario": {
            "syntheticAssetCount": len(ALL_ASSETS),
            "externalUploads": 0,
            "externalDeletes": 0,
            "connectorModes": [
                "photos-sync-snapshot",
                "fixture-access-effective",
                "asset-sale-reference-record",
                "r2-reconciliation-plan",
                "r2-reconciliation-commit",
            ],
            "lifecycle": [
                "PhotoKit baseline and idempotent repeat",
                "appearance conflict back to Review",
                "inherited ACS access",
                "partial publication failure and retry",
                "local catalog registration",
                "exact sale-object protection",
                "first-pass quarantine",
                "referenced-object restoration",
                "later-pass orphan deletion through a synthetic adapter",
            ],
        },
        "checks": checks,
        "evidence": {
            "partialUpload": partial,
            "retryUpload": retry,
            "reconciliationPlan": reconciliation_plan,
            "firstReconciliation": first_reconciliation,
            "secondReconciliation": second_reconciliation,
            "finalReconciliation": final_reconciliation,
            "database": evidence,
            "syntheticDeletes": [
                {"bucket": bucket, "key": key} for bucket, key in deleted
            ],
        },
        "guardedArtifacts": {
            "count": len(guard_before),
            "sha256Before": guard_before,
            "sha256After": guard_after,
        },
        "passed": all(required_checks.values()),
    }
    if not report["passed"]:
        failed = [name for name, passed in required_checks.items() if not passed]
        raise AssertionError(f"PBB-63 rehearsal checks failed: {', '.join(failed)}")
    return report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the isolated PBB-63 native publication rehearsal."
    )
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--report", type=Path)
    parser.add_argument(
        "--allow-missing-app",
        action="store_true",
        help="Do not require an installed signed Backstage app (test/CI only).",
    )
    args = parser.parse_args()
    report = run_rehearsal(
        args.repo_root,
        require_installed_app=not args.allow_missing_app,
    )
    if args.report:
        report_path = (
            args.report
            if args.report.is_absolute()
            else args.repo_root / args.report
        )
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
