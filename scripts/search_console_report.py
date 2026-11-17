#!/usr/bin/env python3
"""Offline Search Console CSV report. Run --help for the private manifest contract.

Save this manifest with exports under ignored repo tmp/.
{"property":"sc-domain:example.com","start":"2026-10-20","end":"2026-11-16",
 "timezone":"America/Los_Angeles","searches":{"web":{"filters":[],
 "dataState":"final","tables":{"date":{"file":"web/Dates.csv",
 "aggregation":"byProperty","zeroValues":"ambiguous"},
 "query":{"file":"web/Queries.csv","aggregation":"byProperty",
 "zeroValues":"ambiguous"},"page":{"file":"web/Pages.csv",
 "aggregation":"byPage","zeroValues":"ambiguous"}}}}}

Add an independent image entry with the same structure. CSV headers must be
English Date / Top queries / Top pages, Clicks, Impressions, CTR, Position.
Unavailable cells may be blank, -, ~, N/A or null. Google exports can replace
unavailable values with zero. Set zeroValues=observed only after checking zeros
against the source report. Otherwise exported zeros become null conservatively.
filters records all active filters, dataState is final/partial/unknown. Metadata
is an owner attestation. Compare-mode and localized exports must be re-exported
in English without comparison. Every table must come from the declared window,
property, search type and filters. Table row coverage is always limited/unknown.
Query/page labels are suppressed unless --include-labels is explicitly supplied.
Output is JSON only, never executable CSV/HTML. No network or account operations.
"""

import argparse
import csv
from datetime import date
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
HEADERS = {"date": "Date", "query": "Top queries", "page": "Top pages"}
METRICS = ("clicks", "impressions", "ctr", "position")


def require(condition, message):
    """Reject invalid input without echoing private values."""
    if not condition:
        raise ValueError(message)


def private_path(value, root=ROOT):
    """Restrict input/output to ignored, untracked, non-symlink repo tmp paths."""
    candidate = Path(os.path.abspath(value))
    boundary = root / "tmp"
    require(candidate.is_relative_to(boundary) and candidate != boundary,
            "Files must be inside this checkout's ignored tmp directory")
    require(not any(part.is_symlink() for part in (candidate, *candidate.parents)),
            "Symlinks are forbidden for private report paths")
    relative = candidate.relative_to(root)
    ignored = subprocess.run(["git", "check-ignore", "--quiet", "--", str(relative)],
                             cwd=root, capture_output=True)
    tracked = subprocess.run(["git", "ls-files", "--", str(relative)],
                             cwd=root, capture_output=True)
    require(ignored.returncode == 0 and tracked.returncode == 0 and not tracked.stdout,
            "Private report paths must be ignored and untracked")
    return candidate


def parse_date(value):
    """Accept calendar dates in the exact export format."""
    require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value),
            "Dates must use YYYY-MM-DD")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise ValueError("Invalid calendar date") from None


def number(value, metric, zero_values):
    """Parse export numbers, preserving unavailable and ambiguous zero cells."""
    value = value.strip()
    if value.lower() in ("", "-", "~", "n/a", "null"):
        return None
    percent = value.endswith("%")
    require(not percent or metric == "ctr", "Unexpected percentage cell")
    require(re.fullmatch(r"\d+(?:\.\d+)?%?", value), "Invalid numeric cell")
    if metric in ("clicks", "impressions"):
        require(re.fullmatch(r"\d+", value), "Counts must be integers")
    parsed = float(value.rstrip("%")) / (100 if percent else 1)
    require(math.isfinite(parsed), "Non-finite numeric cell")
    if parsed == 0 and (zero_values == "ambiguous" or metric == "position"):
        return None
    if metric in ("clicks", "impressions"):
        require(parsed.is_integer() and parsed <= 2**53 - 1, "Invalid count cell")
        return int(parsed)
    require(parsed <= 1 if metric == "ctr" else parsed >= 1,
            "Invalid CTR or position cell")
    return parsed


