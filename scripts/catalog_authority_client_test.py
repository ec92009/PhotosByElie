"""Offline authority protocol and credential/transport boundary tests."""

import copy
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import catalog_authority_client as authority


def timestamp():
    return datetime.now(timezone.utc).isoformat()


class FakeAuthority:
    """Synthetic CAS server; a lost response never undoes a successful prepare."""

    def __init__(self):
        self.row = None
        self.calls = []
        self.public_sha = None
        self.lost_phase = None
        self.before_post = None

    def __call__(self, method, headers, payload):
        body = json.loads(payload) if payload is not None else None
        self.calls.append((method, body))
        if method == "GET":
            if self.row is None:
                return 404, b'{"error":{"code":"public_catalog_authority_absent"}}'
            return 200, json.dumps({**self.row, "checkedAt": timestamp()}).encode()
        assert set(body) == {"schema", "phase", "operationId", "expectedGeneration", "projectionRevision", "sha256"}
        assert body["schema"] == "photosbyelie.publicCatalogTransition.v1"
        assert body["operationId"] == authority.operation_id(body["projectionRevision"], body["sha256"])
        if self.before_post:
            self.before_post(body)
        generation = self.row["generation"] if self.row else 0
        if body["expectedGeneration"] != generation:
            return 409, b"{}"
        if body["phase"] == "prepare":
            if self.row and (self.row["state"] == "pending" or body["projectionRevision"] <= self.row["projectionRevision"]):
                return 409, b"{}"
            self.row = {
                "schema": "photosbyelie.publicCatalogAuthority.v1", "ok": True,
                "generation": generation + 1, "state": "pending", "operationId": body["operationId"],
                "projectionRevision": body["projectionRevision"], "sha256": body["sha256"],
                "publisherId": "max", "checkedAt": timestamp(), "updatedAt": timestamp(),
            }
        else:
            if (self.row is None or self.row["state"] not in {"pending", "verified"}
                    or any(self.row[key] != body[key] for key in ("operationId", "projectionRevision", "sha256"))
                    or self.public_sha != body["sha256"]):
                return 409, b"{}"
            self.row.update(state="verified", updatedAt=timestamp())
        self.row["checkedAt"] = timestamp()
        if self.lost_phase == body["phase"]:
            self.lost_phase = None
            raise ConnectionError("synthetic-token-must-not-appear")
        return 200, json.dumps(self.row).encode()

    def client(self):
        return authority.CatalogAuthorityClient(
            authority.ConnectorCredential("synthetic-not-a-real-token", "max", Path("/synthetic")), transport=self)


