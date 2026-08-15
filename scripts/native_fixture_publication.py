#!/usr/bin/env python3
"""Validate and register exact public-fixture assets in the static catalog."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = Path(
    os.environ.get("PBE_CONNECTOR_DATA_ROOT", str(SCRIPT_DIR.parent))
).expanduser().resolve()
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from fixture_pipeline import publication_plan  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture-id", required=True)
    parser.add_argument("--asset-id", action="append", default=[])
    parser.add_argument("--plan", action="store_true")
    args = parser.parse_args()
    plan = publication_plan(REPO_ROOT, args.fixture_id, args.asset_id)
    if args.plan or not plan["ok"]:
        print(json.dumps(plan, ensure_ascii=False))
        raise SystemExit(0 if plan["ok"] else 1)
    asset_ids = [item["assetId"] for item in plan["eligible"]]
    command = [
        sys.executable,
        str(SCRIPT_DIR / "sidecar_maintenance.py"),
        "register-uploaded-catalog",
        *[argument for asset_id in asset_ids for argument in ("--asset-id", asset_id)],
    ]
    completed = subprocess.run(
        command,
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode:
        print(json.dumps({"ok": False, "error": (completed.stderr or completed.stdout).strip()}))
        raise SystemExit(completed.returncode)
    registration = json.loads(completed.stdout or "{}")
    print(json.dumps({
        "ok": True,
        "fixtureId": args.fixture_id,
        "assetIds": asset_ids,
        "publicationPlan": plan,
        "registration": registration.get("result") or {},
        "rebuild": registration.get("rebuild") or {},
        "deployed": False,
        "pushed": False,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
