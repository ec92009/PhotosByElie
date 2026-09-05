# /// script
# requires-python = ">=3.10"
# dependencies = ["lizard==1.24.0"]
# ///
"""Reproducible native production metrics and a no-growth review-budget check."""
import argparse
import json
import subprocess
from pathlib import Path

import lizard

ROOT = Path(__file__).resolve().parents[1]
SOURCES = "native/PhotosByElieBackstage/Sources"
LIMITS = {"nloc": 60, "ccn": 15, "parameters": 6, "nesting": 4}
FILE_LIMIT = 1000


def production_source(text):
    """Blank DEBUG-only preview bodies, retaining original source line numbers."""
    stack = []
    active = True
    output = []
    for line in text.splitlines():
        directive = line.strip()
        if directive.startswith("#if "):
            debug = directive == "#if DEBUG"
            stack.append((active, debug))
            active = active and not debug
            output.append("")
        elif directive == "#else" and stack:
            parent, debug = stack[-1]
            if debug:
                active = parent and not active
            output.append("")
        elif directive == "#endif" and stack:
            active, _ = stack.pop()
            output.append("")
        else:
            output.append(line if active else "")
    return "\n".join(output)


def collect():
    names = subprocess.check_output(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", SOURCES],
        cwd=ROOT, text=True,
    ).splitlines()
    analyzer = lizard.FileAnalyzer(lizard.get_extensions(["ns"]))
    files, functions, excluded = [], [], []
    for name in sorted(set(names)):
        path = ROOT / name
        if path.suffix != ".swift" or not path.is_file():
            continue
        text = path.read_text()
        if "generated" in name.lower() or "DO NOT EDIT" in "\n".join(text.splitlines()[:8]):
            excluded.append({"file": name, "reason": "generated source"})
            continue
        source = production_source(text)
        result = analyzer.analyze_source_code(name, source)
        if not result.function_list and "#if DEBUG" in text:
            excluded.append({"file": name, "reason": "DEBUG-only preview fixture"})
            continue
        files.append({"key": name, "nloc": result.nloc})
        for f in result.function_list:
            functions.append({
                "key": f"{name}::{f.long_name}", "file": name, "name": f.name,
                "start": f.start_line, "end": f.end_line, "nloc": f.nloc,
                "ccn": f.cyclomatic_complexity, "parameters": len(f.parameters),
                "nesting": f.max_nested_structures,
            })
    return {
        "schema": 1, "sourceRevision": subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "workingTree": bool(subprocess.check_output(
            ["git", "status", "--porcelain", "--", SOURCES], cwd=ROOT, text=True).strip()),
        "tool": "lizard 1.24.0 with ns extension", "limits": LIMITS,
        "fileLimit": FILE_LIMIT, "files": files, "functions": functions, "excluded": excluded,
    }


def ceilings(rows, metrics):
    result = {}
    for row in rows:
        entry = result.setdefault(row["key"], {})
        for metric in metrics:
            entry[metric] = max(entry.get(metric, 0), row[metric])
    return result


def regressions(report, baseline):
    failures = []
    for kind, limits in [("files", {"nloc": FILE_LIMIT}), ("functions", LIMITS)]:
        previous = ceilings(baseline[kind], limits)
        for row in report[kind]:
            for metric, limit in limits.items():
                ceiling = max(limit, previous.get(row["key"], {}).get(metric, 0))
                if row[metric] > ceiling:
                    failures.append(f"{row['key']}: {metric} {row[metric]} exceeds {ceiling}")
    return failures


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--check", type=Path, help="Fail on a new or increased over-budget metric")
    args = parser.parse_args()
    report = collect()
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(f"{len(report['files'])} production Swift files, {sum(f['nloc'] for f in report['files'])} NLOC, "
          f"{len(report['functions'])} functions; {len(report['excluded'])} files excluded")
    print(f"Files over {FILE_LIMIT}: {sum(f['nloc'] > FILE_LIMIT for f in report['files'])}")
    for metric, limit in LIMITS.items():
        print(f"Functions over {metric} {limit}: {sum(f[metric] > limit for f in report['functions'])}")
    if args.check:
        failures = regressions(report, json.loads(args.check.read_text()))
        for failure in failures:
            print(failure)
        raise SystemExit(bool(failures))


if __name__ == "__main__":
    main()