class CatalogAuthorityClientTest(unittest.TestCase):
    def setUp(self):
        self.remote = FakeAuthority()
        self.client = self.remote.client()

    def test_prepare_commit_exact_contract_and_verified_replay(self):
        prepared = self.client.prepare(1, "a" * 64)
        self.assertEqual(prepared["generation"], 1)
        self.assertEqual(self.remote.calls[1][1], {
            "schema": "photosbyelie.publicCatalogTransition.v1", "phase": "prepare",
            "operationId": authority.operation_id(1, "a" * 64), "expectedGeneration": 0,
            "projectionRevision": 1, "sha256": "a" * 64,
        })
        self.remote.public_sha = "a" * 64
        verified = self.client.commit(prepared)
        self.assertEqual(verified["state"], "verified")
        before = len([row for row in self.remote.calls if row[0] == "POST"])
        self.assertEqual(self.client.prepare(1, "a" * 64)["operationId"], prepared["operationId"])
        self.client.commit(prepared)
        self.assertEqual(len([row for row in self.remote.calls if row[0] == "POST"]), before + 1)
        self.remote.public_sha = "b" * 64
        with self.assertRaises(authority.AuthorityError):
            self.client.commit(prepared)

    def test_lost_prepare_reconciles_same_operation_without_second_post(self):
        self.remote.lost_phase = "prepare"
        with self.assertRaises(authority.AuthorityError) as caught:
            self.client.prepare(1, "a" * 64)
        self.assertNotIn("synthetic-token", str(caught.exception))
        self.assertEqual(self.client.prepare(1, "a" * 64)["state"], "pending")
        self.assertEqual([method for method, _ in self.remote.calls].count("POST"), 1)
        with self.assertRaises(authority.AuthorityError):
            self.client.prepare(1, "b" * 64)
        with self.assertRaises(authority.AuthorityError):
            self.client.prepare(2, "b" * 64)

    def test_absence_rollback_stale_generation_and_wrong_public_bytes_block(self):
        with self.assertRaises(authority.AuthorityError):
            self.client.prepare(2, "a" * 64, floor_generation=1)
        prepared = self.client.prepare(1, "a" * 64)
        with self.assertRaises(authority.AuthorityError):
            self.client.commit(prepared)
        self.remote.public_sha = "a" * 64
        self.client.commit(prepared)
        for revision, digest, floor in ((1, "b" * 64, 1), (2, "b" * 64, 2)):
            with self.assertRaises(authority.AuthorityError):
                self.client.prepare(revision, digest, floor_generation=floor)

    def test_concurrent_cas_change_blocks_prepare_and_commit(self):
        first = self.client.prepare(1, "a" * 64)
        self.remote.public_sha = "a" * 64
        self.client.commit(first)
        self.remote.before_post = lambda _body: self.remote.row.update(generation=2)
        with self.assertRaises(authority.AuthorityError):
            self.client.prepare(2, "b" * 64)
        self.remote.before_post = None
        with self.assertRaises(authority.AuthorityError):
            self.client.commit(first)

    def test_lost_commit_rechecks_server_parity_and_callback_stops_before_post(self):
        prepared = self.client.prepare(1, "a" * 64)
        with self.assertRaises(RuntimeError):
            self.client.commit(prepared, before_commit=Mock(side_effect=RuntimeError("changed")))
        self.assertEqual([method for method, _ in self.remote.calls].count("POST"), 1)
        self.remote.public_sha = "a" * 64
        self.remote.lost_phase = "commit"
        with self.assertRaises(authority.AuthorityError):
            self.client.commit(prepared)
        self.assertEqual(self.client.commit(prepared)["state"], "verified")
        self.assertEqual([method for method, _ in self.remote.calls].count("POST"), 3)

    def test_safe_integer_bounds_reject_inputs_receipts_and_generation_overflow(self):
        for value in (True, -1, 0, 1.0, authority.MAX_SAFE_INTEGER + 1):
            with self.subTest(revision=value), self.assertRaises(authority.AuthorityError):
                self.client.prepare(value, "a" * 64)
        for value in (True, -1, 1.0, authority.MAX_SAFE_INTEGER + 1):
            with self.subTest(floor=value), self.assertRaises(authority.AuthorityError):
                self.client.prepare(1, "a" * 64, floor_generation=value)
        self.assertEqual(self.remote.calls, [])
        baseline = self.client.prepare(1, "a" * 64)
        for key in ("generation", "projectionRevision"):
            self.remote.row = {**baseline, key: authority.MAX_SAFE_INTEGER + 1}
            with self.subTest(receipt=key), self.assertRaises(authority.AuthorityError):
                self.client.get()
        self.remote.row = {**baseline, "state": "verified", "generation": authority.MAX_SAFE_INTEGER}
        self.remote.calls.clear()
        with self.assertRaises(authority.AuthorityError):
            self.client.prepare(2, "b" * 64)
        self.assertEqual([method for method, _ in self.remote.calls], ["GET"])
        for key in ("generation", "projectionRevision"):
            for value in (True, authority.MAX_SAFE_INTEGER + 1):
                with self.subTest(prepared=key, value=value), self.assertRaises(authority.AuthorityError):
                    self.client.commit({**baseline, key: value})
        self.remote.row = {**baseline, "generation": authority.MAX_SAFE_INTEGER,
                           "projectionRevision": authority.MAX_SAFE_INTEGER,
                           "operationId": authority.operation_id(authority.MAX_SAFE_INTEGER, "a" * 64)}
        self.remote.public_sha = "a" * 64
        self.assertEqual(self.client.commit(dict(self.remote.row))["generation"], authority.MAX_SAFE_INTEGER)

    def test_tampered_and_stale_receipts_are_rejected(self):
        baseline = self.client.prepare(1, "a" * 64)
        cases = {"ok": 1, "generation": True, "projectionRevision": True,
                 "sha256": "A" * 64, "operationId": "b" * 64, "state": "ready",
                 "publisherId": "someone-else", "schema": "other", "updatedAt": "invalid",
                 "checkedAt": (datetime.now(timezone.utc) - timedelta(seconds=61)).isoformat()}
        for key, value in cases.items():
            with self.subTest(field=key):
                client = authority.CatalogAuthorityClient(self.client._credential,
                    transport=lambda *_args: (200, json.dumps({**baseline, key: value}).encode()))
                with self.assertRaises(authority.AuthorityError):
                    client.get()
        for status, payload in ((404, b"{}"), (302, json.dumps(baseline).encode()),
                                (200, b"x" * (authority.MAX_RESPONSE_BYTES + 1))):
            with self.subTest(status=status):
                client = authority.CatalogAuthorityClient(self.client._credential, transport=lambda *_args: (status, payload))
                with self.assertRaises(authority.AuthorityError):
                    client.get()

    def test_transport_uses_only_fixed_tls_path_header_auth_and_bounded_read(self):
        response = Mock(status=302)
        response.read.return_value = b""
        connection = Mock()
        connection.getresponse.return_value = response
        credential = self.client._credential
        with patch.object(authority.http.client, "HTTPSConnection", return_value=connection) as factory:
            with self.assertRaises(authority.AuthorityError):
                authority.CatalogAuthorityClient(credential).get()
        factory.assert_called_once_with("auth.photos-by-elie.com", timeout=15)
        call = connection.request.call_args
        self.assertEqual(call.args, ("GET", authority.AUTHORITY_PATH))
        self.assertEqual(call.kwargs["headers"]["Authorization"], f"Bearer {credential.token}")
        response.read.assert_called_once_with(authority.MAX_RESPONSE_BYTES + 1)
        connection.close.assert_called_once()


class CatalogCredentialTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.config = self.root / "connector.json"
        self.record = {"workerBase": authority.ORIGIN, "connectorId": "max",
                       "repoRoot": str(self.root), "token": "synthetic-token-only-0123456789"}
        self.write()
        pin = patch.object(authority, "CANONICAL_REPO_ROOT", self.root)
        pin.start()
        self.addCleanup(pin.stop)

    def write(self):
        self.config.write_text(json.dumps(self.record))
        self.config.chmod(0o600)

    def test_private_config_is_pinned_and_token_omitted_from_repr(self):
        row = authority.load_credentials(self.config)
        self.assertEqual(row.connector_id, "max")
        self.assertNotIn(self.record["token"], repr(row))

    def test_permissions_symlink_root_origin_and_header_injection_fail_closed(self):
        self.config.chmod(0o644)
        with self.assertRaises(authority.AuthorityError):
            authority.load_credentials(self.config)
        self.config.chmod(0o600)
        link = self.root / "linked.json"
        link.symlink_to(self.config)
        with self.assertRaises(authority.AuthorityError):
            authority.load_credentials(link)
        baseline = copy.deepcopy(self.record)
        for key, value in (("repoRoot", str(self.root / "other")), ("token", "a" * 24 + "\nX: bad"),
                           ("workerBase", authority.ORIGIN + ":443"),
                           ("workerBase", authority.ORIGIN + ".evil.example"),
                           ("workerBase", authority.ORIGIN + "?token=secret")):
            with self.subTest(field=key):
                self.record = {**baseline, key: value}
                self.write()
                with self.assertRaises(authority.AuthorityError) as caught:
                    authority.load_credentials(self.config)
                self.assertNotIn("synthetic-token", str(caught.exception))


if __name__ == "__main__":
    unittest.main()
