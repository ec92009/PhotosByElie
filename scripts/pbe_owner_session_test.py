import json
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse
from urllib.request import Request, urlopen

from scripts.pbe_owner_session import (
    PBEOwnerSessionError,
    PBEOwnerSessionStore,
    repository_readiness,
)
from unittest.mock import patch

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
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_port}/__photosbyelie/pbe-owner"
        try:
            with (
                patch("scripts.local_server.PBE_OWNER_SESSION_STORE", store),
                patch("scripts.local_server.PBE_OWNER_SESSION_VERIFIER", Verifier()),
                patch("scripts.local_server.repository_readiness", return_value=self.readiness),
            ):
                start = Request(
                    f"{base}/session/start",
                    data=json.dumps({"fixtureId": "fixture-la-concha"}).encode(),
                    method="POST",
                    headers={
                        "Authorization": "Bearer raw-secret-session-token",
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
            with sqlite3.connect(owner_path) as connection:
                connection.executescript(
                    """
                    CREATE TABLE owner_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
                    CREATE TABLE media_lifecycle (media_id TEXT PRIMARY KEY, lifecycle_state TEXT);
                    """
                )
            with sqlite3.connect(catalog_path) as connection:
                connection.executescript(
                    """
                    CREATE TABLE collections (collection_id INTEGER PRIMARY KEY, slug TEXT);
                    CREATE TABLE media_items (media_id TEXT PRIMARY KEY, collection_id INTEGER);
                    """
                )
            readiness = repository_readiness(root)
            self.assertTrue(readiness["ready"])
            self.assertRegex(readiness["sourceIdentity"], r"^owner-sqlite:sha256:[0-9a-f]{64}$")
            self.assertNotIn(str(root), json.dumps(readiness))

            with sqlite3.connect(owner_path) as connection:
                connection.execute(
                    "INSERT INTO owner_settings VALUES ('last_action', 'recoverable X')"
                )
            after_write = repository_readiness(root)
            self.assertEqual(after_write["sourceIdentity"], readiness["sourceIdentity"])
            self.assertEqual(after_write["readinessIdentity"], readiness["readinessIdentity"])

            replacement = owner_path.with_suffix(".replacement")
            with sqlite3.connect(replacement) as connection:
                connection.executescript(
                    """
                    CREATE TABLE owner_settings (setting_key TEXT PRIMARY KEY, setting_value TEXT);
                    CREATE TABLE media_lifecycle (media_id TEXT PRIMARY KEY, lifecycle_state TEXT);
                    """
                )
            replacement.replace(owner_path)
            after_replacement = repository_readiness(root)
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
            after_catalog_rebuild = repository_readiness(root)
            self.assertEqual(
                after_catalog_rebuild["catalogIdentity"],
                after_replacement["catalogIdentity"],
            )

            owner_path.unlink()
            with self.assertRaises(PBEOwnerSessionError) as caught:
                repository_readiness(root)
            self.assertEqual(caught.exception.code, "pbe_owner_host_not_ready")

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
