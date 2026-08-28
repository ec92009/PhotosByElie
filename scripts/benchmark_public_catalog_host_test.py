#!/usr/bin/env python3

from __future__ import annotations

import unittest

from scripts.benchmark_public_catalog_host import (
    _parse_headers,
    _parse_metrics,
    benchmark,
)


class PublicCatalogHostBenchmarkTest(unittest.TestCase):
    def test_parses_transport_metrics_without_remote_identity(self) -> None:
        parsed = _parse_metrics("200\t2\t1445888\t0.010\t0.030\t0.050\t0.120\t0.220\t6572220")
        self.assertEqual(parsed["status"], 200)
        self.assertEqual(parsed["bytes"], 1445888)
        self.assertEqual(parsed["dnsMs"], 10)
        self.assertEqual(parsed["connectMs"], 20)
        self.assertEqual(parsed["tlsMs"], 20)
        self.assertEqual(parsed["ttfbMs"], 120)
        self.assertEqual(parsed["downloadMs"], 100)
        self.assertNotIn("remoteIp", parsed)

    def test_keeps_only_public_cache_headers_from_final_response(self) -> None:
        headers = _parse_headers(
            "HTTP/1.1 301 Moved\r\nLocation: https://example.test/final\r\n\r\n"
            "HTTP/2 200\r\nCache-Control: public, max-age=0\r\nETag: abc\r\n"
            "Set-Cookie: secret=value\r\nX-Private: hidden\r\n\r\n"
        )
        self.assertEqual(headers, {"cache-control": "public, max-age=0", "etag": "abc"})

    def test_benchmark_separates_unique_cold_and_repeated_warm_urls(self) -> None:
        seen: list[str] = []

        def probe(url: str) -> dict[str, object]:
            seen.append(url)
            return {
                "status": 200,
                "httpVersion": "2",
                "bytes": 100,
                "dnsMs": 1.0,
                "connectMs": 2.0,
                "tlsMs": 3.0,
                "ttfbMs": 4.0,
                "downloadMs": 5.0,
                "totalMs": 9.0,
                "bytesPerSecond": 10,
                "headers": {"etag": "abc"},
            }

        report = benchmark(
            ["https://example.test/catalog.sqlite"],
            cold_requests=2,
            warm_requests=2,
            probe=probe,
        )
        self.assertEqual(len(seen), 5)
        self.assertNotEqual(seen[0], seen[1])
        self.assertEqual(seen[2], seen[3])
        self.assertEqual(seen[3], seen[4])
        self.assertNotIn("pbe174", report["targets"][0]["url"])
        self.assertEqual(report["targets"][0]["warm"]["timingMs"]["totalMs"]["median"], 9.0)


if __name__ == "__main__":
    unittest.main()
