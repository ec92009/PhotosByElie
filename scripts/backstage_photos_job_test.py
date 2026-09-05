"""Security and compatibility checks with private, synthetic Owner fixtures."""
import base64
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import backstage_photos_job as jobs
import backstage_photos_client as client
from backstage_photos_client_test import FakeBackstagePreviewServer, JPEG
import requested_ai_previews_test as preview_fixtures
import local_server
import sidecar_state_db


class BackstagePhotosJobsTest(unittest.TestCase):
    def setUp(self):
        self.previous = jobs._CREDENTIAL
        jobs._CREDENTIAL = None
        self.capability = dict(jobID="synthetic-job", secret=base64.b64encode(b"k" * 32).decode(),
            expiresAt=time.time() + 300, dateFrom="2026-01-01", dateTo="")

    def tearDown(self):
        jobs._CREDENTIAL = self.previous

    def test_private_stdin_bootstrap_ignores_pythonpath_and_never_uses_environment_key(self):
        with tempfile.TemporaryDirectory() as temp:
            Path(temp, "sitecustomize.py").write_text("raise RuntimeError('injected')")
            Path(temp, "backstage_photos_job.py").write_text("raise RuntimeError('injected')")
            bootstrap = ("import sys,os,json;sys.path.insert(0,sys.argv[1]);"
                "import backstage_photos_job as j;j.initialize();"
                "print(json.dumps({'job':j.credential()['jobID'],'flag':'PBE_PHOTOS_JOB_STDIN' in os.environ}))")
            result = subprocess.run([sys.executable, "-I", "-S", "-B", "-c", bootstrap,
                str(Path(__file__).resolve().parent)], input=json.dumps(self.capability)+"\n",
                text=True, capture_output=True, cwd=temp,
                env={**os.environ, "PYTHONPATH":temp, "PBE_PHOTOS_JOB_STDIN":"1"}, check=True)
            self.assertEqual(json.loads(result.stdout), {"job":"synthetic-job", "flag":False})
            self.assertNotIn(self.capability["secret"], result.stdout + result.stderr)

    def test_client_sends_signed_exact_request_and_handles_descriptor_only_denial(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            def accept(envelope):
                raw = base64.b64decode(envelope["request"])
                signature = base64.b64decode(envelope["signature"])
                self.assertTrue(hmac.compare_digest(signature, hmac.new(b"k"*32, raw, hashlib.sha256).digest()))
                request = json.loads(raw)
                return dict(ok=True, requestId=request["requestId"], assetId=request["assetId"],
                    mode="preview", bytes=len(JPEG), pixelWidth=800, pixelHeight=600,
                    mimeType="image/jpeg", dataBase64=base64.b64encode(JPEG).decode())
            jobs._CREDENTIAL = self.capability
            with FakeBackstagePreviewServer(root, accept) as server:
                receipt = client.request_preview("synthetic", root / "preview.jpg", 900, descriptor_path=server.descriptor)
                self.assertTrue(receipt["ok"])
                self.assertEqual((root / "preview.jpg").read_bytes(), JPEG)
        jobs._CREDENTIAL = None
        with tempfile.TemporaryDirectory() as temp:
            with FakeBackstagePreviewServer(Path(temp), lambda _: dict(ok=False, requestId="", code="photos_job_authorization_required")) as server:
                with self.assertRaises(client.BackstagePhotosClientError) as raised:
                    client.request_library_index(1, descriptor_path=server.descriptor)
                self.assertEqual(raised.exception.code, "photos_job_authorization_required")

    def test_expired_capability_cannot_make_a_request(self):
        jobs._CREDENTIAL = {**self.capability, "expiresAt":time.time()-1}
        with self.assertRaisesRegex(ValueError, "expired"):
            jobs.envelope(b"{}")

    def test_planner_limits_ai_and_delivery_to_named_fixture_assets(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            preview_fixtures.RequestedAIPreviewsTest()._requesting_fixture(root)
            sidecar_state_db.upsert_assets(root, [{"localIdentifier":"unrequested", "filename":"Other.JPG", "mediaType":"photo"}])
            ai = jobs.plan(root, {"actionKind":"sidecar-culling-review", "payload":{"manifest":{"mode":"fixture-ai-pass-start"}}})
            self.assertEqual(set(ai["assetIDs"]), {"asset-1", "asset-2"})
            self.assertEqual(ai["operations"], ["photos.preview"])
            delivery = jobs.plan(root, {"actionKind":"sidecar-upload-publish", "payload":{
                "workflow":"fixture-delivery", "fixtureId":"fixture-expo", "assetIds":["asset-1", "unrequested"]}})
            self.assertEqual(delivery["assetIDs"], ["asset-1"])
            self.assertEqual(jobs.plan(root, {"actionKind":"sidecar-upload-publish"})["operations"], [])

    def test_scope_query_opens_fresh_wal_database_without_allowing_writes(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            preview_fixtures.RequestedAIPreviewsTest()._requesting_fixture(root)
            self.assertEqual(len(jobs._rows(root, "SELECT asset_id FROM sidecar_assets")), 2)
            with self.assertRaises(sqlite3.OperationalError):
                jobs._rows(root, "UPDATE sidecar_assets SET filename='changed'")
            result = subprocess.run([sys.executable, "-I", "-S", "-B", "-c",
                "import sys,runpy;sys.path.insert(0,sys.argv[1]);sys.argv=sys.argv[2:];runpy.run_path(sys.argv[0],run_name='__main__')",
                str(Path(__file__).resolve().parent), str(Path(__file__).with_name("backstage_photos_job.py")), str(root)],
                input=json.dumps({"actionKind":"sidecar-culling-review", "payload":{"manifest":{"mode":"fixture-ai-pass-start"}}}),
                text=True,capture_output=True,env={"PATH":"/usr/bin:/bin:/usr/sbin:/sbin"},check=True)
            self.assertEqual(set(json.loads(result.stdout)["assetIDs"]), {"asset-1", "asset-2"})

    def test_ai_plan_uses_the_same_divergent_identity_as_preview_preparation(self):
        from fixture_pipeline import ai_preview_targets
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            preview_fixtures.RequestedAIPreviewsTest()._requesting_fixture(root, source_anchor="apple-photos://ANCHOR-A")
            action = {"actionKind":"sidecar-culling-review", "payload":{"manifest":{"mode":"fixture-ai-pass-start"}}}
            planned = jobs.plan(root, action)
            targets = ai_preview_targets(root, ["asset-1", "asset-2"])
            self.assertEqual(set(planned["assetIDs"]), {row["photoLibraryIdentifier"] for row in targets})
            self.assertIn("ANCHOR-A", planned["assetIDs"])
            self.assertNotIn("asset-1", planned["assetIDs"])

    def test_ai_prepares_before_detach_and_passes_ids_without_photos_credential(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            preview_fixtures.RequestedAIPreviewsTest()._requesting_fixture(root)
            events = []
            class Child:
                pid = 123
                stdin = io.BytesIO()
            child = Child()
            # Keep a copy after close, as the real pipe is intentionally closed.
            class Input(io.BytesIO):
                def close(self):
                    self.payload = self.getvalue()
                    super().close()
            child.stdin = Input()
            def prepare(*args):
                events.append("prepare")
                return {"requested":2,"captured":2,"failed":0}
            def launch(*args, **kwargs):
                events.append("launch")
                self.assertEqual(events, ["prepare", "launch"])
                self.assertIn("--prepared-assets-stdin", args[0])
                return child
            jobs._CREDENTIAL = self.capability
            with patch("requested_ai_previews.capture_requested_ai_previews", side_effect=prepare), patch("local_server.subprocess.Popen", side_effect=launch):
                receipt = local_server._start_requested_ai_pass(root, "scheduled")
            self.assertTrue(receipt["started"])
            self.assertEqual(set(json.loads(child.stdin.payload)), {"asset-1", "asset-2"})
            self.assertNotIn(self.capability["secret"].encode(), child.stdin.payload)


if __name__ == "__main__":
    unittest.main()