def load_table(spec, dimension, directory, start, end):
    """Validate one native English export with no comparison columns."""
    require(isinstance(spec, dict) and set(spec) == {"file", "aggregation", "zeroValues"},
            "Table requires file, aggregation and zeroValues")
    require(spec["aggregation"] in ("byProperty", "byPage"), "Unknown aggregation")
    require(dimension != "page" or spec["aggregation"] == "byPage",
            "Page tables require byPage aggregation")
    require(spec["zeroValues"] in ("observed", "ambiguous"), "Unknown zeroValues")
    require(isinstance(spec["file"], str), "Invalid export file")
    filename = private_path(directory / spec["file"])
    rows, seen = [], set()
    export_bytes = filename.read_bytes()
    with io.StringIO(export_bytes.decode("utf-8-sig"), newline="") as handle:
        reader = csv.DictReader(handle, strict=True)
        expected = [HEADERS[dimension], "Clicks", "Impressions", "CTR", "Position"]
        require(reader.fieldnames == expected, "Expected native English CSV headers without comparison")
        for line, raw in enumerate(reader, 2):
            require(None not in raw and all(v is not None for v in raw.values()),
                    "CSV row has missing or extra columns")
            label = raw[HEADERS[dimension]]
            require(label.strip() and label not in seen, "Empty or duplicate dimension row")
            seen.add(label)
            if dimension == "date":
                require(start <= parse_date(label) <= end, "Date row outside manifest window")
            metrics = {key: number(raw["CTR" if key == "ctr" else key.title()], key,
                                   spec["zeroValues"]) for key in METRICS}
            clicks, impressions = metrics["clicks"], metrics["impressions"]
            if clicks is not None and impressions is not None:
                require(clicks <= impressions, "Clicks exceed impressions")
                derived = clicks / impressions if impressions else None
                require(metrics["ctr"] is None or derived is None or
                        abs(metrics["ctr"] - derived) <= 0.000051,
                        "CTR disagrees with clicks and impressions")
                metrics["ctr"] = derived
            else:
                metrics["ctr"] = None
            if impressions == 0:
                metrics["position"] = None
            rows.append({"row": line, "label": label, **metrics})
    return rows, hashlib.sha256(export_bytes).hexdigest()


def summarize_dates(rows):
    """Sum disjoint days and impression-weight position using the same scope."""
    totals = {key: None for key in METRICS}
    if not rows:
        return totals
    for metric in ("clicks", "impressions"):
        if all(row[metric] is not None for row in rows):
            totals[metric] = sum(row[metric] for row in rows)
    if totals["impressions"] and totals["clicks"] is not None:
        totals["ctr"] = totals["clicks"] / totals["impressions"]
    eligible = [row for row in rows if row["impressions"] != 0]
    if totals["impressions"] and all(row["position"] is not None for row in eligible):
        totals["position"] = sum(row["position"] * (row["impressions"] / totals["impressions"])
                                 for row in eligible)
    return totals


