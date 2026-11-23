"""Synthetic guarded metadata-only repair, with no live authority or deployment."""

from contextlib import closing
import sqlite3
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from legacy_r2_recovery_test import LegacyRecoveryTest
from legacy_r2_catalog import repair_catalog_metadata, repaired_catalog
from legacy_r2_evidence import RecoveryError, sha256
from catalog_authority_client_test import FakeAuthority
from owner_catalog_projection import _save_authority_enrollment


class LegacyCatalogTest(unittest.TestCase):
    def setUp(self):
        self.fixture = LegacyRecoveryTest()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)
        self.plan = self.fixture.plan()
        self.fixture.apply(self.plan)
        self.remote = FakeAuthority()
        self.client = self.remote.client()
        prepared = self.client.prepare(self.plan["owner"]["revision"], self.plan["owner"]["catalogSha256"])
        self.remote.public_sha = self.plan["owner"]["catalogSha256"]
        verified = self.client.commit(prepared)
        with closing(sqlite3.connect(self.fixture.owner)) as db, db:
            _save_authority_enrollment(db, verified)
        self.remote.calls.clear()

    def repair(self):
        return repair_catalog_metadata(self.fixture.root, self.plan,
            approved_plan_sha256=self.plan["planSha256"], object_reader=self.fixture.reader,
            catalog_reader=lambda: self.fixture.payload, authority_client=self.client)

    def test_metadata_patch_only_three_existing_asset_rows(self):
        changed = repaired_catalog(self.fixture.payload, self.plan)
        # Compare every logical row, including listing, keywords and commerce.
        with closing(sqlite3.connect(':memory:')) as old, closing(sqlite3.connect(':memory:')) as new:
            old.deserialize(self.fixture.payload)
            new.deserialize(changed)
            names = [r[0] for r in old.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            for name in names:
                quoted = '"' + name.replace('"', '""') + '"'
                oldrows = old.execute('SELECT * FROM ' + quoted).fetchall()
                newrows = new.execute('SELECT * FROM ' + quoted).fetchall()
                if name == 'media_assets':
                    columns = [r[1] for r in old.execute('PRAGMA table_info(media_assets)')]
                    permitted = {r[0] for r in old.execute("SELECT asset_type_id FROM asset_types WHERE code IN ('full','still_900','still_1800')")}
                    for index, (oldrow, newrow) in enumerate(zip(oldrows, newrows)):
                        if oldrow[0] == self.fixture.media and oldrow[1] in permitted:
                            oldrows[index] = tuple(None if name in {'width','height','bytes'} else value for name,value in zip(columns,oldrow))
                            newrows[index] = tuple(None if name in {'width','height','bytes'} else value for name,value in zip(columns,newrow))
                self.assertEqual(oldrows, newrows, name)
            rows = new.execute("SELECT bytes FROM media_assets JOIN asset_types USING(asset_type_id) WHERE media_id=? AND code IN ('still_900','still_1800')", (self.fixture.media,)).fetchall()
            self.assertEqual(rows, [(100,), (100,)])

    def test_guarded_projection_stays_pending_until_deployed(self):
        result = self.repair()
        self.assertEqual(result['state'], 'catalog_projection_prepared_not_deployed')
        self.assertEqual(result['addedListings'], 0)
        self.assertFalse(result['wholeSubjectReady'])
        self.assertEqual(self.remote.row['state'], 'pending')
        self.assertEqual(self.fixture.rows('SELECT state FROM public_catalog_publications'), [('local',)])
        self.assertEqual(self.fixture.rows('SELECT state FROM owner_public_catalog_authority_enrollment'), [('pending',)])
        self.assertEqual([body['phase'] for method,body in self.remote.calls if method=='POST'], ['prepare'])

    def test_replay_does_not_prepare_another_projection(self):
        self.repair()
        before = self.fixture.snapshot()
        calls = len(self.remote.calls)
        with self.assertRaisesRegex(RecoveryError, 'catalog_changed_or_not_deployed'):
            self.repair()
        self.assertEqual(len(self.remote.calls), calls)
        self.assertEqual(self.fixture.snapshot(), before)

    def test_revoked_approval_no_authority_call(self):
        self.fixture.mutate("UPDATE asset_editorial_state SET editorial_state='unreviewed'")
        with self.assertRaisesRegex(RecoveryError, 'legacy_approval_or_version_changed'):
            self.repair()
        self.assertEqual(self.remote.calls, [])

    def test_receipt_mismatch_no_authority_call(self):
        self.fixture.mutate("UPDATE fixture_delivery_receipts SET checksum_sha256=? WHERE object_key LIKE '%900.jpg'", ('f'*64,))
        with self.assertRaisesRegex(RecoveryError, 'legacy_delivery_proof_changed'):
            self.repair()
        self.assertEqual(self.remote.calls, [])

    def test_changed_object_no_authority_call(self):
        self.fixture.objects[2]['sha256'] = 'c'*64
        with self.assertRaisesRegex(RecoveryError, 'recovered_object_changed'):
            self.repair()
        self.assertEqual(self.remote.calls, [])

    def test_fixture_policy_change_blocks(self):
        self.fixture.mutate("UPDATE fixtures SET policy_overrides_json='{}',archived_at='now'")
        with self.assertRaisesRegex(RecoveryError, 'legacy_fixture_changed'):
            self.repair()
        self.assertEqual(self.remote.calls, [])

    def test_stale_observation_blocks_before_authority(self):
        original = self.fixture.reader
        self.fixture.reader = lambda b,k: {**original(b,k), 'checkedAt':'2020-01-01T00:00:00Z'}
        before = self.fixture.snapshot()
        with self.assertRaisesRegex(RecoveryError, 'object_evidence_expired'):
            self.repair()
        self.assertEqual(self.remote.calls, [])
        self.assertEqual(self.fixture.snapshot(), before)

    def test_wrong_receipt_visibility_blocks(self):
        self.fixture.mutate("UPDATE fixture_delivery_receipts SET visibility_policy='public' WHERE object_key LIKE 'masters/%'")
        with self.assertRaisesRegex(RecoveryError, 'legacy_delivery_proof_changed'):
            self.repair()
        self.assertEqual(self.remote.calls, [])

    def test_invalid_verification_time_blocks(self):
        self.fixture.mutate("UPDATE fixture_delivery_receipts SET verified_at='not-verified'")
        with self.assertRaisesRegex(RecoveryError, 'legacy_delivery_proof_changed'):
            self.repair()
        self.assertEqual(self.remote.calls, [])

    def test_source_cannot_write_production_owner(self):
        with patch('legacy_r2_runtime.CANONICAL_ROOT', self.fixture.root):
            with self.assertRaisesRegex(RecoveryError, 'installed_backstage_recovery_runtime_required'):
                self.repair()
        self.assertEqual(self.remote.calls, [])


if __name__ == '__main__':
    unittest.main()
