"""Replay fixture-specific Review receipts into editions, without touching legacy data."""

import json
import sqlite3

import fixture_editions as editions

MIGRATION_ID = "fixture-editions-v1"


def migrate(conn: sqlite3.Connection) -> dict:
    """Run inside the caller's transaction, normally after a verified DB backup.

    Only an applied operation's own fixture receives its approval. Global badges
    and upload status never confer approval on another fixture. Legacy rows and
    publication receipts are retained verbatim for rollback and audit.
    """
    if not conn.in_transaction:
        raise ValueError("Fixture migration requires an explicit transaction.")
    editions.ensure_schema(conn)
    done = conn.execute("SELECT report_json FROM fixture_edition_migrations WHERE migration_id=?",
                        (MIGRATION_ID,)).fetchone()
    if done:
        return json.loads(done[0])
    now = editions.timestamp()
    report = {"seeded": 0, "snapshots_replayed": 0, "approved": 0, "unresolved_source": 0}
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    report["original_identities_registered"] = editions.register_original_sources(conn)
    returned = "" if "external_edit_returns" not in tables else """AND NOT EXISTS (
        SELECT 1 FROM external_edit_returns r WHERE r.source_version_id=v.version_id)"""
    for row in conn.execute(f"""SELECT d.fixture_id,d.asset_id,a.photos_title,a.photos_keywords_json,
        (SELECT version_id FROM asset_source_versions v WHERE v.asset_id=d.asset_id
         AND v.source_exists=1 {returned} ORDER BY v.created_at DESC,v.version_id DESC LIMIT 1) source_version_id
        FROM fixture_asset_decisions d JOIN sidecar_assets a USING(asset_id)
        JOIN fixtures f ON f.fixture_id=d.fixture_id""").fetchall():
        editions.seed_edition(conn, row["fixture_id"], row["asset_id"],
            source_version_id=row["source_version_id"] or "", title=row["photos_title"] or "",
            keywords=json.loads(row["photos_keywords_json"] or "[]"), provenance="migration-original", now=now)
        report["seeded"] += 1
    # Review operations carry exact before/after metadata and the source version
    # accepted by the writer. Unscoped global state is deliberately not replayed.
    operations = conn.execute("""SELECT * FROM fixture_review_operations
        WHERE state != 'undone' ORDER BY created_at,operation_id""").fetchall()
    for operation in operations:
        fixture_id = operation["fixture_id"]
        for snapshot in json.loads(operation["after_json"] or "[]"):
            asset_id = snapshot.get("assetId", "")
            before = editions.get_edition(conn, fixture_id, asset_id)
            if before is None:
                continue
            decision = snapshot.get("decision") or {}
            editorial = snapshot.get("editorial") or {}
            delivery = snapshot.get("delivery") or {}
            source = delivery.get("source_version_hash") or before["source_version_id"]
            valid_source = bool(conn.execute("""SELECT 1 FROM asset_source_versions
                WHERE asset_id=? AND version_id=? AND source_exists=1""", (asset_id,source)).fetchone())
            # If a historical approval has no exact image identity, preserve its
            # metadata as a draft rather than silently approving today's image.
            approval_has_source = bool(delivery.get("source_version_hash")) and valid_source
            state = editorial.get("editorial_state", "unreviewed")
            country = snapshot.get("countryAssignment") or {}
            if isinstance(country,list): country=country[0] if country else {}
            country = country.get("country_slug",before["country"])
            replay = {**before,"title":decision.get("title") or "", "keywords_json":decision.get("keywords_json") or "[]",
                      "source_version_id":source if valid_source else before["source_version_id"],"country":country}
            if state == "approved" and operation["action"] != "approve":
                if before["editorial_state"] != "approved" or editions.revision_hash(replay) != editions.revision_hash(before):
                    state = "unreviewed"
            if state == "approved" and not approval_has_source:
                state = "unreviewed"
                report["unresolved_source"] += 1
            conn.execute("""UPDATE fixture_asset_editions SET title=?,keywords_json=?,country=?,
                source_version_id=?,editorial_state=?,approved_revision_hash='',approved_at=NULL,
                ai_reasons_json=?,ai_note=?,ai_attempt_count=?,ai_last_error=?,
                visual_ai_request_json=?,requested_at=?,proposed_at=?,updated_at=?,provenance=?
                WHERE fixture_id=? AND asset_id=?""", (
                decision.get("title") or "", decision.get("keywords_json") or "[]", country,
                source if valid_source else before["source_version_id"], state,
                editorial.get("ai_reasons_json") or "[]", editorial.get("ai_note") or "",
                editorial.get("ai_attempt_count") or 0, editorial.get("ai_last_error") or "",
                editorial.get("visual_ai_request_json") or "{}", editorial.get("requested_at"),
                editorial.get("proposed_at"), operation["created_at"],
                "review-operation:" + operation["operation_id"], fixture_id,asset_id))
            if state == "approved":
                edition = editions.get_edition(conn, fixture_id, asset_id)
                editions.approve_edition(conn, fixture_id, asset_id,
                    expected_revision=editions.revision_hash(edition),
                    actor=operation["actor"], now=operation["created_at"],
                    provenance="review-operation:" + operation["operation_id"])
            if "asset_ai_proposals" in tables and operation["action"] in ("request-ai","approve"):
                for proposal in snapshot.get("proposals") or []:
                    if proposal.get("status") in ("ready","loaded"):
                        conn.execute("UPDATE asset_ai_proposals SET fixture_id=? WHERE proposal_id=? AND fixture_id=''",
                                     (fixture_id,proposal["proposal_id"]))
            report["snapshots_replayed"] += 1
    # Existing immutable receipts remain untouched. Recognize an already-uploaded
    # version only in the fixture explicitly named by its publication receipt.
    report["uploaded_receipts_retained"] = 0
    if "asset_publications" in tables:
        for edition in conn.execute("SELECT * FROM fixture_asset_editions WHERE editorial_state='approved'").fetchall():
            receipt = conn.execute("""SELECT 1 FROM asset_publications WHERE fixture_id=? AND asset_id=?
                AND source_version_hash=? AND state='live'""",(edition["fixture_id"],edition["asset_id"],edition["source_version_id"])).fetchone()
            if receipt:
                conn.execute("""UPDATE fixture_edition_delivery SET delivery_state='live',receipt_version_hash=source_version_hash
                    WHERE fixture_id=? AND asset_id=? AND revision_hash=?""",(edition["fixture_id"],edition["asset_id"],edition["approved_revision_hash"]))
                report["uploaded_receipts_retained"] += 1
    report["approved"] = conn.execute("SELECT COUNT(*) FROM fixture_asset_editions WHERE editorial_state='approved'").fetchone()[0]
    conn.execute("INSERT INTO fixture_edition_migrations VALUES (?,?,?)", (MIGRATION_ID,now,editions.encoded(report)))
    return report


def main():
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, required=True)
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--commit', action='store_true', help='Migrate the original; otherwise migrate only the backup copy.')
    args = parser.parse_args()
    if not args.database.is_file() or args.backup.exists():
        parser.error('The database must exist and the backup path must be new.')
    args.backup.parent.mkdir(parents=True, exist_ok=True)
    source = sqlite3.connect(f'file:{args.database.resolve()}?mode=ro', uri=True)
    with sqlite3.connect(args.backup) as backup:
        source.backup(backup)
        if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise RuntimeError('Backup failed its integrity check.')
    source.close()
    target = args.database if args.commit else args.backup
    with sqlite3.connect(target) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute('PRAGMA foreign_keys=ON')
        conn.execute('BEGIN IMMEDIATE')
        result = migrate(conn)
        if conn.execute('PRAGMA integrity_check').fetchone()[0] != 'ok' or conn.execute('PRAGMA foreign_key_check').fetchone():
            raise RuntimeError('Migration failed its integrity checks; changes rolled back.')
        conn.commit()
    print(json.dumps(dict(result, committed=args.commit, database=str(target), backup=str(args.backup)), indent=2))


if __name__ == '__main__':
    main()
