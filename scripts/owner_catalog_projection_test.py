import sqlite3
from contextlib import closing
import tempfile
import unittest
from pathlib import Path
import shutil
import sys
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from owner_catalog_projection import (
    import_projection,
    project_catalog,
    verify_deployed_projection,
)
import owner_catalog_projection as projection
import catalog_authority_client as authority
import catalog_authority_client_test as authority_fixture


class OwnerCatalogProjectionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.owner = (self.root / "Owner.sqlite").resolve()
        self.catalog = (self.root / "reviewed.sqlite").resolve()
        shutil.copy2(
            Path(__file__).resolve().parents[1] / "assets/catalog/photosbyelie.sqlite",
            self.catalog,
        )

    def tearDown(self):
        self.temp.cleanup()

    def snapshot(self):
        with closing(sqlite3.connect(self.owner)) as conn, conn:
            return projection.projection_snapshot(conn, ensure_schema=False)

    def enrollment(self):
        with closing(sqlite3.connect(self.owner)) as conn, conn:
            return projection._authority_enrollment(conn)

    def initialize_authority(self, *, enroll=True):
        import_projection(self.owner, self.catalog, approved_policy="PBE-173")
        self.remote = authority_fixture.FakeAuthority()
        self.client = self.remote.client()
        self.remote.public_sha = self.snapshot()["sha256"]
        if enroll:
            projection.enroll_catalog_authority(self.owner, authority_client=self.client)
        self.remote.calls.clear()
        return self.snapshot()

    def changed_bytes(self):
        candidate = self.root / "candidate.sqlite"
        candidate.write_bytes(self.snapshot()["payload"])
        with closing(sqlite3.connect(candidate)) as conn, conn:
            conn.execute("UPDATE media_items SET title=title || ' changed' WHERE media_id="
                         "(SELECT media_id FROM media_items ORDER BY media_id LIMIT 1)")
        return candidate.read_bytes()

    def store(self, payload):
        with closing(sqlite3.connect(self.owner)) as conn, conn:
            return projection.store_projection(conn, payload, source_kind="offline-test", authority_client=self.client)

    def pin_temporary_owner_as_canonical(self):
        """Exercise the real path policy without touching production/config/HTTP."""
        root = (self.root / "canonical").resolve()
        owner = root / "assets/owner-actions/Owner.sqlite"
        owner.parent.mkdir(parents=True)
        self.owner.rename(owner)
        self.owner = owner
        pin = patch.object(authority, "CANONICAL_REPO_ROOT", root)
        pin.start()
        self.addCleanup(pin.stop)

    def backup_owner(self, destination):
        with closing(sqlite3.connect(self.owner)) as source, closing(sqlite3.connect(destination)) as backup:
            source.backup(backup)

    def restore_owner(self, source):
        with closing(sqlite3.connect(source)) as backup, closing(sqlite3.connect(self.owner)) as restored:
            backup.backup(restored)

    def test_unenrolled_canonical_absence_is_checked_under_write_lock_before_change(self):
        old = self.initialize_authority(enroll=False)
        candidate = self.changed_bytes()
        self.pin_temporary_owner_as_canonical()
        remote = self.remote

        def inspect_get(method, headers, body):
            self.assertEqual(method, "GET")
            self.assertIsNone(body)
            self.assertEqual(self.snapshot()["payload"], old["payload"])
            with closing(sqlite3.connect(self.owner, timeout=0)) as other:
                with self.assertRaisesRegex(sqlite3.OperationalError, "locked"):
                    other.execute("BEGIN IMMEDIATE")
            return remote(method, headers, body)

        self.client._transport = inspect_get
        with closing(sqlite3.connect(self.owner)) as conn, conn:
            # Even a caller-supplied deferred transaction must hold a write lock
            # during the fresh GET. No intermediate projection row is changed.
            conn.execute("BEGIN DEFERRED")
            result = projection.store_projection(conn, candidate, source_kind="offline-test", authority_client=self.client)
        self.assertTrue(result["changed"])
        self.assertEqual(self.snapshot()["revision"], old["revision"] + 1)
        self.assertEqual(self.snapshot()["payload"], candidate)
        self.assertIsNone(self.enrollment())
        self.assertEqual(self.remote.calls, [("GET", None)])

    def test_unenrolled_canonical_denied_unavailable_unknown_absence_leave_bytes_unchanged(self):
        old = self.initialize_authority(enroll=False)
        candidate = self.changed_bytes()
        self.pin_temporary_owner_as_canonical()
        for response in ((403, b'{}'), (503, b'{}'), (404, b'{}'),
                         (404, b'{"error":{"code":"not_found"}}'), (404, b'not JSON'),
                         ConnectionError("synthetic transport failure")):
            with self.subTest(response=response):
                transport = Mock(side_effect=response if isinstance(response, Exception) else None,
                                 return_value=response)
                self.client._transport = transport
                with self.assertRaises(authority.AuthorityError):
                    self.store(candidate)
                self.assertEqual(transport.call_args.args[0], "GET")
                self.assertEqual(transport.call_count, 1)
                self.assertEqual(self.snapshot(), old)
                self.assertIsNone(self.enrollment())

    def test_canonical_missing_config_blocks_but_identical_projection_stays_offline(self):
        old = self.initialize_authority(enroll=False)
        candidate = self.changed_bytes()
        self.pin_temporary_owner_as_canonical()
        with patch.object(authority, "CONFIG_PATH", self.root / "missing-connector.json"), \
                patch.object(authority, "_http_request", side_effect=AssertionError("no HTTP allowed")) as transport:
            with closing(sqlite3.connect(self.owner)) as conn, conn:
                before = conn.total_changes
                result = projection.store_projection(conn, old["payload"], source_kind="offline-test")
                self.assertFalse(result["changed"])
                self.assertEqual(conn.total_changes, before)
            with closing(sqlite3.connect(self.owner)) as conn, conn:
                with self.assertRaises(authority.AuthorityError):
                    projection.store_projection(conn, candidate, source_kind="offline-test")
            transport.assert_not_called()
        self.assertEqual(self.snapshot(), old)

    def test_canonical_legacy_noop_does_not_recreate_missing_enrollment_schema(self):
        old = self.initialize_authority(enroll=False)
        self.pin_temporary_owner_as_canonical()
        with closing(sqlite3.connect(self.owner)) as conn, conn:
            conn.execute("DROP TABLE owner_public_catalog_authority_enrollment")
        with patch.object(authority, "client_for_owner", side_effect=AssertionError("no credentials for no-op")):
            with closing(sqlite3.connect(self.owner)) as conn, conn:
                schema = conn.execute("SELECT sql FROM sqlite_master ORDER BY name").fetchall()
                changes = conn.total_changes
                result = projection.store_projection(conn, old["payload"], source_kind="offline-test")
                self.assertFalse(result["changed"])
                self.assertEqual(conn.total_changes, changes)
                self.assertEqual(conn.execute("SELECT sql FROM sqlite_master ORDER BY name").fetchall(), schema)
        self.assertEqual(self.snapshot(), old)

    def test_whole_owner_pre_enrollment_restore_cannot_bypass_remote_pending_or_verified(self):
        old = self.initialize_authority(enroll=False)
        candidate = self.changed_bytes()
        self.pin_temporary_owner_as_canonical()
        backup = self.root / "before-enrollment.sqlite"
        self.backup_owner(backup)
        # Also cover a real legacy backup made before the guard table existed.
        with closing(sqlite3.connect(self.owner)) as conn, conn:
            conn.execute("DROP TABLE owner_public_catalog_authority_enrollment")
        legacy_backup = self.root / "before-schema.sqlite"
        self.backup_owner(legacy_backup)
        projection.enroll_catalog_authority(self.owner, authority_client=self.client)
        self.assertEqual(self.enrollment()["state"], "verified")
        remote_verified = dict(self.remote.row)
        for restored_backup in (backup, legacy_backup):
            for state in ("pending", "verified"):
                with self.subTest(backup=restored_backup.name, remote_state=state):
                    self.restore_owner(restored_backup)
                    self.assertIsNone(self.enrollment())
                    self.remote.row = {**remote_verified, "state": state}
                    self.remote.calls.clear()
                    with self.assertRaisesRegex(RuntimeError, "explicit re-enrollment/recovery"):
                        self.store(candidate)
                    self.assertEqual(self.snapshot(), old)
                    self.assertIsNone(self.enrollment())
                    self.assertEqual(self.remote.calls, [("GET", None)])
                    self.assertEqual(self.remote.row, {**remote_verified, "state": state})

    def test_whole_owner_older_enrolled_restore_still_rejects_remote_newer_revision(self):
        old = self.initialize_authority()
        self.pin_temporary_owner_as_canonical()
        backup = self.root / "older-enrolled.sqlite"
        self.backup_owner(backup)
        candidate = self.changed_bytes()
        self.store(candidate)
        self.remote.public_sha = projection.sha256_bytes(candidate)
        receipt = verify_deployed_projection(self.owner, fetch=lambda _url: (200, candidate), authority_client=self.client)
        self.assertEqual(receipt["state"], "verified")
        divergent_candidate = self.changed_bytes()
        self.restore_owner(backup)
        self.assertEqual(self.snapshot(), old)
        self.remote.calls.clear()
        # Same next revision, but different bytes than the remotely verified one.
        with self.assertRaises(authority.AuthorityError):
            self.store(divergent_candidate)
        self.assertEqual(self.snapshot(), old)
        self.assertEqual(self.remote.calls, [("GET", None)])

    def test_explicit_enrollment_is_exact_and_stores_no_secret(self):
        current = self.initialize_authority()
        row = self.enrollment()
        self.assertEqual(row["state"], "verified")
        self.assertEqual(row["projectionRevision"], current["revision"])
        self.assertEqual(row["sha256"], current["sha256"])
        self.assertEqual(row["operationId"], authority.operation_id(current["revision"], current["sha256"]))
        self.assertNotIn("synthetic-not-a-real-token", str(row))

    def test_enrollment_remote_commit_failure_retains_durable_guard_and_retry_recovers(self):
        current = self.initialize_authority(enroll=False)
        self.remote.public_sha = None
        with self.assertRaises(authority.AuthorityError):
            projection.enroll_catalog_authority(self.owner, authority_client=self.client)
        self.assertEqual(self.enrollment()["state"], "pending")
        self.assertEqual(self.snapshot()["sha256"], current["sha256"])
        self.assertEqual(self.remote.row["state"], "pending")
        calls = len(self.remote.calls)
        with self.assertRaisesRegex(RuntimeError, "pending projection"):
            self.store(self.changed_bytes())
        self.assertEqual(len(self.remote.calls), calls)
        self.remote.public_sha = current["sha256"]
        projection.enroll_catalog_authority(self.owner, authority_client=self.client)
        prepares = [body for method, body in self.remote.calls if method == "POST" and body["phase"] == "prepare"]
        self.assertEqual(len(prepares), 1)

    def test_enrollment_local_commit_failures_never_leave_verified_without_guard(self):
        self.initialize_authority(enroll=False)
        real_connect = sqlite3.connect
        target = self.owner.as_uri() + "?mode=rw"
        for fail_at in (1, 2):
            with self.subTest(local_commit=fail_at):
                class FailingCommit(sqlite3.Connection):
                    commit_count = 0

                    def commit(conn):
                        conn.commit_count += 1
                        if conn.commit_count == fail_at:
                            raise sqlite3.OperationalError("synthetic local durability failure")
                        return super().commit()

                def connect(path, *args, **kwargs):
                    if path == target:
                        kwargs["factory"] = FailingCommit
                    return real_connect(path, *args, **kwargs)

                self.remote.calls.clear()
                with patch.object(projection.sqlite3, "connect", side_effect=connect):
                    with self.assertRaises(sqlite3.OperationalError):
                        projection.enroll_catalog_authority(self.owner, authority_client=self.client)
                commits = [body for method, body in self.remote.calls if method == "POST" and body["phase"] == "commit"]
                if fail_at == 1:
                    self.assertIsNone(self.enrollment())
                    self.assertEqual(self.remote.row["state"], "pending")
                    self.assertEqual(commits, [])
                else:
                    self.assertEqual(self.enrollment()["state"], "pending")
                    self.assertEqual(self.remote.row["state"], "verified")
                    self.assertEqual(len(commits), 1)
        projection.enroll_catalog_authority(self.owner, authority_client=self.client)
        self.assertEqual(self.enrollment()["state"], "verified")

    def test_enrollment_guard_is_visible_before_remote_commit_and_blocks_intervening_writer(self):
        current = self.initialize_authority(enroll=False)
        candidate = self.changed_bytes()

        def inspect_commit(body):
            if body["phase"] == "commit":
                self.assertEqual(self.enrollment()["state"], "pending")
                self.assertEqual(self.enrollment()["sha256"], current["sha256"])

        self.remote.before_post = inspect_commit
        real_connect = sqlite3.connect
        target = self.owner.as_uri() + "?mode=rw"

        class InterveningWriter(sqlite3.Connection):
            commit_count = 0

            def commit(conn):
                super().commit()
                conn.commit_count += 1
                if conn.commit_count == 1:
                    with self.assertRaisesRegex(RuntimeError, "pending projection"):
                        self.store(candidate)

        def connect(path, *args, **kwargs):
            if path == target:
                kwargs["factory"] = InterveningWriter
            return real_connect(path, *args, **kwargs)

        with patch.object(projection.sqlite3, "connect", side_effect=connect):
            projection.enroll_catalog_authority(self.owner, authority_client=self.client)
        self.assertEqual(self.snapshot()["sha256"], current["sha256"])
        self.assertEqual(self.enrollment()["state"], "verified")

    def test_unchanged_replay_and_unenrolled_writer_never_contact_authority(self):
        self.initialize_authority(enroll=False)
        with patch.object(authority, "client_for_owner", side_effect=AssertionError("must stay offline")):
            self.store(self.changed_bytes())
        current = self.initialize_authority()
        with closing(sqlite3.connect(self.owner)) as conn, conn:
            before = conn.total_changes
            result = projection.store_projection(conn, current["payload"], source_kind="offline-test",
                                                 authority_client=self.client)
            self.assertEqual(conn.total_changes, before)
        self.assertFalse(result["changed"])
        self.assertEqual(self.remote.calls, [])

    def test_enrollment_rereads_projection_and_guard_after_reacquiring_lock(self):
        real_connect = sqlite3.connect
        for field in ("revision", "generation"):
            with self.subTest(changed=field):
                self.owner = (self.root / f"Owner-{field}.sqlite").resolve()
                self.initialize_authority(enroll=False)
                target = self.owner.as_uri() + "?mode=rw"

                class BetweenLocks(sqlite3.Connection):
                    commit_count = 0

                    def commit(conn):
                        super().commit()
                        conn.commit_count += 1
                        if conn.commit_count == 1:
                            # Simulate an incompatible old writer in a temp DB,
                            # not a supported mutation of the real Owner store.
                            table = ("owner_public_catalog_projections" if field == "revision"
                                     else "owner_public_catalog_authority_enrollment")
                            with closing(real_connect(self.owner)) as other, other:
                                other.execute(f"UPDATE {table} SET {field}={field}+1")

                def connect(path, *args, **kwargs):
                    if path == target:
                        kwargs["factory"] = BetweenLocks
                    return real_connect(path, *args, **kwargs)

                with patch.object(projection.sqlite3, "connect", side_effect=connect):
                    with self.assertRaises(RuntimeError):
                        projection.enroll_catalog_authority(self.owner, authority_client=self.client)
                self.assertEqual(self.enrollment()["state"], "pending")
                self.assertEqual(self.remote.row["state"], "pending")
                phases = [body["phase"] for method, body in self.remote.calls if method == "POST"]
                self.assertEqual(phases, ["prepare"])

    def test_remote_prepare_precedes_local_update_and_rollback_never_rolls_back_cloud(self):
        current = self.initialize_authority()
        candidate = self.changed_bytes()

        def inspect_prepare(body):
            if body["phase"] == "prepare":
                self.assertEqual(self.snapshot()["sha256"], current["sha256"])

        self.remote.before_post = inspect_prepare
        conn = sqlite3.connect(self.owner)
        try:
            conn.execute("CREATE TABLE rollback_marker (value TEXT)")
            conn.execute("BEGIN IMMEDIATE")
            conn.execute("INSERT INTO rollback_marker VALUES ('must rollback')")
            projection.store_projection(conn, candidate, source_kind="offline-test", authority_client=self.client)
            conn.rollback()
            self.assertEqual(conn.execute("SELECT count(*) FROM rollback_marker").fetchone()[0], 0)
        finally:
            conn.close()
        self.assertEqual(self.snapshot()["sha256"], current["sha256"])
        self.assertEqual(self.remote.row["state"], "pending")
        self.assertEqual(self.remote.row["projectionRevision"], current["revision"] + 1)
        self.remote.before_post = None
        self.store(candidate)
        self.assertEqual([method for method, _ in self.remote.calls].count("POST"), 1)
        self.assertEqual(self.enrollment()["state"], "pending")

    def test_uncertain_prepare_keeps_local_bytes_then_blocks_a_different_candidate(self):
        current = self.initialize_authority()
        candidate = self.changed_bytes()
        self.remote.lost_phase = "prepare"
        with self.assertRaises(authority.AuthorityError):
            self.store(candidate)
        self.assertEqual(self.snapshot()["payload"], current["payload"])
        self.assertEqual(self.enrollment()["state"], "verified")
        with self.assertRaises(authority.AuthorityError):
            self.client.prepare(current["revision"] + 1, "e" * 64)
        self.store(candidate)
        self.assertEqual(self.snapshot()["payload"], candidate)
        self.assertEqual([method for method, _ in self.remote.calls].count("POST"), 1)

    def test_tampered_prepare_receipt_does_not_change_local_projection(self):
        current = self.initialize_authority()
        remote = self.remote

        def tamper(method, headers, body):
            status, result = remote(method, headers, body)
            if method == "POST":
                import json
                result = json.dumps({**json.loads(result), "sha256": "e" * 64}).encode()
            return status, result

        self.client._transport = tamper
        with self.assertRaises(authority.AuthorityError):
            self.store(self.changed_bytes())
        self.assertEqual(self.snapshot()["sha256"], current["sha256"])
        self.assertEqual(self.remote.row["state"], "pending")

    def test_stale_deploy_never_commits_pending_projection(self):
        old = self.initialize_authority()
        self.store(self.changed_bytes())
        self.remote.calls.clear()
        result = verify_deployed_projection(self.owner, fetch=lambda _url: (200, old["payload"]),
                                            authority_client=self.client)
        self.assertEqual(result["state"], "failed")
        self.assertEqual(self.remote.calls, [])
        self.assertEqual(self.remote.row["state"], "pending")
        self.assertEqual(self.enrollment()["state"], "pending")

    def test_projection_changed_during_fetch_cannot_commit_old_deploy(self):
        old = self.initialize_authority()
        candidate = self.changed_bytes()

        def fetch(_url):
            self.store(candidate)
            return 200, old["payload"]

        result = verify_deployed_projection(self.owner, fetch=fetch, authority_client=self.client)
        self.assertEqual(result["state"], "failed")
        phases = [body["phase"] for method, body in self.remote.calls if method == "POST"]
        self.assertEqual(phases, ["prepare"])
        self.assertEqual(self.snapshot()["sha256"], projection.sha256_bytes(candidate))
        self.assertEqual(self.enrollment()["state"], "pending")

    def test_exact_deploy_commits_and_lost_commit_replays_server_parity_check(self):
        self.initialize_authority()
        candidate = self.changed_bytes()
        self.store(candidate)
        self.remote.public_sha = projection.sha256_bytes(candidate)
        self.remote.lost_phase = "commit"
        result = verify_deployed_projection(self.owner, fetch=lambda _url: (200, candidate), authority_client=self.client)
        self.assertEqual(result["state"], "failed")
        self.assertEqual(self.enrollment()["state"], "pending")
        self.assertEqual(self.remote.row["state"], "verified")
        result = verify_deployed_projection(self.owner, fetch=lambda _url: (200, candidate), authority_client=self.client)
        self.assertEqual(result["state"], "verified")
        self.assertEqual(self.enrollment()["state"], "verified")
        commits = [body for method, body in self.remote.calls if method == "POST" and body["phase"] == "commit"]
        self.assertEqual(len(commits), 2)

    def test_enrolled_verifier_rejects_arbitrary_urls_without_fetch(self):
        self.initialize_authority()
        fetch = Mock(side_effect=AssertionError("must not fetch"))
        result = verify_deployed_projection(self.owner, public_url="https://other.example/catalog.sqlite",
                                            fetch=fetch, authority_client=self.client)
        self.assertEqual(result["state"], "failed")
        fetch.assert_not_called()
        self.assertEqual(self.remote.calls, [])

    def test_legacy_read_only_snapshot_does_not_initialize_enrollment_table(self):
        self.initialize_authority(enroll=False)
        with closing(sqlite3.connect(self.owner)) as conn, conn:
            conn.execute("DROP TABLE owner_public_catalog_authority_enrollment")
        with closing(sqlite3.connect(self.owner.as_uri() + "?mode=ro", uri=True)) as conn, conn:
            self.assertIsNotNone(projection.projection_snapshot(conn, ensure_schema=False))
            self.assertIsNone(projection._authority_enrollment(conn))
            self.assertIsNone(conn.execute("SELECT 1 FROM sqlite_master WHERE name='owner_public_catalog_authority_enrollment'").fetchone())

    def test_reviewed_import_retires_ai_and_projects_identical_bytes(self):
        imported = import_projection(
            self.owner,
            self.catalog,
            approved_policy="PBE-173",
        )
        self.assertTrue(imported["changed"])
        self.assertGreater(imported["mediaCount"], 0)

        first = self.root / "first.sqlite"
        second = self.root / "second.sqlite"
        first_result = project_catalog(self.owner, first)
        second_result = project_catalog(self.owner, second)
        self.assertEqual(first_result["sha256"], second_result["sha256"])
        self.assertEqual(first.read_bytes(), second.read_bytes())
        with closing(sqlite3.connect(first)) as conn, conn:
            self.assertEqual(
                conn.execute("SELECT count(*) FROM collections WHERE lower(slug) = 'ai'").fetchone()[0],
                0,
            )
            self.assertEqual(
                conn.execute("SELECT count(*) FROM source_origins WHERE lower(code) = 'ai'").fetchone()[0],
                0,
            )

        replay = import_projection(
            self.owner,
            first,
            approved_policy="PBE-173",
            expected_sha256=first_result["sha256"],
        )
        self.assertFalse(replay["changed"])
        self.assertEqual(replay["revision"], imported["revision"])

    def test_remote_verification_records_exact_parity_or_failure(self):
        imported = import_projection(
            self.owner,
            self.catalog,
            approved_policy="PBE-173",
        )
        projection = self.root / "projection.sqlite"
        project_catalog(self.owner, projection)
        payload = projection.read_bytes()
        with closing(sqlite3.connect(projection)) as catalog_conn, catalog_conn:
            included_media_id = str(
                catalog_conn.execute(
                    "SELECT media_id FROM media_items ORDER BY media_id LIMIT 1"
                ).fetchone()[0]
            )
        with closing(sqlite3.connect(self.owner)) as owner_conn, owner_conn:
            owner_conn.execute(
                """
                CREATE TABLE public_catalog_publications (
                  asset_id TEXT NOT NULL,
                  source_version_hash TEXT NOT NULL,
                  media_id TEXT NOT NULL,
                  state TEXT NOT NULL,
                  public_url TEXT NOT NULL DEFAULT '',
                  catalog_sha256 TEXT NOT NULL DEFAULT '',
                  error_text TEXT NOT NULL DEFAULT '',
                  created_at TEXT NOT NULL,
                  verified_at TEXT,
                  updated_at TEXT NOT NULL,
                  PRIMARY KEY (asset_id, source_version_hash)
                )
                """
            )
            owner_conn.executemany(
                """
                INSERT INTO public_catalog_publications (
                  asset_id, source_version_hash, media_id, state, created_at, updated_at
                ) VALUES (?, 'version-1', ?, ?, '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z')
                """,
                [
                    ("included", included_media_id, "local"),
                    ("removed", "not-in-projection", "live"),
                ],
            )
            owner_conn.commit()

        verified = verify_deployed_projection(
            self.owner,
            public_url="https://example.test/catalog.sqlite",
            fetch=lambda _url: (200, payload),
        )
        self.assertEqual(verified["state"], "verified")
        self.assertEqual(verified["remoteSha256"], imported["sha256"])
        with closing(sqlite3.connect(self.owner)) as owner_conn, owner_conn:
            self.assertEqual(
                owner_conn.execute(
                    "SELECT state, catalog_sha256 FROM public_catalog_publications WHERE asset_id = 'included'"
                ).fetchone(),
                ("live", imported["sha256"]),
            )
            self.assertEqual(
                owner_conn.execute(
                    "SELECT state, verified_at FROM public_catalog_publications WHERE asset_id = 'removed'"
                ).fetchone(),
                ("pending", None),
            )

        stale_path = self.root / "stale.sqlite"
        shutil.copy2(projection, stale_path)
        with closing(sqlite3.connect(stale_path)) as conn, conn:
            conn.execute(
                "UPDATE media_items SET title = title || ' stale' WHERE media_id = (SELECT media_id FROM media_items ORDER BY media_id LIMIT 1)"
            )
            conn.commit()
        failed = verify_deployed_projection(
            self.owner,
            public_url="https://example.test/catalog.sqlite",
            fetch=lambda _url: (200, stale_path.read_bytes()),
        )
        self.assertEqual(failed["state"], "failed")
        self.assertIn("does not match", failed["error"])
        with closing(sqlite3.connect(self.owner)) as conn, conn:
            self.assertEqual(
                conn.execute(
                    "SELECT count(*) FROM owner_public_catalog_deployments WHERE state = 'verified'"
                ).fetchone()[0],
                1,
            )
            self.assertEqual(
                conn.execute(
                    "SELECT count(*) FROM owner_public_catalog_deployments WHERE state = 'failed'"
                ).fetchone()[0],
                1,
            )


if __name__ == "__main__":
    unittest.main()
