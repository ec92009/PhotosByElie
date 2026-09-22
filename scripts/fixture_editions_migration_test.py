"""Migration preserves legacy receipts, replays only scoped evidence, and rolls back."""
import json
import tempfile
from pathlib import Path
import unittest
from fixture_pipeline import connect, create_fixture, set_fixture_asset_state, apply_fixture_review_action
from sidecar_state_db import upsert_assets
from fixture_editions_migration import migrate
from fixture_editions import get_edition

class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        upsert_assets(self.root,[dict(localIdentifier='photo',filename='one.jpg',mediaType='photo')])
        self.a=create_fixture(self.root,'Expo')['fixtureId'];self.b=create_fixture(self.root,'Marketing')['fixtureId']
        for f in (self.a,self.b):set_fixture_asset_state(self.root,f,['photo'],'picked')
        # A source receipt already exists at approval time, as in native Review.
        with connect(self.root) as c:
            c.execute("INSERT INTO asset_source_versions(version_id,asset_id,metadata_fingerprint,rendered_fingerprint,state,source_exists,created_at) VALUES ('original','photo','meta','pixels','candidate',1,'2026-01-01')")
            c.execute("UPDATE asset_delivery_state SET source_version_hash='original' WHERE asset_id='photo'")
            c.commit()
        # Real legacy approve creates exact Review snapshots and source identity.
        apply_fixture_review_action(self.root,self.a,['photo'],'approve',title='Expo accepted',keywords=['Expo'])
    def tearDown(self):self.temp.cleanup()
    def test_scoped_replay_idempotence_and_preserved_legacy_rows(self):
        with connect(self.root) as c:
            original=[tuple(r) for r in c.execute('SELECT * FROM asset_editorial_state')]
            c.execute('BEGIN IMMEDIATE');report=migrate(c);c.commit()
            self.assertEqual(get_edition(c,self.a,'photo')['editorial_state'],'approved')
            self.assertEqual(get_edition(c,self.b,'photo')['editorial_state'],'unreviewed')
            self.assertEqual(get_edition(c,self.a,'photo')['title'],'Expo accepted')
            self.assertEqual([tuple(r) for r in c.execute('SELECT * FROM asset_editorial_state')],original)
            c.execute('BEGIN IMMEDIATE');self.assertEqual(migrate(c),report);c.commit()
    def test_ambiguous_approval_does_not_approve_a_current_image(self):
        with connect(self.root) as c:
            row=c.execute('SELECT operation_id,after_json FROM fixture_review_operations').fetchone()
            snapshots=json.loads(row['after_json']);snapshots[0]['delivery']['source_version_hash']=''
            c.execute('UPDATE fixture_review_operations SET after_json=? WHERE operation_id=?',(json.dumps(snapshots),row['operation_id']));c.commit()
            c.execute('BEGIN IMMEDIATE');report=migrate(c);c.commit()
            self.assertEqual(get_edition(c,self.a,'photo')['editorial_state'],'unreviewed')
            self.assertEqual(report['unresolved_source'],1)
    def test_historical_upload_does_not_restore_live_after_a_metadata_edit(self):
        with connect(self.root) as c:
            c.execute("INSERT INTO asset_publications(asset_id,fixture_id,source_version_hash,state,published_at,created_at,updated_at) VALUES ('photo',?,'original','live','2026-01-01','2026-01-01','2026-01-01')",(self.a,))
            c.execute("UPDATE asset_delivery_state SET delivery_state='needs-upload' WHERE asset_id='photo'");c.commit()
            c.execute('BEGIN IMMEDIATE');report=migrate(c);c.commit()
            self.assertEqual(c.execute('SELECT delivery_state FROM fixture_edition_delivery WHERE fixture_id=?',(self.a,)).fetchone()[0],'needs-upload')
            self.assertEqual(report['uploaded_receipts_retained'],0)
            self.assertEqual(c.execute('SELECT state FROM asset_publications').fetchone()[0],'live')

    def test_rollback_removes_partial_schema_and_data(self):
        with connect(self.root) as c:
            c.execute('BEGIN IMMEDIATE');migrate(c);c.rollback()
            self.assertIsNone(c.execute("SELECT 1 FROM sqlite_master WHERE name='fixture_asset_editions'").fetchone())

if __name__=='__main__':unittest.main()
