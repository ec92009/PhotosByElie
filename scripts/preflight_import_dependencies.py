#!/usr/bin/env python3
"""Preflight the Owner import sweep before photo work is queued."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path


LOCAL_TOOL_DIRS = (
    Path("/opt/homebrew/bin"),
    Path("/usr/local/bin"),
    Path("/opt/homebrew/sbin"),
    Path("/usr/local/sbin"),
)
FIXED_SOURCE_ROOTS = (
    ("camera", "Camera sources", Path("/Volumes/Saturn/Pictures/LR/Camera"), True),
    ("apple-photo-albums", "Apple Photos album sources", Path("/Volumes/Saturn/Pictures/LR/Apple Photo Albums"), False),
    ("leonardo", "Leonardo sources", Path("/Volumes/Saturn/Pictures/LR/_All Leonardo"), True),
)
REQUIRED_TOOLS = ("exiftool", "sips", "ffmpeg", "ffprobe")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, help="Selected source folder for a selected-folder import.")
    parser.add_argument("--source-select", default="auto", help="Selected source filter mode, used for reporting only.")
    parser.add_argument("--skip-phase", action="append", default=[], help="Import sweep phase that will be skipped.")
    return parser.parse_args()


def append_path_for_tool(tool_dir: Path) -> None:
    os.environ["PATH"] = f"{tool_dir}{os.pathsep}{os.environ.get('PATH', '')}"


def resolve_tool(name: str) -> str:
    path = shutil.which(name)
    if path:
        return path
    for tool_dir in LOCAL_TOOL_DIRS:
        candidate = tool_dir / name
        if candidate.exists() and os.access(candidate, os.X_OK):
            append_path_for_tool(tool_dir)
            return str(candidate)
    return ""


def check_python(result: dict, errors: list[str]) -> None:
    python_result = {"executable": sys.executable, "pillow": "missing"}
    try:
        __import__("PIL")
    except ImportError:
        errors.append(
            f"Pillow is missing for {sys.executable}; install Pillow for this interpreter "
            "or set PBE_SWEEP_PYTHON to a Python that has it."
        )
    else:
        python_result["pillow"] = "ok"
    result["python"] = python_result


def check_tools(result: dict, errors: list[str]) -> None:
    tools = []
    for name in REQUIRED_TOOLS:
        path = resolve_tool(name)
        tools.append({"name": name, "ok": bool(path), "path": path})
        if not path:
            errors.append(f"Missing required tool: {name}")
    result["tools"] = tools


def first_env(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def r2_backend() -> str:
    configured = os.environ.get("PBE_R2_BACKEND", "").strip()
    if configured:
        return configured
    if (
        first_env("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")
        and first_env("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID")
        and first_env("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY")
    ):
        return "s3"
    return "wrangler"


def wrangler_path() -> tuple[str, str]:
    configured = os.environ.get("WRANGLER_BIN", "").strip()
    if configured:
        candidate = Path(configured).expanduser()
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate), "WRANGLER_BIN"
        return "", "WRANGLER_BIN"
    local = shutil.which("wrangler")
    if local:
        return local, "PATH"
    cached = sorted(
        Path.home().glob(".npm/_npx/*/node_modules/.bin/wrangler"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if cached:
        return str(cached[0]), "npm-cache"
    npx = shutil.which("npx")
    if npx:
        return npx, "npx"
    return "", ""


def check_r2(result: dict, errors: list[str]) -> None:
    backend = r2_backend()
    r2 = {"backend": backend, "ok": False}
    if backend == "s3":
        missing = [
            label
            for label, value in (
                ("R2_ACCOUNT_ID or CLOUDFLARE_ACCOUNT_ID", first_env("R2_ACCOUNT_ID", "CLOUDFLARE_ACCOUNT_ID")),
                ("R2_ACCESS_KEY_ID or AWS_ACCESS_KEY_ID", first_env("R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID")),
                ("R2_SECRET_ACCESS_KEY or AWS_SECRET_ACCESS_KEY", first_env("R2_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY")),
            )
            if not value
        ]
        r2["missing"] = missing
        r2["ok"] = not missing
        if missing:
            errors.append(f"Missing R2 S3 credential(s): {', '.join(missing)}")
    elif backend == "wrangler":
        path, source = wrangler_path()
        r2.update({"command": path, "commandSource": source, "ok": bool(path)})
        if not path:
            if source == "WRANGLER_BIN":
                errors.append(f"WRANGLER_BIN is set but is not executable: {os.environ.get('WRANGLER_BIN', '')}")
            else:
                errors.append("Missing R2 upload command: install wrangler, configure WRANGLER_BIN, or make npx available.")
    else:
        errors.append(f"Unsupported PBE_R2_BACKEND: {backend}. Use wrangler or s3.")
    result["r2"] = r2


def directory_readable(path: Path) -> tuple[bool, str]:
    if not path.exists():
        return False, "missing"
    if not path.is_dir():
        return False, "not a directory"
    if not os.access(path, os.R_OK | os.X_OK):
        return False, "not readable"
    try:
        with os.scandir(path):
            pass
    except OSError as exc:
        return False, f"not readable: {exc}"
    return True, "ok"


def check_source(
    result: dict,
    errors: list[str],
    *,
    phase: str,
    label: str,
    path: Path,
    required: bool,
    skipped: bool,
) -> None:
    source = {
        "phase": phase,
        "label": label,
        "path": str(path.expanduser()),
        "required": required,
        "skipped": skipped,
        "ok": True,
        "status": "skipped" if skipped else "ok",
    }
    if skipped:
        result["sources"].append(source)
        return
    ok, status = directory_readable(path.expanduser())
    source["ok"] = ok or (status == "missing" and not required)
    source["status"] = "optional-missing" if status == "missing" and not required else status
    if not source["ok"]:
        errors.append(f"{label} folder is {status}: {path.expanduser()}")
    result["sources"].append(source)


def check_sources(args: argparse.Namespace, result: dict, errors: list[str]) -> None:
    skip_phases = {str(phase).strip() for phase in args.skip_phase if str(phase).strip()}
    result["sources"] = []
    if args.source_root:
        check_source(
            result,
            errors,
            phase="selected-folder",
            label="Selected import source",
            path=args.source_root,
            required=True,
            skipped="selected-folder" in skip_phases,
        )
        return
    for phase, label, path, required in FIXED_SOURCE_ROOTS:
        check_source(
            result,
            errors,
            phase=phase,
            label=label,
            path=path,
            required=required,
            skipped=phase in skip_phases,
        )


def print_summary(result: dict) -> None:
    python_status = result["python"]["pillow"]
    if python_status == "ok":
        print(f"Preflight OK: Pillow available for {result['python']['executable']}")
    else:
        print(f"Preflight needs attention: Pillow missing for {result['python']['executable']}")

    for tool in result["tools"]:
        if tool["ok"]:
            print(f"Preflight OK: {tool['name']} at {tool['path']}")
        else:
            print(f"Preflight needs attention: {tool['name']} is missing")

    r2 = result["r2"]
    if r2.get("ok"):
        if r2["backend"] == "s3":
            print("Preflight OK: R2 S3 upload credentials are present")
        else:
            print(f"Preflight OK: R2 Wrangler upload command via {r2.get('commandSource')}: {r2.get('command')}")
    else:
        print(f"Preflight needs attention: R2 upload backend {r2.get('backend')} is not ready")

    for source in result["sources"]:
        if source["skipped"]:
            print(f"Preflight skipped: {source['label']} ({source['phase']})")
        elif source["ok"]:
            print(f"Preflight OK: {source['label']} is {source['status']} at {source['path']}")
        else:
            print(f"Preflight needs attention: {source['label']} is {source['status']} at {source['path']}")


def main() -> int:
    args = parse_args()
    errors: list[str] = []
    result: dict = {
        "ok": False,
        "sourceSelect": args.source_select,
        "errors": errors,
    }
    check_python(result, errors)
    check_tools(result, errors)
    check_r2(result, errors)
    check_sources(args, result, errors)
    result["ok"] = not errors

    print_summary(result)
    print(f"PBE_PREFLIGHT {json.dumps(result, sort_keys=True)}")
    if errors:
        print(f"ERROR: Preflight failed: {errors[0]}")
        return 2
    print("Preflight OK: import dependencies, R2 upload configuration, and source readability are ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