def build_report(manifest, directory, include_labels=False):
    """Keep property/type/window scopes separate and flag unavailable evidence."""
    require(isinstance(manifest, dict) and set(manifest) ==
            {"property", "start", "end", "timezone", "searches"}, "Invalid manifest fields")
    prop = manifest["property"]
    require(isinstance(prop, str), "Invalid property")
    domain_property = re.fullmatch(r"sc-domain:[a-zA-Z0-9.-]+", prop)
    url = urlsplit(prop)
    require(domain_property or (url.scheme in ("http", "https") and url.hostname
            and not url.username and not url.password and not url.query and not url.fragment),
            "Expected an exact Search Console domain or URL-prefix property")
    start, end = parse_date(manifest["start"]), parse_date(manifest["end"])
    require(start <= end and (end - start).days < 550, "Invalid or excessive date window")
    require(manifest["timezone"] == "America/Los_Angeles", "Daily Search Console exports use Pacific Time")
    searches = manifest["searches"]
    require(isinstance(searches, dict) and searches and set(searches) <= {"web", "image"},
            "searches must contain web and/or image")
    report = {"property": prop, "start": str(start), "end": str(end),
              "timezone": manifest["timezone"], "metadata": "owner-attested",
              "indexCoverage": None, "sitemapExclusions": None, "searches": {},
              "flags": ["indexing_evidence_unavailable", "daily_PT_not_UTC",
                        "search_clicks_do_not_establish_buyers"]}
    for missing in sorted({"web", "image"} - searches.keys()):
        report["flags"].append(f"{missing}_export_missing")
    for search_type, scope in searches.items():
        require(isinstance(scope, dict) and set(scope) == {"filters", "dataState", "tables"},
                "Search scope requires filters, dataState and tables")
        require(isinstance(scope["filters"], list) and all(isinstance(f, str) for f in scope["filters"]),
                "filters must list all active filters")
        require(scope["dataState"] in ("final", "partial", "unknown"), "Invalid dataState")
        tables = scope["tables"]
        require(isinstance(tables, dict) and tables and set(tables) <= HEADERS.keys(), "Invalid tables")
        result = {"dataState": scope["dataState"], "filterCount": len(scope["filters"]),
                  "tables": {}, "flags": []}
        for missing in sorted(HEADERS.keys() - tables.keys()):
            result["flags"].append(f"{missing}_table_missing")
        for dimension, spec in tables.items():
            rows, digest = load_table(spec, dimension, directory, start, end)
            table = {"aggregation": spec["aggregation"], "rowCount": len(rows),
                     "missingCells": {key: sum(row[key] is None for row in rows) for key in METRICS}}
            table["exportSha256"] = digest
            if spec["zeroValues"] == "ambiguous":
                result["flags"].append(f"{dimension}_export_zeros_may_be_unavailable")
            if dimension == "date":
                expected = (end - start).days + 1
                table["missingDays"] = expected - len(rows)
                table["observedDayTotals"] = summarize_dates(rows)
                complete = len(rows) == expected and scope["dataState"] == "final"
                table["windowTotals"] = table["observedDayTotals"] if complete else None
                table["positionMethod"] = "impression-weighted disjoint daily rows, same aggregation"
                table["positionPrecision"] = "approximate from rounded export positions"
            else:
                table["coverage"] = "limited_or_unknown_including_privacy_omissions"
                # Independent query/page rows cannot establish property denominators.
                candidates = [row for row in rows if row["impressions"] and row["clicks"] is not None]
                candidates.sort(key=lambda row: (-row["impressions"], row["ctr"], row["row"]))
                table["ranking"] = "impressions descending, CTR ascending on ties; manual relevance review required"
                table["opportunities"] = [{key: value for key, value in row.items()
                                           if include_labels or key != "label"} for row in candidates[:20]]
            result["tables"][dimension] = table
        report["searches"][search_type] = result
    return report


def main():
    """Read local private exports and create a new owner-only report file."""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("manifest", type=Path)
    parser.add_argument("output", type=Path, help="New JSON file under this checkout's ignored tmp/")
    parser.add_argument("--include-labels", action="store_true", help="Include private query/page text in JSON")
    args = parser.parse_args()
    try:
        source, target = private_path(args.manifest), private_path(args.output)
        manifest_bytes = source.read_bytes()
        manifest = json.loads(manifest_bytes.decode("utf-8"))
        report = build_report(manifest, source.parent, args.include_labels)
        report["manifestSha256"] = hashlib.sha256(manifest_bytes).hexdigest()
        serialized = json.dumps(report, ensure_ascii=True, allow_nan=False, indent=2) + "\n"
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "w") as handle:
                handle.write(serialized)
        except OSError:
            target.unlink(missing_ok=True)
            raise
    except (ValueError, TypeError, KeyError, OSError, csv.Error, OverflowError):
        # Provider text, file names, query strings and numeric cells stay private.
        print("Search Console report failed. Check schema, private paths and CSV values using --help.", file=sys.stderr)
        return 1
    print("Private offline report saved. Indexing and live acquisition acceptance require owner evidence.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
