"""Regression tests for browser-to-local mutation and private-static boundaries."""
from functools import partial
import http.client
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

from scripts.local_server import PhotosByElieLocalHandler
from scripts.sidecar_server import SidecarHandler


class LocalHttpSecurityTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name, data in {
            "index.html": "public home", "gallery.html": "public gallery",
            "embedded-browser.js": "public script", "assets/pano-nerja.jpg": "public photo",
            "assets/catalog/photosbyelie.sqlite": "public catalog",
            "assets/owner-actions/Owner.sqlite": "private owner fixture",
            "secret.json": "private configuration fixture",
        }.items():
            file = self.root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(data)
        (self.root / "photo.html").symlink_to(self.root / "assets/owner-actions/Owner.sqlite")
        self.servers = []
        for handler in (PhotosByElieLocalHandler, SidecarHandler):
            class Quiet(handler):
                def log_message(self, *_args):
                    pass
            server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=str(self.root)))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            self.servers.append((server, thread))

    def tearDown(self):
        for server, thread in self.servers:
            server.shutdown()
            server.server_close()
            thread.join()
        self.temp.cleanup()

    def request(self, server, method, route, headers=None, body=None):
        conn = http.client.HTTPConnection("127.0.0.1", server.server_port)
        try:
            conn.request(method, route, body=body, headers=headers or {})
            response = conn.getresponse()
            return response.status, response.read()
        finally:
            conn.close()

    def test_private_static_and_rebinding_are_denied_for_get_head_post(self):
        for server, _ in self.servers:
            for method in ("GET", "HEAD", "POST"):
                for host in (f"evil.example:{server.server_port}", f"127.evil.example:{server.server_port}", "localhost:1"):
                    with self.subTest(method=method, host=host):
                        self.assertEqual(self.request(server, method, "/gallery.html", {"Host": host})[0], 403)
            for method in ("GET", "HEAD"):
                for route in ("/assets/owner-actions/Owner.sqlite", "/assets/%6fwner-actions/Owner.sqlite",
                              "/secret.json", "/photo.html", "/assets/", "/.git/config"):
                    self.assertEqual(self.request(server, method, route)[0], 403, route)
                for route in ("/", "/gallery.html", "/assets/catalog/photosbyelie.sqlite",
                              "/embedded-browser.js", "/assets/pano-nerja.jpg"):
                    self.assertEqual(self.request(server, method, route)[0], 200, route)

    def test_duplicate_or_missing_host_is_denied(self):
        for server, _ in self.servers:
            for hosts in ([], ["localhost", "evil.example"]):
                conn = http.client.HTTPConnection("127.0.0.1", server.server_port)
                try:
                    conn.putrequest("GET", "/gallery.html", skip_host=True)
                    for host in hosts:
                        conn.putheader("Host", host)
                    conn.endheaders()
                    response = conn.getresponse()
                    self.assertEqual(response.status, 403)
                    response.read()
                finally:
                    conn.close()

    def test_legacy_mutations_never_dispatch_for_any_origin_or_media_type(self):
        local, sidecar = (entry[0] for entry in self.servers)
        with patch.object(PhotosByElieLocalHandler, "_read_json_body", side_effect=AssertionError("must not parse")), \
             patch.object(SidecarHandler, "_read_json_body", side_effect=AssertionError("must not parse")):
            for server, routes in ((local, ("/__photosbyelie/publish-prices", "/__photosbyelie/real-estate-owner", "/__photosbyelie/photo-action")),
                                   (sidecar, ("/__sidecar/decision", "/__sidecar/decisions", "/__sidecar/index-refresh"))):
                for route in routes:
                    for origin in (None, "https://evil.example", f"http://127.0.0.1:{server.server_port}"):
                        for media in ("text/plain", "application/x-www-form-urlencoded", "application/json"):
                            headers = {"Content-Type": media}
                            if origin:
                                headers["Origin"] = origin
                            self.assertEqual(self.request(server, "POST", route, headers, b'{}')[0], 403)

    def test_legacy_library_get_cannot_trigger_indexing(self):
        server = self.servers[1][0]
        with patch.object(SidecarHandler, "_handle_library", side_effect=AssertionError("must not dispatch")):
            for origin in (None, "https://evil.example", f"http://127.0.0.1:{server.server_port}"):
                headers = {"Sec-Fetch-Site": "cross-site"}
                if origin:
                    headers["Origin"] = origin
                self.assertEqual(self.request(server, "GET", "/__sidecar/library", headers)[0], 403)

    def test_retained_protocol_still_requires_capability_and_json(self):
        server = self.servers[0][0]
        for route in ("host/bootstrap", "session/start"):
            status, _ = self.request(server, "POST", "/__photosbyelie/pbe-owner/" + route,
                                     {"Content-Type": "application/json"}, b'{}')
            self.assertEqual(status, 401)
        status, _ = self.request(server, "POST", "/__photosbyelie/pbe-owner/host/bootstrap",
                                 {"Content-Type": "text/plain", "Origin": "https://evil.example"}, b'{}')
        self.assertEqual(status, 415)


if __name__ == "__main__":
    unittest.main()
