#!/usr/bin/env python3
"""Fixture population and policy configuration for PhotosByElie.

Owner.sqlite remains the source of truth.  This module keeps the mutable
working configuration separate from immutable publication snapshots.
"""

from __future__ import annotations

import json
from pathlib import Path
import sqlite3
from typing import Any, Iterable
import uuid

from fixture_pipeline import (
    OWNER_DB,
    _backup_owner_database,
    connect,
    ensure_schema,
    fixture_breadcrumbs,
    now_iso,
)


FIXTURE_MODES = {"curated", "rule-based", "parent-subset"}
VISIBILITY_VALUES = {"public", "private", "unlisted"}
RETENTION_VALUES = {"public-preview", "private-master", "archive-only", "no-cloud"}
DELIVERY_VALUES = {"public", "granted", "owner-only", "disabled"}
COMMERCE_VALUES = {"retail", "paid-service", "free-sharing", "disabled"}
POLICY_MIGRATION_ID = "fixture-policy-v1"

SAFE_POLICY = {
    "visibility": "private",
    "searchable": False,
    "retention": "no-cloud",
    "delivery": "owner-only",
    "download": False,
    "commerce": "disabled",
}

POLICY_TEMPLATES = {
    "expo": {
        "visibility": "public",
        "searchable": True,
        "retention": "public-preview",
        "delivery": "public",
        "download": False,
        "commerce": "retail",
    },
    "real-estate": {
        "visibility": "private",
        "searchable": False,
        "retention": "private-master",
        "delivery": "granted",
        "download": True,
        "commerce": "paid-service",
    },
    "friends-family": {
        "visibility": "private",
        "searchable": False,
        "retention": "private-master",
        "delivery": "granted",
        "download": True,
        "commerce": "free-sharing",
    },
}


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def _read_json(value: Any, fallback: Any) -> Any:
    try:
        return json.loads(str(value or ""))
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def ensure_policy_schema(conn: sqlite3.Connection) -> None:
    fixture_columns = {
        str(row["name"])
        for row in conn.execute("PRAGMA table_info(fixtures)").fetchall()
    }
    additions = {
        "population_mode": "TEXT NOT NULL DEFAULT 'curated'",
        "candidate_source_json": "TEXT NOT NULL DEFAULT '{}'",
        "saved_rule_json": "TEXT NOT NULL DEFAULT '{}'",
        "policy_overrides_json": "TEXT NOT NULL DEFAULT '{}'",
        "policy_revision": "INTEGER NOT NULL DEFAULT 0",
    }
    for column, declaration in additions.items():
        if column not in fixture_columns:
            conn.execute(f"ALTER TABLE fixtures ADD COLUMN {column} {declaration}")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS fixture_policy_revisions (
          revision_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          revision INTEGER NOT NULL,
          configured_json TEXT NOT NULL,
          effective_json TEXT NOT NULL,
          actor TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id),
          UNIQUE (fixture_id, revision)
        );
        CREATE INDEX IF NOT EXISTS idx_fixture_policy_revisions_fixture
          ON fixture_policy_revisions(fixture_id, revision DESC);

        CREATE TABLE IF NOT EXISTS fixture_snapshot_contracts (
          pool_id TEXT PRIMARY KEY,
          fixture_id TEXT NOT NULL,
          population_mode TEXT NOT NULL,
          candidate_source_json TEXT NOT NULL,
          saved_rule_json TEXT NOT NULL,
          policy_revision INTEGER NOT NULL,
          effective_policy_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (pool_id) REFERENCES fixture_culling_pools(pool_id) ON DELETE CASCADE,
          FOREIGN KEY (fixture_id) REFERENCES fixtures(fixture_id)
        );
        """
    )
    conn.execute(
        """
        UPDATE fixtures
        SET population_mode = CASE
          WHEN parent_fixture_id IS NULL THEN 'curated'
          ELSE 'parent-subset'
        END
        WHERE population_mode NOT IN ('curated', 'rule-based', 'parent-subset')
        """
    )


def _validate_policy(values: dict[str, Any], *, partial: bool) -> dict[str, Any]:
    allowed = set(SAFE_POLICY)
    unknown = set(values) - allowed
    if unknown:
        raise ValueError(f"unknown fixture policy fields: {', '.join(sorted(unknown))}")
    result = dict(values)
    if not partial:
        result = {**SAFE_POLICY, **result}
    if "visibility" in result and result["visibility"] not in VISIBILITY_VALUES:
        raise ValueError("visibility must be public, private, or unlisted")
    if "retention" in result and result["retention"] not in RETENTION_VALUES:
        raise ValueError("retention must be public-preview, private-master, archive-only, or no-cloud")
    if "delivery" in result and result["delivery"] not in DELIVERY_VALUES:
        raise ValueError("delivery must be public, granted, owner-only, or disabled")
    if "commerce" in result and result["commerce"] not in COMMERCE_VALUES:
        raise ValueError("commerce must be retail, paid-service, free-sharing, or disabled")
    for key in ("searchable", "download"):
        if key in result and not isinstance(result[key], bool):
            raise ValueError(f"{key} must be true or false")
    return result


def template_policy(template_key: str) -> dict[str, Any]:
    key = str(template_key or "").strip().casefold()
    aliases = {
        "re": "real-estate",
        "real estate": "real-estate",
        "family": "friends-family",
        "friends and family": "friends-family",
    }
    key = aliases.get(key, key)
    return dict(POLICY_TEMPLATES.get(key, SAFE_POLICY))


def _configured_policy(row: sqlite3.Row) -> dict[str, Any]:
    overrides = _read_json(row["policy_overrides_json"], {})
    return _validate_policy(overrides if isinstance(overrides, dict) else {}, partial=True)


def _legacy_template_key(row: sqlite3.Row) -> str:
    configured = str(row["template_key"] or "").strip()
    if configured:
        return configured
    # Older fixture rows predate template persistence. Preserve their
    # established behavior from the canonical root names before falling back
    # to the fail-closed policy.
    name = str(row["name"] or "").strip().casefold()
    if name == "expo":
        return "expo"
    if name in {"re", "real estate"}:
        return "real-estate"
    if name in {"friends and family", "friends & family"}:
        return "friends-family"
    tags = {
        str(item).strip().casefold()
        for item in _read_json(row["tags_json"], [])
        if str(item).strip()
    }
    if "public" in tags:
        return "expo"
    if {"real-estate", "private"} & tags:
        return "real-estate"
    if {"family", "friends-family"} & tags:
        return "friends-family"
    return ""


def effective_fixture_policy(
    repo_root: Path,
    fixture_id: str,
    *,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    owns = conn is None
    conn = conn or connect(repo_root)
    ensure_policy_schema(conn)
    try:
        breadcrumbs = fixture_breadcrumbs(conn, fixture_id)
        effective = dict(SAFE_POLICY)
        sources: list[dict[str, Any]] = []
        for crumb in breadcrumbs:
            row = conn.execute(
                "SELECT * FROM fixtures WHERE fixture_id = ?",
                (crumb["fixtureId"],),
            ).fetchone()
            configured = _configured_policy(row)
            if not sources:
                effective = template_policy(_legacy_template_key(row))
            effective.update(configured)
            sources.append({
                "fixtureId": str(row["fixture_id"]),
                "configured": configured,
                "revision": int(row["policy_revision"] or 0),
            })
        return {
            "fixtureId": fixture_id,
            "configured": sources[-1]["configured"],
            "effective": _validate_policy(effective, partial=False),
            "sources": sources,
            "revision": sources[-1]["revision"],
        }
    finally:
        if owns:
            conn.close()


def configure_fixture(
    repo_root: Path,
    fixture_id: str,
    *,
    population_mode: str | None = None,
    candidate_source: dict[str, Any] | None = None,
    saved_rule: dict[str, Any] | None = None,
    policy_overrides: dict[str, Any] | None = None,
    template_key: str | None = None,
    actor: str = "owner",
    reason: str = "",
) -> dict[str, Any]:
    with connect(repo_root) as conn:
        ensure_policy_schema(conn)
        row = conn.execute(
            "SELECT * FROM fixtures WHERE fixture_id = ? AND archived_at IS NULL",
            (fixture_id,),
        ).fetchone()
        if not row:
            raise ValueError("fixture does not exist or is archived")
        mode = str(population_mode or row["population_mode"] or "").strip().casefold()
        if mode not in FIXTURE_MODES:
            raise ValueError("population mode must be curated, rule-based, or parent-subset")
        if mode == "parent-subset" and not row["parent_fixture_id"]:
            raise ValueError("root fixtures cannot use parent-subset mode")
        source = (
            candidate_source
            if candidate_source is not None
            else _read_json(row["candidate_source_json"], {})
        )
        rule = saved_rule if saved_rule is not None else _read_json(row["saved_rule_json"], {})
        overrides = (
            _validate_policy(policy_overrides, partial=True)
            if policy_overrides is not None
            else _configured_policy(row)
        )
        template = str(template_key if template_key is not None else row["template_key"] or "").strip()
        revision = int(row["policy_revision"] or 0) + 1
        timestamp = now_iso()
        conn.execute(
            """
            UPDATE fixtures
            SET population_mode = ?, candidate_source_json = ?, saved_rule_json = ?,
                policy_overrides_json = ?, template_key = ?, policy_revision = ?,
                updated_at = ?
            WHERE fixture_id = ?
            """,
            (
                mode,
                _json(source if isinstance(source, dict) else {}),
                _json(rule if isinstance(rule, dict) else {}),
                _json(overrides),
                template or None,
                revision,
                timestamp,
                fixture_id,
            ),
        )
        policy = effective_fixture_policy(repo_root, fixture_id, conn=conn)
        conn.execute(
            """
            INSERT INTO fixture_policy_revisions (
              revision_id, fixture_id, revision, configured_json, effective_json,
              actor, reason, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                f"fpr-{uuid.uuid4().hex[:16]}",
                fixture_id,
                revision,
                _json(overrides),
                _json(policy["effective"]),
                str(actor or "owner"),
                str(reason or ""),
                timestamp,
            ),
        )
        conn.commit()
    return fixture_configuration(repo_root, fixture_id)


