"""Synthetic regression tests. All exports remain inside ignored repo tmp/."""

import copy
import csv
import hashlib
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from scripts.search_console_report import ROOT, build_report, main, private_path


class SearchConsoleReportTest(unittest.TestCase):
    def setUp(self):
        (ROOT / "tmp").mkdir(exist_ok=True)
        self.workspace = tempfile.TemporaryDirectory(prefix="gsc-test-", dir=ROOT / "tmp")
        self.addCleanup(self.workspace.cleanup)
        self.directory = Path(self.workspace.name)
        self.manifest = {
            "property": "sc-domain:example.test", "start": "2026-10-20",
            "end": "2026-10-21", "timezone": "America/Los_Angeles",
            "searches": {"web": {"filters": [], "dataState": "final", "tables": {}}},
        }
        self.write_table("date", [
            ["2026-10-20", 1, 10, "10%", 2],
            ["2026-10-21", 0, 90, "0%", 12],
        ])

    def write_table(self, dimension, rows, search_type="web", **overrides):
        """Create a native CSV fixture with synthetic values."""
        filename = f"{search_type}-{dimension}.csv"
        first = {"date": "Date", "query": "Top queries", "page": "Top pages"}[dimension]
        with (self.directory / filename).open("w", newline="", encoding="utf-8-sig") as handle:
            writer = csv.writer(handle)
            writer.writerow([first, "Clicks", "Impressions", "CTR", "Position"])
            writer.writerows(rows)
        self.manifest["searches"][search_type]["tables"][dimension] = {
            "file": filename, "aggregation": "byPage" if dimension == "page" else "byProperty",
            "zeroValues": "observed", **overrides,
        }

    def report(self, **kwargs):
        return build_report(self.manifest, self.directory, **kwargs)

    def date_table(self):
        return self.report()["searches"]["web"]["tables"]["date"]

    def run_cli(self, output="report.json", *args):
        """Exercise the normal CLI entry point with private fixture files."""
        source = self.directory / "manifest.json"
        source.write_text(json.dumps(self.manifest))
        return subprocess.run([sys.executable, "scripts/search_console_report.py",
                               str(source), str(self.directory / output), *args],
                              cwd=ROOT, capture_output=True, text=True)

    def test_disjoint_dates_use_count_totals_and_impression_weights(self):
        totals = self.date_table()["windowTotals"]
        self.assertEqual(totals, {"clicks": 1, "impressions": 100, "ctr": .01, "position": 11})

    def test_web_and_image_remain_independent(self):
        self.manifest["searches"]["image"] = {"filters": [], "dataState": "final", "tables": {}}
        self.write_table("date", [["2026-10-20", 2, 4, "50%", 3]], "image")
        report = self.report()
        self.assertNotIn("totals", report)
        self.assertEqual(report["searches"]["web"]["tables"]["date"]["windowTotals"]["clicks"], 1)
        self.assertIsNone(report["searches"]["image"]["tables"]["date"]["windowTotals"])

    def test_missing_dates_are_unavailable_instead_of_zero(self):
        self.write_table("date", [["2026-10-20", 0, 0, "-", 0]])
        table = self.date_table()
        self.assertEqual(table["missingDays"], 1)
        self.assertEqual(table["observedDayTotals"]["clicks"], 0)
        self.assertIsNone(table["observedDayTotals"]["ctr"])
        self.assertIsNone(table["observedDayTotals"]["position"])
        self.assertIsNone(table["windowTotals"])

    def test_partial_and_unknown_exports_never_claim_complete_window(self):
        for state in ("partial", "unknown"):
            self.manifest["searches"]["web"]["dataState"] = state
            self.assertIsNone(self.date_table()["windowTotals"])

    def test_empty_table_remains_unavailable(self):
        self.write_table("date", [])
        self.assertEqual(self.date_table()["observedDayTotals"], dict.fromkeys(
            ("clicks", "impressions", "ctr", "position")))

    def test_nulls_propagate_per_metric(self):
        self.write_table("date", [["2026-10-20", "", 10, "-", 2],
                                  ["2026-10-21", 0, 90, 0, "N/A"]])
        table = self.date_table()
        self.assertEqual(table["missingCells"]["clicks"], 1)
        self.assertEqual(table["windowTotals"]["impressions"], 100)
        self.assertIsNone(table["windowTotals"]["clicks"])
        self.assertIsNone(table["windowTotals"]["ctr"])
        self.assertIsNone(table["windowTotals"]["position"])

    def test_ambiguous_export_zeros_become_null(self):
        self.manifest["searches"]["web"]["tables"]["date"]["zeroValues"] = "ambiguous"
        table = self.date_table()
        self.assertIsNone(table["windowTotals"]["clicks"])
        self.assertEqual(table["windowTotals"]["impressions"], 100)
        self.assertIn("date_export_zeros_may_be_unavailable", self.report()["searches"]["web"]["flags"])

    def test_query_and_page_rows_never_become_property_totals(self):
        self.write_table("query", [["synthetic phrase", 4, 200, "2%", 4]])
        self.write_table("page", [["https://example.test/a", 8, 400, "2%", 8]])
        tables = self.report()["searches"]["web"]["tables"]
        self.assertEqual(tables["date"]["windowTotals"]["impressions"], 100)
        for dimension in ("query", "page"):
            self.assertNotIn("windowTotals", tables[dimension])
            self.assertEqual(tables[dimension]["coverage"], "limited_or_unknown_including_privacy_omissions")

    def test_rank_is_bounded_and_label_free_by_default(self):
        self.write_table("query", [[f"private phrase {index}", 0, index + 1, "0%", 8]
                                  for index in range(25)])
        candidates = self.report()["searches"]["web"]["tables"]["query"]["opportunities"]
        self.assertEqual(len(candidates), 20)
        self.assertEqual(candidates[0]["impressions"], 25)
        self.assertNotIn("private phrase", json.dumps(self.report()))

    def test_csv_quoting_unicode_formulas_and_newlines_stay_json_data(self):
        label = '=HYPERLINK("https://example.test", "é, фото")\nsecond line'
        self.write_table("query", [[label, 0, 10, "0%", 9]])
        self.assertEqual(self.run_cli("labels.json", "--include-labels").returncode, 0)
        payload = json.loads((self.directory / "labels.json").read_text())
        self.assertEqual(payload["searches"]["web"]["tables"]["query"]["opportunities"][0]["label"], label)

    def test_no_indexing_or_buyer_inference(self):
        report = self.report()
        self.assertIsNone(report["indexCoverage"])
        self.assertIsNone(report["sitemapExclusions"])
        self.assertIn("search_clicks_do_not_establish_buyers", report["flags"])
        self.assertIn("daily_PT_not_UTC", report["flags"])
        self.assertIn("image_export_missing", report["flags"])

    def test_malformed_metrics_rejected(self):
        for bad in (-1, "nan", "inf", "1,000", "=1+1", 1.5, 2**54):
            with self.subTest(bad=bad):
                self.write_table("date", [["2026-10-20", bad, 100, "-", 1]])
                with self.assertRaises(ValueError):
                    self.report()
        for clicks, impressions, ctr, position in [(2, 1, "-", 1), (1, 10, "50%", 1),
                                                   (1, 10, ".1", 1), (1, 10, "10%", .5)]:
            self.write_table("date", [["2026-10-20", clicks, impressions, ctr, position]])
            with self.assertRaises(ValueError):
                self.report()

    def test_rounded_export_ctr_is_accepted_but_recomputed(self):
        self.write_table("date", [["2026-10-20", 1, 3, "33.33%", 2]])
        self.assertEqual(self.date_table()["observedDayTotals"]["ctr"], 1 / 3)

    def test_duplicate_outside_window_and_invalid_date_rows_rejected(self):
        for labels in (["2026-10-20"] * 2, ["2026-10-19"], ["2026-02-30"]):
            self.write_table("date", [[label, 0, 10, 0, 3] for label in labels])
            with self.assertRaises(ValueError):
                self.report()

    def test_csv_extra_missing_and_comparison_columns_rejected(self):
        filename = self.directory / "web-date.csv"
        for content in ("Date,Clicks,Impressions,CTR,Position\n2026-10-20,1,10,10%,1,extra\n",
                        "Date,Clicks,Impressions,CTR,Position\n2026-10-20,1\n",
                        "Date,Last 3 months Clicks,Previous Clicks\n",
                        "Fecha,Clics,Impresiones,CTR,Posición\n"):
            filename.write_text(content)
            with self.assertRaises(ValueError):
                self.report()

    def test_metadata_schema_and_aggregation_validation(self):
        original = copy.deepcopy(self.manifest)
        for key, value in (("property", "https://user:secret@example.test"),
                           ("start", "2026-10-22"), ("end", "2026-02-30"),
                           ("timezone", "UTC"), ("searches", [])):
            self.manifest = copy.deepcopy(original)
            self.manifest[key] = value
            with self.assertRaises(ValueError):
                self.report()
        self.manifest = original
        self.write_table("page", [["https://example.test", 1, 10, "10%", 1]], aggregation="byProperty")
        with self.assertRaises(ValueError):
            self.report()

    def test_filtered_daily_by_page_scope_stays_explicit(self):
        scope = self.manifest["searches"]["web"]
        scope["filters"] = ["page=https://example.test/a"]
        scope["tables"]["date"]["aggregation"] = "byPage"
        self.assertEqual(self.date_table()["aggregation"], "byPage")
        self.assertEqual(self.report()["searches"]["web"]["filterCount"], 1)

    def test_private_boundary_rejects_public_traversal_symlink_and_tracked(self):
        for candidate in (ROOT / "report.json", self.directory / "../../public.json", ROOT / "scripts/search_console_report.py"):
            with self.assertRaises(ValueError):
                private_path(candidate)
        link = self.directory / "link"
        link.symlink_to(self.directory, target_is_directory=True)
        with self.assertRaises(ValueError):
            private_path(link / "report.json")
        # A forcibly tracked fixture under ignored tmp must also be refused.
        fixture = self.directory / "tracked.json"
        fixture.write_text("{}")
        subprocess.run(["git", "add", "-f", "--", str(fixture)], cwd=ROOT, check=True)
        try:
            with self.assertRaises(ValueError):
                private_path(fixture)
        finally:
            subprocess.run(["git", "reset", "-q", "--", str(fixture)], cwd=ROOT, check=True)

    def test_cli_creates_private_json_with_no_metric_or_query_stdout(self):
        self.write_table("query", [["sensitive synthetic query", 0, 10, "0%", 4]])
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        output = self.directory / "report.json"
        self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o600)
        self.assertNotIn("sensitive", result.stdout + result.stderr + output.read_text())
        self.assertEqual(self.run_cli().returncode, 1)  # Never overwrite an earlier receipt.

    def test_cli_failure_does_not_leak_private_cells_or_paths(self):
        self.write_table("date", [["2026-10-20", "PRIVATE_SECRET", 1, "-", 1]])
        result = self.run_cli()
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("PRIVATE_SECRET", result.stdout + result.stderr)
        self.assertNotIn(str(self.directory), result.stdout + result.stderr)
        self.assertFalse((self.directory / "report.json").exists())

    def test_export_digest_matches_parsed_bytes(self):
        expected = hashlib.sha256((self.directory / "web-date.csv").read_bytes()).hexdigest()
        self.assertEqual(self.date_table()["exportSha256"], expected)

    def test_concurrent_cli_runs_keep_one_complete_receipt(self):
        source = self.directory / "manifest.json"
        source.write_text(json.dumps(self.manifest))
        target = self.directory / "report.json"
        command = [sys.executable, "scripts/search_console_report.py", str(source), str(target)]
        processes = [subprocess.Popen(command, cwd=ROOT, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE) for _ in range(2)]
        for process in processes:
            process.communicate(timeout=10)
        self.assertEqual(sorted(process.returncode for process in processes), [0, 1])
        self.assertEqual(json.loads(target.read_text())["searches"]["web"]["tables"]["date"]["windowTotals"]["clicks"], 1)

    def test_cli_rejects_public_and_symlinked_export_paths(self):
        spec = self.manifest["searches"]["web"]["tables"]["date"]
        for filename in (str(ROOT / "index.html"), "linked.csv"):
            spec["file"] = filename
            link = self.directory / "linked.csv"
            if not link.exists():
                link.symlink_to(self.directory / "web-date.csv")
            self.assertEqual(self.run_cli().returncode, 1)
        self.assertFalse((self.directory / "report.json").exists())

    def test_write_failure_removes_partial_report(self):
        source = self.directory / "manifest.json"
        source.write_text(json.dumps(self.manifest))
        target = self.directory / "report.json"
        args = ["search_console_report.py", str(source), str(target)]
        # fdopen's context still closes the real descriptor when write fails.
        import contextlib
        import os

        original = os.fdopen

        @contextlib.contextmanager
        def broken_writer(descriptor, mode):
            with original(descriptor, mode):
                class Writer:
                    def write(self, text):
                        raise OSError("synthetic disk error")
                yield Writer()

        with patch.object(sys, "argv", args), patch("scripts.search_console_report.os.fdopen", broken_writer):
            self.assertEqual(main(), 1)
        self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
