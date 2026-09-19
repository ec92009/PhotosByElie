"""Production visual draft invariants; provider calls and Photos are mocked."""
import io
import json
import unittest
from unittest.mock import patch
from PIL import Image

import visual_repair_proposals_test as synthetic_tests
from fixture_pipeline import connect
import production_visual_repair as production
import visual_repair_proposals as visual


def image_bytes(color, format='JPEG'):
    output = io.BytesIO()
    Image.new('RGB', (768, 512), color).save(output, format=format)
    return output.getvalue()


class ProductionVisualRepairTests(unittest.TestCase):
    def setUp(self):
        self.fixture = synthetic_tests.VisualRepairProposalsTest()
        self.fixture.setUp()
        self.root = self.fixture.root
        self.config = patch.object(production, 'configuration', return_value={'configured': True})
        self.config.start()
        self.before = image_bytes('gray')
        self.after = image_bytes('white', 'PNG')
        with connect(self.root) as conn:
            conn.execute("INSERT OR IGNORE INTO asset_editorial_state(asset_id,editorial_state,updated_at) VALUES ('asset-1','approved','2026-09-19T20:00:00Z')")
            conn.execute("UPDATE asset_editorial_state SET editorial_state='approved',visual_ai_request_json=? WHERE asset_id='asset-1'", (json.dumps({'reasons':['contrast'],'sourceVersionId':'source-v1','requestedAt':'2026-09-19T20:00:00Z','status':'awaiting-generator'}),))
            conn.commit()

    def tearDown(self):
        self.config.stop()
        self.fixture.tearDown()

    def preview(self, photo_id, destination, max_pixel, timeout):
        self.assertEqual(photo_id, 'asset-1')
        self.assertEqual(max_pixel, 1800)
        destination.write_bytes(self.before)

    def start(self, **kwargs):
        return production.start_generation(self.root, 'fixture-la-concha', 'asset-1', 'source-v1', ['contrast'],
            preview_runner=self.preview, launch_worker=False, **kwargs)

    def editor(self, before, categories):
        self.assertEqual(before.read_bytes(), self.before)
        self.assertEqual(categories, ['contrast'])
        return self.after, {'requestId':'test-provider-request','model':production.MODEL}

    def test_ready_has_real_artifacts_and_preserves_editorial_state(self):
        proposal = self.start(idempotency_key='one')
        result = production.run_generation(self.root, proposal['proposalId'], editor=self.editor)
        self.assertEqual(result['generationState'], 'ready')
        self.assertTrue(result['derivedAvailable'])
        self.assertNotEqual(result['derivedSha256'], result['originalPreviewSha256'])
        self.assertEqual(result['resolvedModel'], production.MODEL)
        with connect(self.root) as conn:
            self.assertEqual(conn.execute("SELECT editorial_state FROM asset_editorial_state WHERE asset_id='asset-1'").fetchone()[0], 'approved')
            self.assertEqual(json.loads(conn.execute("SELECT raw_json FROM sidecar_assets WHERE asset_id='asset-1'").fetchone()[0])["title"], 'Original title')
        self.assertEqual(self.start()['proposalId'], proposal['proposalId'])

    def test_duplicate_requests_do_not_capture_or_generate_twice(self):
        proposal = self.start(idempotency_key='one')
        with patch.object(self, 'preview', side_effect=AssertionError('duplicate capture')):
            replay = self.start(idempotency_key='two')
        self.assertEqual(replay['proposalId'], proposal['proposalId'])
        production.run_generation(self.root, proposal['proposalId'], editor=self.editor)
        result = production.run_generation(self.root, proposal['proposalId'], editor=lambda *_: self.fail('duplicate provider'))
        self.assertEqual(result['generationState'], 'ready')

    def test_generation_never_runs_library_wide_schema_backfills(self):
        with patch('fixture_pipeline.ensure_schema', side_effect=AssertionError('library backfill')), \
             patch('sidecar_state_db.ensure_schema', side_effect=AssertionError('library backfill')):
            proposal = self.start()
            result = production.run_generation(self.root, proposal['proposalId'], editor=self.editor)
        self.assertEqual(result['generationState'], 'ready')

    def test_missing_or_changed_saved_intent_prevents_generation(self):
        with connect(self.root) as conn:
            conn.execute("UPDATE asset_editorial_state SET visual_ai_request_json='{}'")
            conn.commit()
        with self.assertRaisesRegex(ValueError, 'explicit visual'):
            self.start()

    def test_cancellation_during_provider_never_attaches_result(self):
        proposal = self.start()
        def editor(*args):
            production.cancel_generation(self.root, 'fixture-la-concha', proposal['proposalId'])
            return self.editor(*args)
        result = production.run_generation(self.root, proposal['proposalId'], editor=editor)
        self.assertEqual(result['generationState'], 'cancelled')
        self.assertFalse(result['derivedAvailable'])

    def test_provider_failure_is_durable_and_retry_is_new_attempt(self):
        proposal = self.start()
        def broken(*_): raise RuntimeError('Provider unavailable')
        failed = production.run_generation(self.root, proposal['proposalId'], editor=broken)
        self.assertEqual(failed['generationState'], 'failed')
        self.assertEqual(failed['generationError'], 'Provider unavailable')
        retry = self.start()
        self.assertEqual(retry['attempt'], 2)
        self.assertNotEqual(retry['proposalId'], proposal['proposalId'])

    def test_source_change_before_completion_does_not_attach(self):
        proposal = self.start()
        def editor(*args):
            with connect(self.root) as conn:
                conn.execute("UPDATE asset_source_versions SET source_exists=0 WHERE version_id='source-v1'")
                conn.commit()
            return self.editor(*args)
        result = production.run_generation(self.root, proposal['proposalId'], editor=editor)
        self.assertEqual(result['generationState'], 'failed')
        self.assertFalse(result['derivedAvailable'])

    def test_input_tampering_stops_before_provider(self):
        proposal = self.start()
        (production.artifact_root(self.root, proposal['proposalId'])/'before.jpg').write_bytes(self.after)
        result = production.run_generation(self.root, proposal['proposalId'], editor=lambda *_: self.fail('tampered input sent'))
        self.assertEqual(result['generationState'], 'failed')

    def test_regeneration_preserves_previous_draft_until_new_one_is_ready(self):
        first = self.start()
        production.run_generation(self.root, first['proposalId'], editor=self.editor)
        second = self.start(regenerate=True)
        with connect(self.root) as conn:
            self.assertTrue(production._row(conn, first['proposalId'])['derived_available'])
        production.run_generation(self.root, second['proposalId'], editor=self.editor)
        with connect(self.root) as conn:
            self.assertEqual(production._row(conn, first['proposalId'])['status'], 'superseded')

    def test_photo_capability_is_bound_to_the_requested_asset(self):
        import backstage_photos_job
        plan = backstage_photos_job.plan(self.root, {'actionKind':'sidecar-culling-review', 'payload':{'manifest':{
            'mode':'fixture-visual-repair-generate','fixtureId':'fixture-la-concha','assetId':'asset-1','sourceVersionId':'source-v1'}}})
        self.assertEqual(plan['operations'], ['photos.preview'])
        self.assertEqual(plan['assetIDs'], ['asset-1'])
        self.assertEqual(plan['writes'], [])

    def test_hidden_photo_cannot_generate_from_an_ancestor_pick(self):
        with connect(self.root) as conn:
            conn.execute("UPDATE fixture_asset_decisions SET placement_state='hidden' WHERE fixture_id='fixture-la-concha'")
            conn.commit()
        with self.assertRaisesRegex(ValueError, 'no longer picked'):
            self.start()

    def test_expired_worker_can_be_retried(self):
        first = self.start()
        with connect(self.root) as conn:
            conn.execute("UPDATE visual_repair_proposals SET updated_at='2026-01-01T00:00:00Z'")
            conn.commit()
        retry = self.start()
        self.assertNotEqual(first['proposalId'], retry['proposalId'])
        with connect(self.root) as conn:
            self.assertEqual(production._row(conn, first['proposalId'])['generation_state'], 'failed')


if __name__ == '__main__': unittest.main()