def fixture_configuration(repo_root: Path, fixture_id: str) -> dict[str, Any]:
    with connect(repo_root) as conn:
        ensure_policy_schema(conn)
        row = conn.execute(
            "SELECT * FROM fixtures WHERE fixture_id = ?",
            (fixture_id,),
        ).fetchone()
        if not row:
            raise ValueError("fixture does not exist")
        policy = effective_fixture_policy(repo_root, fixture_id, conn=conn)
        history = conn.execute(
            """
            SELECT revision_id, revision, configured_json, effective_json,
                   actor, reason, created_at
            FROM fixture_policy_revisions
            WHERE fixture_id = ?
            ORDER BY revision DESC
            """,
            (fixture_id,),
        ).fetchall()
        return {
            "fixtureId": fixture_id,
            "populationMode": str(row["population_mode"] or "curated"),
            "candidateSource": _read_json(row["candidate_source_json"], {}),
            "savedRule": _read_json(row["saved_rule_json"], {}),
            "templateKey": str(row["template_key"] or ""),
            "policy": policy,
            "history": [{
                "revisionId": str(item["revision_id"]),
                "revision": int(item["revision"]),
                "configured": _read_json(item["configured_json"], {}),
                "effective": _read_json(item["effective_json"], {}),
                "actor": str(item["actor"]),
                "reason": str(item["reason"] or ""),
                "createdAt": str(item["created_at"]),
            } for item in history],
        }


