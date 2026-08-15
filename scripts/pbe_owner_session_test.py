import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from scripts.pbe_owner_session import (
    CloudPBEOwnerSessionVerifier,
    PBEOwnerSessionError,
    PBEOwnerHostAuthenticator,
    PBEOwnerSessionStore,
    _connect_query_only,
    checkout_identity,
    repository_readiness,
)
from scripts.owner_connector_runtime import materialize_runtime
from unittest.mock import patch

import scripts.local_server as local_server
from scripts.local_server import (
    PhotosByElieLocalHandler,
    assert_pbe_owner_restore_scope,
    assert_pbe_owner_x_scope,
    move_to_waste_basket_gateway,
    pbe_owner_action_payload,
    pbe_owner_fixture_gallery,
)


class PBEOwnerSessionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.now = 2_000_000_000.0
        self.store = PBEOwnerSessionStore(now=lambda: self.now, lease_seconds=60)
        self.readiness = {
            "sourceIdentity": "owner-sqlite:sha256:abc",
            "catalogIdentity": "catalog-sqlite:sha256:def",
            "readinessIdentity": "pbe-readiness:sha256:ghi",
            "fixtureRevision": "fixture-revision:sha256:jkl",
            "lifecycleWriter": "pbb-79-waste-basket",
        }
        self.session = {
            "id": "pbe-owner-session-one",
            "state": "ready",
            "fixtureId": "fixture-la-concha",
            "fixtureBreadcrumb": "RE › La Concha",
            **self.readiness,
            "capabilities": ["gallery.read", "waste-basket.x", "waste-basket.restore"],
            "expiresAt": "2033-05-18T03:35:00Z",
        }

    def test_checkout_identity_rejects_dirty_hidden_or_stray_host_code(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "scripts").mkdir()
            (root / ".gitignore").write_text(
                "node_modules/\nscripts/ignored_shadow.py\n",
                encoding="utf-8",
            )
            (root / "scripts/pbe_owner_host_tracked_paths.txt").write_text(
                ":(glob)scripts/**/*.py\n",
                encoding="utf-8",
            )
            for name in ("local_server.py", "pbe_owner_session.py", "waste_basket_gateway.py"):
                (root / "scripts" / name).write_text(f"# {name}\n", encoding="utf-8")
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "PBE Test"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "pbe-test@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "add", "."], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "fixture"], check=True)

            clean_identity = checkout_identity(root)
            self.assertRegex(
                clean_identity,
                r"^git:[0-9a-f]{40,64}:pbe-host-sha256:[0-9a-f]{64}$",
            )

            ignored = root / "node_modules/example/index.js"
            ignored.parent.mkdir(parents=True)
            ignored.write_text("ignored dependency\n", encoding="utf-8")
            (root / "unrelated-untracked.txt").write_text("not host code\n", encoding="utf-8")
            self.assertEqual(checkout_identity(root), clean_identity)

            bytecode_cache = root / "scripts/__pycache__/local_server.cpython-314.pyc"
            bytecode_cache.parent.mkdir()
            bytecode_cache.write_bytes(b"isolated launch cache")
            self.assertEqual(checkout_identity(root), clean_identity)

            import_shadow = root / "scripts/json.py"
            import_shadow.write_text("raise RuntimeError('executed before attestation')\n", encoding="utf-8")
            with self.assertRaises(PBEOwnerSessionError) as stray:
                checkout_identity(root)
            self.assertEqual(stray.exception.code, "pbe_owner_checkout_stray_import")
            import_shadow.unlink()

            ignored_shadow = root / "scripts/ignored_shadow.py"
            ignored_shadow.write_text("raise RuntimeError('ignored shadow')\n", encoding="utf-8")
            with self.assertRaises(PBEOwnerSessionError) as ignored_stray:
                checkout_identity(root)
            self.assertEqual(ignored_stray.exception.code, "pbe_owner_checkout_stray_import")
            ignored_shadow.unlink()

            stray_executable = root / "scripts/stray-host-helper"
            stray_executable.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            stray_executable.chmod(0o755)
            with self.assertRaises(PBEOwnerSessionError) as executable:
                checkout_identity(root)
            self.assertEqual(executable.exception.code, "pbe_owner_checkout_stray_import")
            stray_executable.unlink()

            host = root / "scripts/local_server.py"
            host.write_text("# dirty tracked host\n", encoding="utf-8")
            with self.assertRaises(PBEOwnerSessionError) as dirty:
                checkout_identity(root)
            self.assertEqual(dirty.exception.code, "pbe_owner_checkout_dirty")

            subprocess.run(
                ["git", "-C", str(root), "checkout", "--", "scripts/local_server.py"],
                check=True,
            )
            subprocess.run(
                ["git", "-C", str(root), "update-index", "--assume-unchanged", "scripts/local_server.py"],
                check=True,
            )
            host.write_text("# hidden tracked host change\n", encoding="utf-8")
            with self.assertRaises(PBEOwnerSessionError) as hidden:
                checkout_identity(root)
            self.assertEqual(hidden.exception.code, "pbe_owner_checkout_content_mismatch")

    def test_installed_runtime_identity_and_static_host_use_split_roots(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime_root = root / "immutable-runtime"
            data_root = root / "mutable-data"
            data_root.mkdir()
            (data_root / "gallery.html").write_text(
                "<!doctype html><title>stale mutable checkout</title>\n",
                encoding="utf-8",
            )
            bootstrap_path = root / "host-bootstrap.json"
            process: subprocess.Popen[str] | None = None
            try:
                verification = materialize_runtime(repo_root, runtime_root, "HEAD")
                identity = checkout_identity(runtime_root)
                self.assertTrue(
                    identity.startswith(
                        f"runtime:{verification.revision}:pbe-host-sha256:"
                    )
                )
                self.assertRegex(
                    identity,
                    r"^runtime:[0-9a-f]{40,64}:pbe-host-sha256:[0-9a-f]{64}$",
                )

                environment = {
                    **os.environ,
                    "PBE_BACKSTAGE_BOOTSTRAP_SECRET": "split-root-bootstrap-secret",
                    "PBE_CONNECTOR_RUNTIME_ROOT": str(runtime_root),
                    "PBE_REPO_ROOT": str(data_root),
                    "PYTHONDONTWRITEBYTECODE": "1",
                }
                process = subprocess.Popen(
                    [
                        sys.executable,
                        str(runtime_root / "scripts/local_server.py"),
                        "0",
                        "--backstage-bootstrap-file",
                        str(bootstrap_path),
                    ],
                    cwd=data_root,
                    env=environment,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                deadline = time.monotonic() + 10
                while not bootstrap_path.exists() and time.monotonic() < deadline:
                    if process.poll() is not None:
                        stdout, stderr = process.communicate(timeout=1)
                        self.fail(f"Split-root host stopped early: {stderr or stdout}")
                    time.sleep(0.05)
                self.assertTrue(bootstrap_path.exists(), "Split-root host did not publish readiness")
                descriptor = json.loads(bootstrap_path.read_text(encoding="utf-8"))
                self.assertEqual(descriptor["checkoutIdentity"], identity)
                with urlopen(
                    f"http://127.0.0.1:{descriptor['port']}/gallery.html",
                    timeout=5,
                ) as response:
                    served = response.read()
                self.assertEqual(served, (runtime_root / "gallery.html").read_bytes())
                self.assertNotIn(b"stale mutable checkout", served)

                runtime_root.chmod(0o755)
                runtime_gallery = runtime_root / "gallery.html"
                runtime_gallery.chmod(0o644)
                runtime_gallery.write_text("tampered runtime\n", encoding="utf-8")
                with self.assertRaises(PBEOwnerSessionError) as tampered:
                    checkout_identity(runtime_root)
                self.assertEqual(
                    tampered.exception.code,
                    "pbe_owner_runtime_identity_unavailable",
                )
            finally:
                if process is not None and process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
                if runtime_root.exists():
                    for path in sorted(
                        [runtime_root, *runtime_root.rglob("*")],
                        key=lambda item: len(item.parts),
                        reverse=True,
                    ):
                        if not path.is_symlink():
                            path.chmod(0o700 if path.is_dir() else 0o600)

    def test_freezes_fixture_and_retains_only_token_digest(self) -> None:
        started = self.store.start("raw-secret-session-token", self.session, self.readiness)
        self.assertEqual(started["fixtureId"], "fixture-la-concha")
        self.assertNotIn("raw-secret-session-token", repr(self.store.__dict__))

        authorized = self.store.authorize(
            "raw-secret-session-token",
            self.session,
            self.readiness,
            heartbeat=True,
        )
        self.assertEqual(authorized["lifecycleWriter"], "pbb-79-waste-basket")

        mismatched = {**self.session, "fixtureId": "fixture-expo"}
        with self.assertRaisesRegex(PBEOwnerSessionError, "does not match") as caught:
            self.store.authorize("raw-secret-session-token", mismatched, self.readiness)
        self.assertEqual(caught.exception.code, "pbe_owner_session_mismatch")

    def test_cloud_verifier_uses_explicit_owner_host_user_agent(self) -> None:
        class Response:
            def __enter__(_self):
                return _self

            def __exit__(_self, *_args):
                return False

            def read(_self) -> bytes:
                return json.dumps({"session": self.session}).encode()

        def opener(request: Request, *, timeout: float):
            self.assertEqual(timeout, 5.0)
            self.assertEqual(
                request.get_header("User-agent"),
                "PhotosByElie-PBE-Owner-Host/1.0",
            )
            self.assertNotIn("Python-urllib", request.get_header("User-agent"))
            self.assertEqual(request.get_header("Authorization"), "Bearer cloud-token")
            return Response()

        verifier = CloudPBEOwnerSessionVerifier(opener=opener)
        self.assertEqual(verifier.verify("cloud-token"), self.session)

    def test_browser_handoff_is_one_time_and_unrelated_to_cloud_token(self) -> None:
        self.store.start("raw-secret-session-token", self.session, self.readiness)
        ticket = self.store.issue_browser_handoff("raw-secret-session-token")
        self.assertNotEqual(ticket, "raw-secret-session-token")
        self.assertNotIn(ticket, repr(self.store.__dict__))
        browser_session, attached = self.store.bootstrap_browser(ticket, self.readiness)
        self.assertNotEqual(browser_session, ticket)
        self.assertNotEqual(browser_session, "raw-secret-session-token")
        self.assertNotIn(browser_session, repr(self.store.__dict__))
        self.assertEqual(attached["fixtureId"], "fixture-la-concha")
        self.assertEqual(
            self.store.authorize_browser(browser_session, self.readiness)["id"],
            "pbe-owner-session-one",
        )

        with self.assertRaises(PBEOwnerSessionError) as reused:
            self.store.bootstrap_browser(ticket, self.readiness)
        self.assertEqual(reused.exception.code, "pbe_owner_browser_handoff_invalid")

        self.assertEqual(self.store.close_browser(browser_session)["state"], "closed")
        with self.assertRaises(PBEOwnerSessionError) as closed:
            self.store.authorize_browser(browser_session, self.readiness)
        self.assertEqual(closed.exception.code, "pbe_owner_session_expired")

    def test_loopback_http_handoff_sets_http_only_cookie_without_cloud_token(self) -> None:
        store = PBEOwnerSessionStore(now=lambda: self.now, lease_seconds=60)

        class Verifier:
            def verify(_self, token: str) -> dict:
                self.assertEqual(token, "raw-secret-session-token")
                return self.session

        server = ThreadingHTTPServer(("127.0.0.1", 0), PhotosByElieLocalHandler)
        server.pbe_host_authenticator = PBEOwnerHostAuthenticator(
            "one-use-bootstrap-secret",
            "git:" + "a" * 40,
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}/__photosbyelie/pbe-owner"
        try:
            with (
                patch("scripts.local_server.PBE_OWNER_SESSION_STORE", store),
                patch("scripts.local_server.PBE_OWNER_SESSION_VERIFIER", Verifier()),
                patch("scripts.local_server.repository_readiness", return_value=self.readiness),
                patch("scripts.local_server.apply_photo_action") as legacy_apply,
                patch("scripts.local_server.assert_pbe_owner_x_scope"),
                patch("scripts.local_server.queue_hosted_lifecycle_request", return_value={
                    "requestId": "hlr-opaque-one", "state": "queued",
                }) as queue_lifecycle,
                patch("scripts.local_server.hosted_lifecycle_request_status", return_value={
                    "requestId": "hlr-opaque-one", "state": "queued", "error": "",
                }) as hosted_status,
                patch("scripts.local_server.latest_hosted_lifecycle_request", return_value=None) as latest_status,
                patch("scripts.local_server.retry_hosted_lifecycle_projection", return_value={
                    "requestId": "hlr-opaque-one",
                    "state": "completed",
                    "authoritative_committed": True,
                    "projection": {"state": "applied", "retryable": False},
                    "catalogPublication": {"state": "pending", "receipt": None},
                }) as retry_projection,
            ):
                host_bootstrap = Request(
                    f"{base}/host/bootstrap",
                    data=json.dumps({"expectedCheckoutIdentity": "git:" + "a" * 40}).encode(),
                    method="POST",
                    headers={
                        "X-PBE-Host-Bootstrap": "one-use-bootstrap-secret",
                        "Content-Type": "application/json",
                    },
                )
                with urlopen(host_bootstrap) as response:
                    host_authorization = json.loads(response.read())["hostAuthorization"]
                self.assertNotIn("one-use-bootstrap-secret", repr(server.pbe_host_authenticator.__dict__))
                with self.assertRaises(HTTPError) as replayed_host_bootstrap:
                    urlopen(host_bootstrap)
                self.assertEqual(replayed_host_bootstrap.exception.code, 401)
                replayed_host_bootstrap.exception.close()

                unauthenticated_readiness = Request(
                    f"{base}/readiness?fixtureId=fixture-la-concha"
                )
                with self.assertRaises(HTTPError) as untrusted_host:
                    urlopen(unauthenticated_readiness)
                self.assertEqual(untrusted_host.exception.code, 401)
                untrusted_host.exception.close()

                start = Request(
                    f"{base}/session/start",
                    data=json.dumps({"fixtureId": "fixture-la-concha"}).encode(),
                    method="POST",
                    headers={
                        "Authorization": "Bearer raw-secret-session-token",
                        "X-PBE-Host-Authorization": host_authorization,
                        "Content-Type": "application/json",
                    },
                )
                with urlopen(start) as response:
                    started = json.loads(response.read())
                launch_url = started["launchUrl"]
                self.assertNotIn("raw-secret-session-token", launch_url)
                parsed = urlparse(launch_url)
                ticket = parse_qs(parsed.fragment)["pbe_owner_ticket"][0]

                bootstrap = Request(
                    f"{base}/browser/bootstrap",
                    data=json.dumps({"ticket": ticket}).encode(),
                    method="POST",
                    headers={
                        "Content-Type": "application/json",
                        "Origin": f"http://127.0.0.1:{server.server_port}",
                    },
                )
                with urlopen(bootstrap) as response:
                    cookie = response.headers["Set-Cookie"]
                    attached = json.loads(response.read())
                self.assertEqual(attached["session"]["fixtureId"], "fixture-la-concha")
                self.assertIn("HttpOnly", cookie)
                self.assertIn("SameSite=Strict", cookie)
                self.assertNotIn("raw-secret-session-token", cookie)

                status = Request(f"{base}/session", headers={"Cookie": cookie.split(";", 1)[0]})
                with urlopen(status) as response:
                    active = json.loads(response.read())
                self.assertEqual(active["session"]["id"], "pbe-owner-session-one")
                self.assertIsNone(active["latestAction"])

                heartbeat = Request(
                    f"{base}/session/heartbeat",
                    data=b"{}",
                    method="POST",
                    headers={
                        "Cookie": cookie.split(";", 1)[0],
                        "Content-Type": "application/json",
                        "Origin": f"http://127.0.0.1:{server.server_port}",
                    },
                )
                with urlopen(heartbeat) as response:
                    heartbeat_payload = json.loads(response.read())
                self.assertEqual(heartbeat_payload["session"]["state"], "ready")
                self.assertIsNone(heartbeat_payload["latestAction"])

                for headers, expected_status in (
                    ({
                        "Cookie": cookie.split(";", 1)[0],
                        "Content-Type": "application/json",
                        "Origin": f"http://127.0.0.1:{server.server_port + 1}",
                    }, 403),
                    ({
                        "Cookie": cookie.split(";", 1)[0],
                        "Content-Type": "text/plain",
                        "Origin": f"http://127.0.0.1:{server.server_port}",
                    }, 415),
                ):
                    rejected = Request(
                        f"{base}/session/heartbeat",
                        data=b"{}",
                        method="POST",
                        headers=headers,
                    )
                    with self.assertRaises(HTTPError) as blocked:
                        urlopen(rejected)
                    self.assertEqual(blocked.exception.code, expected_status)
                    blocked.exception.close()

                for endpoint in ("action", "action/projection-retry", "session/close"):
                    for headers, expected_status in (
                        ({
                            "Cookie": cookie.split(";", 1)[0],
                            "Content-Type": "application/json",
                            "Origin": f"http://127.0.0.1:{server.server_port + 1}",
                        }, 403),
                        ({
                            "Cookie": cookie.split(";", 1)[0],
                            "Content-Type": "text/plain",
                            "Origin": f"http://127.0.0.1:{server.server_port}",
                        }, 415),
                    ):
                        rejected = Request(
                            f"{base}/{endpoint}",
                            data=json.dumps({
                                "action": "waste-basket-x",
                                "photo_id": "photo-one",
                            }).encode(),
                            method="POST",
                            headers=headers,
                        )
                        with self.assertRaises(HTTPError) as blocked:
                            urlopen(rejected)
                        self.assertEqual(blocked.exception.code, expected_status)
                        blocked.exception.close()

                with urlopen(status) as response:
                    self.assertEqual(json.loads(response.read())["session"]["state"], "ready")

                lifecycle_action = Request(
                    f"{base}/action",
                    data=json.dumps({
                        "action": "waste-basket-x",
                        "photo_id": "photo-one",
                    }).encode(),
                    method="POST",
                    headers={
                        "Cookie": cookie.split(";", 1)[0],
                        "Content-Type": "application/json",
                        "Origin": f"http://127.0.0.1:{server.server_port}",
                        "Idempotency-Key": "browser-action-one",
                    },
                )
                with urlopen(lifecycle_action) as response:
                    self.assertEqual(response.status, 202)
                    queued = json.loads(response.read())
                self.assertEqual(queued, {
                    "ok": True, "requestId": "hlr-opaque-one", "state": "queued",
                })
                queue_lifecycle.assert_called_once_with(
                    Path.cwd(),
                    operation="waste-basket-x",
                    asset_ids=["photo-one"],
                    session_id="pbe-owner-session-one",
                    fixture_id="fixture-la-concha",
                    request_key="browser-action-one",
                )
                queued_arguments = queue_lifecycle.call_args.kwargs
                self.assertNotIn("raw-secret-session-token", repr(queued_arguments))
                self.assertFalse(any(key in queued_arguments for key in (
                    "members", "owner_mode", "owner_authorized", "requestKey",
                )))

                queued_status = Request(
                    f"{base}/action/status?requestId=hlr-opaque-one",
                    headers={"Cookie": cookie.split(";", 1)[0]},
                )
                with urlopen(queued_status) as response:
                    pending = json.loads(response.read())
                self.assertEqual(pending["state"], "queued")
                legacy_apply.assert_not_called()

                latest_status.return_value = {
                    "requestId": "hlr-opaque-one", "state": "running", "error": "",
                }
                recovered_status = Request(
                    f"{base}/action/status",
                    headers={"Cookie": cookie.split(";", 1)[0]},
                )
                with urlopen(recovered_status) as response:
                    recovered = json.loads(response.read())
                self.assertEqual(recovered["requestId"], "hlr-opaque-one")
                self.assertEqual(recovered["state"], "running")
                latest_status.assert_called_with(
                    Path.cwd(),
                    session_id="pbe-owner-session-one",
                    fixture_id="fixture-la-concha",
                )

                hosted_status.return_value = {
                    "requestId": "hlr-opaque-one",
                    "state": "failed",
                    "error": "trusted connector failed safely",
                }
                with urlopen(queued_status) as response:
                    failed = json.loads(response.read())
                self.assertEqual(response.status, 200)
                self.assertTrue(failed["ok"])
                self.assertEqual(failed["state"], "failed")
                self.assertEqual(failed["error"], "trusted connector failed safely")

                projection_retry_payload = {
                    "requestId": "hlr-opaque-one",
                    "projectionToken": "f" * 64,
                    "operationRevision": 23,
                }
                projection_retry = Request(
                    f"{base}/action/projection-retry",
                    data=json.dumps(projection_retry_payload).encode(),
                    method="POST",
                    headers={
                        "Cookie": cookie.split(";", 1)[0],
                        "Content-Type": "application/json",
                        "Origin": f"http://127.0.0.1:{server.server_port}",
                    },
                )
                with urlopen(projection_retry) as response:
                    self.assertEqual(response.status, 200)
                    retried = json.loads(response.read())
                self.assertTrue(retried["ok"])
                self.assertEqual(retried["projection"]["state"], "applied")
                retry_projection.assert_called_once()
                retry_root, retry_session, retry_payload = retry_projection.call_args.args
                self.assertEqual(retry_root, Path.cwd())
                self.assertEqual(retry_session["id"], "pbe-owner-session-one")
                self.assertEqual(retry_session["fixtureId"], "fixture-la-concha")
                self.assertEqual(retry_payload, projection_retry_payload)
                self.assertNotIn("action", retry_payload)
                self.assertNotIn("assetIds", retry_payload)
                legacy_apply.assert_not_called()

                legacy = Request(
                    f"http://127.0.0.1:{server.server_port}/__photosbyelie/photo-action",
                    data=json.dumps({
                        "action": "waste-basket-x",
                        "photo_id": "photo-one",
                        "source": "owner-web",
                        "actor": "owner",
                        "fixture_id": "fixture-la-concha",
                        "owner_mode": True,
                        "owner_authorized": True,
                    }).encode(),
                    method="POST",
                    headers={"Content-Type": "application/json"},
                )
                with self.assertRaises(HTTPError) as blocked:
                    urlopen(legacy)
                self.assertEqual(blocked.exception.code, 403)
                blocked.exception.close()
                legacy_apply.assert_not_called()

                with self.assertRaises(HTTPError) as replay:
                    urlopen(bootstrap)
                self.assertEqual(replay.exception.code, 401)
                replay.exception.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.assertFalse(thread.is_alive())

    def test_missing_capability_and_identity_drift_fail_closed(self) -> None:
        no_writer = {
            **self.session,
            "capabilities": ["gallery.read", "waste-basket.x"],
        }
        with self.assertRaises(PBEOwnerSessionError) as caught:
            self.store.start("token", no_writer, self.readiness)
        self.assertEqual(caught.exception.code, "pbe_owner_capability_missing")

        wrong_writer = {**self.session, "lifecycleWriter": "direct-tombstone"}
        with self.assertRaises(PBEOwnerSessionError) as caught:
            self.store.start("token", wrong_writer, self.readiness)
        self.assertEqual(caught.exception.code, "pbe_owner_writer_mismatch")

        closed = {**self.session, "state": "closed"}
        with self.assertRaises(PBEOwnerSessionError) as caught:
            self.store.start("token", closed, self.readiness)
        self.assertEqual(caught.exception.code, "pbe_owner_session_inactive")

        drifted = {**self.readiness, "catalogIdentity": "catalog-sqlite:sha256:changed"}
        with self.assertRaises(PBEOwnerSessionError) as caught:
            self.store.start("token", self.session, drifted)
        self.assertEqual(caught.exception.code, "pbe_owner_identity_mismatch")

        fixture_drift = {
            **self.readiness,
            "fixtureRevision": "fixture-revision:sha256:changed",
        }
        with self.assertRaises(PBEOwnerSessionError) as caught:
            self.store.start("token", self.session, fixture_drift)
        self.assertEqual(caught.exception.code, "pbe_owner_identity_mismatch")

    def test_local_lease_expiry_and_close_disable_actions(self) -> None:
        self.store.start("token", self.session, self.readiness)
        self.now += 61
        with self.assertRaises(PBEOwnerSessionError) as caught:
            self.store.authorize("token", self.session, self.readiness)
        self.assertEqual(caught.exception.code, "pbe_owner_session_expired")

        self.now = 2_000_000_000.0
        self.store.start("token", self.session, self.readiness)
        self.assertEqual(self.store.close("token")["state"], "closed")
        with self.assertRaises(PBEOwnerSessionError) as caught:
            self.store.authorize("token", self.session, self.readiness)
        self.assertEqual(caught.exception.code, "pbe_owner_session_inactive")

    def test_repository_readiness_uses_opaque_hashes_and_requires_both_databases(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "assets/owner-actions").mkdir(parents=True)
            (root / "assets/catalog").mkdir(parents=True)
            owner_path = root / "assets/owner-actions/Owner.sqlite"
            catalog_path = root / "assets/catalog/photosbyelie.sqlite"
            def write_owner(path: Path) -> None:
                with sqlite3.connect(path) as connection:
                    connection.executescript(
                        """
                    CREATE TABLE owner_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
                    CREATE TABLE media_lifecycle (media_id TEXT PRIMARY KEY, lifecycle_state TEXT);
                    CREATE TABLE fixtures (
                      fixture_id TEXT PRIMARY KEY, parent_fixture_id TEXT, name TEXT,
                      slug TEXT, template_key TEXT, tags_json TEXT,
                      destination_defaults_json TEXT, access_gallery_key TEXT,
                      archived_at TEXT
                    );
                    CREATE TABLE sidecar_assets (
                      asset_id TEXT PRIMARY KEY, source_anchor TEXT, media_type TEXT,
                      filename TEXT, captured_at TEXT, modified_at TEXT,
                      pixel_width INTEGER, pixel_height INTEGER, duration REAL,
                      photos_title TEXT, photos_keywords_json TEXT,
                      location_label TEXT, location_keywords_json TEXT,
                      metadata_seed_title TEXT, metadata_seed_keywords_json TEXT,
                      missing_at TEXT
                    );
                    CREATE TABLE fixture_asset_decisions (
                      fixture_id TEXT, asset_id TEXT, placement_state TEXT,
                      eligibility_state TEXT, source TEXT
                    );
                    CREATE TABLE asset_source_versions (
                      asset_id TEXT, version_id TEXT, metadata_fingerprint TEXT,
                      rendered_fingerprint TEXT, source_exists INTEGER, state TEXT
                    );
                    INSERT INTO fixtures VALUES (
                      'fixture-la-concha', NULL, 'La Concha', 'la-concha', '', '[]',
                      '["r2"]', '', NULL
                    );
                    INSERT INTO sidecar_assets VALUES (
                      'asset-one', 'apple-photos://asset-one', 'photo', 'one.jpg',
                      '2026-08-13T12:00:00Z', '', 6000, 4000, 0, 'One', '["Spain"]',
                      'Malaga', '["Spain"]', 'One', '["Spain"]', NULL
                    );
                    INSERT INTO fixture_asset_decisions VALUES (
                      'fixture-la-concha', 'asset-one', 'picked', 'active', 'native'
                    );
                    INSERT INTO asset_source_versions VALUES (
                      'asset-one', 'version-one', 'meta-one', 'render-one', 1, 'live'
                    );
                    """
                    )
            write_owner(owner_path)
            with sqlite3.connect(catalog_path) as connection:
                connection.executescript(
                    """
                    CREATE TABLE collections (collection_id INTEGER PRIMARY KEY, slug TEXT);
                    CREATE TABLE media_items (media_id TEXT PRIMARY KEY, collection_id INTEGER);
                    """
                )
            readiness = repository_readiness(root, "fixture-la-concha")
            self.assertTrue(readiness["ready"])
            self.assertRegex(readiness["sourceIdentity"], r"^owner-sqlite:sha256:[0-9a-f]{64}$")
            self.assertNotIn(str(root), json.dumps(readiness))

            with sqlite3.connect(owner_path) as connection:
                connection.execute(
                    "INSERT INTO owner_settings VALUES ('last_action', 'recoverable X')"
                )
            after_write = repository_readiness(root, "fixture-la-concha")
            self.assertEqual(after_write["sourceIdentity"], readiness["sourceIdentity"])
            self.assertEqual(after_write["readinessIdentity"], readiness["readinessIdentity"])

            with sqlite3.connect(owner_path) as connection:
                connection.execute(
                    "INSERT INTO media_lifecycle VALUES ('asset-one', 'hidden')"
                )
            lifecycle_changed = repository_readiness(root, "fixture-la-concha")
            self.assertEqual(
                lifecycle_changed["fixtureRevision"],
                readiness["fixtureRevision"],
            )

            with sqlite3.connect(owner_path) as connection:
                connection.execute(
                    """
                    INSERT INTO sidecar_assets VALUES (
                      'asset-two', 'apple-photos://asset-two', 'photo', 'two.jpg',
                      '2026-08-13T12:01:00Z', '', 4000, 3000, 0, 'Two', '[]',
                      '', '[]', 'Two', '[]', NULL
                    )
                    """
                )
                connection.execute(
                    "INSERT INTO fixture_asset_decisions VALUES (?, ?, ?, ?, ?)",
                    ("fixture-la-concha", "asset-two", "picked", "active", "native"),
                )
            membership_changed = repository_readiness(root, "fixture-la-concha")
            self.assertNotEqual(
                membership_changed["fixtureRevision"],
                readiness["fixtureRevision"],
            )
            self.assertNotEqual(
                membership_changed["readinessIdentity"],
                readiness["readinessIdentity"],
            )

            replacement = owner_path.with_suffix(".replacement")
            write_owner(replacement)
            replacement.replace(owner_path)
            after_replacement = repository_readiness(root, "fixture-la-concha")
            self.assertNotEqual(after_replacement["sourceIdentity"], readiness["sourceIdentity"])
            self.assertNotEqual(after_replacement["readinessIdentity"], readiness["readinessIdentity"])

            catalog_rebuild = catalog_path.with_suffix(".replacement")
            with sqlite3.connect(catalog_rebuild) as connection:
                connection.executescript(
                    """
                    CREATE TABLE collections (collection_id INTEGER PRIMARY KEY, slug TEXT);
                    CREATE TABLE media_items (media_id TEXT PRIMARY KEY, collection_id INTEGER);
                    """
                )
            catalog_rebuild.replace(catalog_path)
            after_catalog_rebuild = repository_readiness(root, "fixture-la-concha")
            self.assertEqual(
                after_catalog_rebuild["catalogIdentity"],
                after_replacement["catalogIdentity"],
            )

            owner_path.unlink()
            with self.assertRaises(PBEOwnerSessionError) as caught:
                repository_readiness(root, "fixture-la-concha")
            self.assertEqual(caught.exception.code, "pbe_owner_host_not_ready")

    def test_query_only_connection_reads_open_wal_without_writes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "Owner.sqlite"
            writer = sqlite3.connect(database)
            writer.execute(
                "CREATE TABLE owner_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT)"
            )
            writer.execute("PRAGMA journal_mode = WAL")
            writer.execute(
                "INSERT INTO owner_settings VALUES ('fixture', 'expo')"
            )
            writer.commit()
            try:
                reader = _connect_query_only(database)
                try:
                    self.assertEqual(reader.execute("PRAGMA query_only").fetchone()[0], 1)
                    self.assertEqual(
                        reader.execute(
                            "SELECT setting_value FROM owner_settings WHERE setting_key = 'fixture'"
                        ).fetchone()[0],
                        "expo",
                    )
                    with self.assertRaises(sqlite3.OperationalError):
                        reader.execute(
                            "INSERT INTO owner_settings VALUES ('blocked', 'write')"
                        )
                finally:
                    reader.close()
            finally:
                writer.close()

    def test_hosted_x_and_restore_derive_guarded_writer_context(self) -> None:
        lease = {"id": "session-one", "fixtureId": "fixture-la-concha"}
        trusted = pbe_owner_action_payload({
            "action": "waste-basket-x",
            "photoId": "photo-one",
            "fixtureId": "fixture-la-concha",
            "source": "untrusted-source",
            "owner_mode": False,
            "owner_authorized": False,
        }, lease, "request-key-one")
        self.assertEqual(trusted["source"], "owner-gallery")
        self.assertTrue(trusted["owner_mode"])
        self.assertTrue(trusted["owner_authorized"])
        self.assertEqual(trusted["fixture_id"], "fixture-la-concha")
        self.assertEqual(trusted["request_key"], "request-key-one")

        overridden = pbe_owner_action_payload({
            "action": "waste-basket-x",
            "photoId": "photo-one",
            "request_key": "attacker-key",
            "requestKey": "attacker-camel-key",
        }, lease, "trusted-header-key")
        self.assertEqual(overridden["request_key"], "trusted-header-key")

        restored = pbe_owner_action_payload({
            "action": "waste-basket-restore",
            "photo_id": "photo-one",
        }, lease)
        self.assertEqual(restored["action"], "waste-basket-restore")

        with self.assertRaises(PBEOwnerSessionError) as tombstone:
            pbe_owner_action_payload({"action": "waste-basket-empty"}, lease)
        self.assertEqual(tombstone.exception.code, "pbe_owner_action_forbidden")

        with self.assertRaises(PBEOwnerSessionError) as mismatch:
            pbe_owner_action_payload({
                "action": "waste-basket-x",
                "fixtureId": "fixture-expo",
            }, lease)
        self.assertEqual(mismatch.exception.code, "pbe_owner_session_mismatch")

    def test_projection_retry_uses_durable_identity_and_never_replays_authority(self) -> None:
        request_id = "hlr-projection-one"
        operation_id = f"owner-action:hosted-lifecycle:{request_id}"
        stored = {
            "requestId": request_id,
            "sessionId": "session-one",
            "fixtureId": "fixture-one",
            "operation": "waste-basket-restore",
            "assetIds": ["asset-one"],
            "state": "completed",
            "result": {
                "ok": True,
                "operationId": operation_id,
                "authoritative_committed": True,
                "projection": {
                    "state": "pending",
                    "retryable": True,
                    "error_code": "catalog_projection_failed",
                },
            },
            "error": "",
        }
        lifecycle = {
            "operationId": operation_id,
            "operationDigest": "d" * 64,
            "operation": "restore",
            "revision": 17,
            "state": "locally_acked",
            "receipts": [{"canonicalAssetId": "asset-one"}],
        }

        def replace_result(_root, _request_id, **kwargs):
            self.assertEqual(kwargs["expected_result"], stored["result"])
            stored["result"] = kwargs["result"]
            return dict(stored)

        with (
            patch.object(local_server, "hosted_lifecycle_request_status", side_effect=lambda *args, **kwargs: dict(stored)),
            patch.object(local_server, "deployed_lifecycle_outbox", return_value=lifecycle),
            patch.object(local_server, "replace_completed_hosted_lifecycle_result", side_effect=replace_result) as persist,
            patch.object(local_server, "project_lifecycle_catalog_state", return_value={
                "projected_ids": ["asset-one"],
                "projection": {"state": "applied", "retryable": False},
                "worker_catalog": {"ok": True},
                "site": {},
                "catalog_publish_pending": True,
                "catalogPublication": {"state": "pending", "receipt": None},
            }) as project,
            patch.object(local_server, "restore_from_waste_basket_gateway") as restore_gateway,
            patch.object(local_server, "move_to_waste_basket_gateway") as move_gateway,
            patch.object(local_server, "empty_waste_basket_gateway") as empty_gateway,
        ):
            initial = local_server._normalized_hosted_lifecycle_result(Path("."), stored)
            retry_payload = {
                "requestId": request_id,
                "projectionToken": initial["projectionRetry"]["token"],
                "operationRevision": 17,
            }
            first = local_server.retry_hosted_lifecycle_projection(
                Path("."),
                {"id": "session-one", "fixtureId": "fixture-one"},
                retry_payload,
            )
            duplicate = local_server.retry_hosted_lifecycle_projection(
                Path("."),
                {"id": "session-one", "fixtureId": "fixture-one"},
                retry_payload,
            )

        self.assertEqual(first["authoritative"]["state"], "committed")
        self.assertEqual(first["projection"]["state"], "applied")
        self.assertEqual(first["catalogPublication"]["state"], "pending")
        self.assertEqual(duplicate["projection"]["state"], "applied")
        project.assert_called_once_with(Path("."), "restore", ["asset-one"])
        persist.assert_called_once()
        restore_gateway.assert_not_called()
        move_gateway.assert_not_called()
        empty_gateway.assert_not_called()

    def test_projection_retry_rejects_stale_and_nonretryable_state(self) -> None:
        request_id = "hlr-projection-two"
        operation_id = f"owner-action:hosted-lifecycle:{request_id}"
        lifecycle = {
            "operationId": operation_id,
            "operationDigest": "e" * 64,
            "operation": "x",
            "revision": 22,
            "state": "locally_acked",
            "receipts": [{"canonicalAssetId": "asset-two"}],
        }
        status = {
            "requestId": request_id,
            "sessionId": "session-two",
            "fixtureId": "fixture-two",
            "operation": "waste-basket-x",
            "assetIds": ["asset-two"],
            "state": "completed",
            "result": {
                "operationId": operation_id,
                "authoritative_committed": True,
                "projection": {"state": "partial", "retryable": True},
            },
        }
        session = {"id": "session-two", "fixtureId": "fixture-two"}
        with patch.object(local_server, "hosted_lifecycle_request_status") as status_lookup:
            with self.assertRaises(PBEOwnerSessionError) as fractional:
                local_server.retry_hosted_lifecycle_projection(Path("."), session, {
                    "requestId": request_id,
                    "projectionToken": "0" * 64,
                    "operationRevision": 22.9,
                })
            self.assertEqual(fractional.exception.code, "pbe_owner_projection_revision_invalid")
            status_lookup.assert_not_called()

        with (
            patch.object(local_server, "hosted_lifecycle_request_status", return_value=status),
            patch.object(local_server, "deployed_lifecycle_outbox", return_value=lifecycle),
        ):
            with self.assertRaises(PBEOwnerSessionError) as stale:
                local_server.retry_hosted_lifecycle_projection(Path("."), session, {
                    "requestId": request_id,
                    "projectionToken": "0" * 64,
                    "operationRevision": 22,
                })
            self.assertEqual(stale.exception.code, "pbe_owner_projection_stale")

            status["result"]["projection"] = {
                "state": "skipped-no-static-catalog",
                "retryable": False,
            }
            with self.assertRaises(PBEOwnerSessionError) as skipped:
                local_server.retry_hosted_lifecycle_projection(Path("."), session, {
                    "requestId": request_id,
                    "projectionToken": "1" * 64,
                    "operationRevision": 22,
                })
            self.assertEqual(skipped.exception.code, "pbe_owner_projection_not_retryable")

        with patch.object(
            local_server,
            "hosted_lifecycle_request_status",
            side_effect=local_server.WasteBasketError("wrong session"),
        ):
            with self.assertRaises(PBEOwnerSessionError) as unavailable:
                local_server.retry_hosted_lifecycle_projection(Path("."), session, {
                    "requestId": request_id,
                    "projectionToken": "2" * 64,
                    "operationRevision": 22,
                })
            self.assertEqual(unavailable.exception.code, "pbe_owner_projection_retry_unavailable")

    def test_hosted_status_does_not_trust_unproven_authority_claim(self) -> None:
        request_id = "hlr-unproven-authority"
        status = {
            "requestId": request_id,
            "sessionId": "session-one",
            "fixtureId": "fixture-one",
            "operation": "waste-basket-x",
            "assetIds": ["asset-one"],
            "state": "completed",
            "result": {
                "operationId": f"owner-action:hosted-lifecycle:{request_id}",
                "authoritative_committed": True,
                "projection": {"state": "pending", "retryable": True},
            },
        }
        with patch.object(
            local_server,
            "deployed_lifecycle_outbox",
            side_effect=local_server.WasteBasketError("missing authoritative outbox"),
        ):
            normalized = local_server._normalized_hosted_lifecycle_result(Path("."), status)
        self.assertFalse(normalized["authoritative_committed"])
        self.assertEqual(normalized["authoritative"]["state"], "unconfirmed")
        self.assertFalse(normalized["projectionRetry"]["available"])
        self.assertNotIn("token", normalized["projectionRetry"])

    def test_hosted_restore_rejects_recoverable_entry_from_another_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            move_to_waste_basket_gateway(
                root,
                ["photo-from-other-fixture"],
                source="owner-gallery",
                actor="backstage-pbe:other-session",
                fixture_id="fixture-other",
                gallery_id="fixture-other",
                request_key="x-other-fixture",
                owner_mode=True,
                owner_authorized=True,
            )
            lease = {"id": "session-current", "fixtureId": "fixture-current"}
            payload = pbe_owner_action_payload({
                "action": "waste-basket-restore",
                "photo_id": "photo-from-other-fixture",
            }, lease, "restore-other-fixture")

            with self.assertRaises(PBEOwnerSessionError) as caught:
                assert_pbe_owner_restore_scope(root, lease, payload)
            self.assertEqual(caught.exception.code, "pbe_owner_fixture_mismatch")

    def test_hosted_restore_allows_recoverable_entry_from_frozen_fixture(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            move_to_waste_basket_gateway(
                root,
                ["photo-from-current-fixture"],
                source="owner-gallery",
                actor="backstage-pbe:session-current",
                fixture_id="fixture-current",
                gallery_id="fixture-current",
                request_key="x-current-fixture",
                owner_mode=True,
                owner_authorized=True,
            )
            lease = {"id": "session-current", "fixtureId": "fixture-current"}
            payload = pbe_owner_action_payload({
                "action": "waste-basket-restore",
                "photo_id": "photo-from-current-fixture",
            }, lease, "restore-current-fixture")

            assert_pbe_owner_restore_scope(root, lease, payload)

    @patch("scripts.local_server.fixture_culling_window")
    def test_hosted_gallery_and_x_targets_derive_from_the_frozen_fixture(self, culling_window) -> None:
        culling_window.return_value = {
            "ok": True,
            "fixtureId": "fixture-la-concha",
            "items": [{"assetId": "photo-one"}],
            "summary": {"filtered": 1},
            "hasNext": False,
        }
        lease = {"id": "session-one", "fixtureId": "fixture-la-concha", "fixtureBreadcrumb": "RE › La Concha"}
        gallery = pbe_owner_fixture_gallery(Path("/synthetic"), lease)
        self.assertEqual(gallery["fixtureId"], "fixture-la-concha")
        self.assertEqual(gallery["fixtureBreadcrumb"], "RE › La Concha")
        culling_window.assert_called_with(
            Path("/synthetic"),
            "fixture-la-concha",
            view="picked",
            offset=0,
            limit=500,
        )

        assert_pbe_owner_x_scope(Path("/synthetic"), lease, {
            "action": "waste-basket-x",
            "photo_id": "photo-one",
            "photo_ids": [],
        })
        with self.assertRaises(PBEOwnerSessionError) as mismatch:
            assert_pbe_owner_x_scope(Path("/synthetic"), lease, {
                "action": "waste-basket-x",
                "photo_id": "photo-from-another-fixture",
                "photo_ids": [],
            })
        self.assertEqual(mismatch.exception.code, "pbe_owner_fixture_mismatch")


if __name__ == "__main__":
    unittest.main()