def capture_snapshot_contract(
    repo_root: Path,
    pool_id: str,
    *,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    owns = conn is None
    conn = conn or connect(repo_root)
    ensure_policy_schema(conn)
    try:
        pool = conn.execute(
            """
            SELECT p.pool_id, p.fixture_id, f.population_mode,
                   f.candidate_source_json, f.saved_rule_json
            FROM fixture_culling_pools p
            JOIN fixtures f ON f.fixture_id = p.fixture_id
            WHERE p.pool_id = ?
            """,
            (pool_id,),
        ).fetchone()
        if not pool:
            raise ValueError("fixture snapshot does not exist")
        policy = effective_fixture_policy(repo_root, str(pool["fixture_id"]), conn=conn)
        timestamp = now_iso()
        conn.execute(
            """
            INSERT OR IGNORE INTO fixture_snapshot_contracts (
              pool_id, fixture_id, population_mode, candidate_source_json,
              saved_rule_json, policy_revision, effective_policy_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(pool["pool_id"]),
                str(pool["fixture_id"]),
                str(pool["population_mode"]),
                str(pool["candidate_source_json"]),
                str(pool["saved_rule_json"]),
                int(policy["revision"]),
                _json(policy["effective"]),
                timestamp,
            ),
        )
        if owns:
            conn.commit()
        row = conn.execute(
            "SELECT * FROM fixture_snapshot_contracts WHERE pool_id = ?",
            (pool_id,),
        ).fetchone()
        return {
            "poolId": str(row["pool_id"]),
            "fixtureId": str(row["fixture_id"]),
            "populationMode": str(row["population_mode"]),
            "candidateSource": _read_json(row["candidate_source_json"], {}),
            "savedRule": _read_json(row["saved_rule_json"], {}),
            "policyRevision": int(row["policy_revision"]),
            "effectivePolicy": _read_json(row["effective_policy_json"], {}),
            "createdAt": str(row["created_at"]),
        }
    finally:
        if owns:
            conn.close()


def policy_allows_cloud(policy: dict[str, Any]) -> bool:
    return str(policy.get("retention") or "") != "no-cloud"


def policy_allows_catalog(policy: dict[str, Any]) -> bool:
    return bool(policy.get("searchable")) and str(policy.get("visibility")) == "public"


def policy_allows_checkout(policy: dict[str, Any]) -> bool:
    return str(policy.get("commerce") or "") == "retail"


def policy_allows_delivery(policy: dict[str, Any]) -> bool:
    return str(policy.get("delivery") or "") != "disabled"


def policy_allows_download(policy: dict[str, Any]) -> bool:
    return bool(policy.get("download")) and policy_allows_delivery(policy)


def policy_allows_r2_result(
    policy: dict[str, Any],
    result: dict[str, Any],
) -> bool:
    """Return whether one already verified R2 object belongs to this fixture.

    Public-preview fixtures keep their public derivatives and, when retail is
    enabled, the private master required to fulfil a sale. Private-master and
    archive-only fixtures retain private objects only. No-cloud fixtures retain
    neither.
    """
    retention = str(policy.get("retention") or "")
    if retention == "no-cloud":
        return False
    bucket = str(result.get("bucket") or "")
    public = bucket.endswith("public")
    if public:
        return (
            retention == "public-preview"
            and str(policy.get("visibility") or "") == "public"
        )
    if retention in {"private-master", "archive-only"}:
        return True
    return retention == "public-preview" and policy_allows_checkout(policy)


def plan_fixture_policy_migration(
    repo_root: Path,
    *,
    db_path: Path | None = None,
) -> dict[str, Any]:
    path = Path(db_path or (repo_root / OWNER_DB))
    with connect(repo_root, db_path=path) as conn:
        # Planning is intentionally schema-neutral. The backup created by the
        # apply path must precede every fixture-policy schema or data change.
        receipt_table = conn.execute(
            """
            SELECT 1 FROM sqlite_master
            WHERE type = 'table' AND name = 'workflow_migration_receipts'
            """
        ).fetchone()
        existing = (
            conn.execute(
                """
                SELECT * FROM workflow_migration_receipts
                WHERE migration_id = ? AND state = 'applied'
                """,
                (POLICY_MIGRATION_ID,),
            ).fetchone()
            if receipt_table
            else None
        )
        fixtures = {
            str(row["name"]).casefold(): dict(row)
            for row in conn.execute(
                "SELECT * FROM fixtures WHERE archived_at IS NULL"
            ).fetchall()
        }
        targets: list[dict[str, Any]] = []
        for name, template in (
            ("expo", "expo"),
            ("re", "real-estate"),
            ("friends and family", "friends-family"),
        ):
            row = fixtures.get(name)
            if not row:
                continue
            targets.append({
                "fixtureId": str(row["fixture_id"]),
                "name": str(row["name"]),
                "templateKey": template,
                "populationMode": "curated",
            })
            child_ids = _descendant_ids(conn, str(row["fixture_id"]))
            if child_ids:
                placeholders = ",".join("?" for _ in child_ids)
                descendants = conn.execute(
                    f"""
                    SELECT fixture_id, name FROM fixtures
                    WHERE fixture_id IN ({placeholders}) AND archived_at IS NULL
                    ORDER BY name COLLATE NOCASE
                    """,
                    sorted(child_ids),
                ).fetchall()
                for child in descendants:
                    targets.append({
                        "fixtureId": str(child["fixture_id"]),
                        "name": str(child["name"]),
                        "templateKey": "",
                        "populationMode": "parent-subset",
                    })
        unique = {item["fixtureId"]: item for item in targets}
        return {
            "ok": True,
            "migrationId": POLICY_MIGRATION_ID,
            "alreadyApplied": bool(existing),
            "database": str(path),
            "targets": list(unique.values()),
            "targetCount": len(unique),
            "reversible": True,
        }

def _descendant_ids(conn: sqlite3.Connection, fixture_id: str) -> set[str]:
    rows = conn.execute(
        """
        WITH RECURSIVE descendants(fixture_id) AS (
          SELECT fixture_id FROM fixtures WHERE parent_fixture_id = ?
          UNION ALL
          SELECT fixture.fixture_id
          FROM fixtures AS fixture
          JOIN descendants ON fixture.parent_fixture_id = descendants.fixture_id
        )
        SELECT fixture_id FROM descendants
        """,
        (fixture_id,),
    ).fetchall()
    return {str(row["fixture_id"]) for row in rows}


def apply_fixture_policy_migration(
    repo_root: Path,
    *,
    db_path: Path | None = None,
    actor: str = "owner",
) -> dict[str, Any]:
    path = Path(db_path or (repo_root / OWNER_DB))
    plan = plan_fixture_policy_migration(repo_root, db_path=path)
    if plan["alreadyApplied"]:
        return {**plan, "applied": False}
    timestamp = now_iso()
    receipt_dir = repo_root / "assets" / "owner-actions" / "migrations"
    receipt_dir.mkdir(parents=True, exist_ok=True)
    backup_path = _backup_owner_database(
        repo_root,
        db_path=path,
        migration_id=POLICY_MIGRATION_ID,
    )
    with connect(repo_root, db_path=path) as conn:
        ensure_schema(conn)
        ensure_policy_schema(conn)
        # Schema compatibility work can perform a harmless normalization
        # update. Commit that setup before opening the migration's explicit
        # all-or-nothing transaction.
        conn.commit()
        conn.execute("BEGIN IMMEDIATE")
        try:
            for target in plan["targets"]:
                row = conn.execute(
                    "SELECT policy_revision FROM fixtures WHERE fixture_id = ?",
                    (target["fixtureId"],),
                ).fetchone()
                revision = int(row["policy_revision"] or 0) + 1
                conn.execute(
                    """
                    UPDATE fixtures
                    SET population_mode = ?, template_key = CASE
                          WHEN ? != '' THEN ? ELSE template_key END,
                        policy_revision = ?, updated_at = ?
                    WHERE fixture_id = ?
                    """,
                    (
                        target["populationMode"],
                        target["templateKey"],
                        target["templateKey"],
                        revision,
                        timestamp,
                        target["fixtureId"],
                    ),
                )
                policy = effective_fixture_policy(
                    repo_root,
                    target["fixtureId"],
                    conn=conn,
                )
                conn.execute(
                    """
                    INSERT INTO fixture_policy_revisions (
                      revision_id, fixture_id, revision, configured_json,
                      effective_json, actor, reason, created_at
                    ) VALUES (?, ?, ?, '{}', ?, ?, ?, ?)
                    """,
                    (
                        f"fpr-{uuid.uuid4().hex[:16]}",
                        target["fixtureId"],
                        revision,
                        _json(policy["effective"]),
                        actor,
                        POLICY_MIGRATION_ID,
                        timestamp,
                    ),
                )
            summary = {
                "targetCount": plan["targetCount"],
                "backupPath": str(backup_path),
            }
            receipt = {
                **plan,
                "mode": "commit",
                "backupPath": str(backup_path),
                "after": summary,
                "applied": True,
                "appliedAt": timestamp,
                "idempotencyReplayed": False,
                "reversal": {
                    "kind": "verified-sqlite-backup",
                    "backupPath": str(backup_path),
                    "requiresOfflineRestore": True,
                },
            }
            conn.execute(
                """
                INSERT INTO workflow_migration_receipts (
                  migration_id, state, backup_path, before_json, after_json,
                  receipt_json, created_at, applied_at
                ) VALUES (?, 'applied', ?, ?, ?, ?, ?, ?)
                """,
                (
                    POLICY_MIGRATION_ID,
                    str(backup_path),
                    _json({"targets": plan["targets"]}),
                    _json(summary),
                    _json(receipt),
                    timestamp,
                    timestamp,
                ),
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
    receipt_path = receipt_dir / f"{POLICY_MIGRATION_ID}.json"
    receipt_path.write_text(
        json.dumps(
            {
                "migrationId": POLICY_MIGRATION_ID,
                "appliedAt": timestamp,
                "backupPath": str(backup_path),
                "targets": plan["targets"],
            },
            indent=2,
            sort_keys=True,
        ) + "\n",
        encoding="utf-8",
    )
    return {
        **plan,
        "applied": True,
        "backupPath": str(backup_path),
        "receiptPath": str(receipt_path),
    }
