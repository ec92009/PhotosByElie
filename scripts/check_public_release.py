"""Run the existing authoritative release gates before building a public package."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path

from scripts.prepare_public_artifact import prepare
from scripts.public_artifact_policy import SEO_GENERATOR, release_identity
from scripts.validate_public_artifact import validate_package


def check_release(
    repo_root: Path,
    output: Path,
    owner_db: Path,
    *,
    seo_root: Path | None = None,
    replace: bool = False,
) -> dict:
    """Require clean source, focused/full tests, and reviewed read-only Owner authority."""
    identity = release_identity(repo_root)
    if identity["sourceTreeDirty"]:
        raise ValueError("release requires a clean committed source tree")
    if not owner_db.is_absolute() or not owner_db.is_file():
        raise ValueError("release requires an absolute reviewed Owner.sqlite snapshot path")
    env = {**os.environ, "PHOTOSBYELIE_OWNER_DB": str(owner_db)}
    integration_tests = []
    if (repo_root / "scripts/public_gallery_startup.test.mjs").exists():
        integration_tests.append("scripts/public_gallery_startup.test.mjs")
    if (repo_root / "scripts/customer_resilience.test.mjs").exists():
        integration_tests.append("scripts/customer_resilience.test.mjs")
    if (repo_root / "worker/paid-order-fulfillment.test.mjs").exists():
        integration_tests.append("worker/paid-order-fulfillment.test.mjs")
    if (repo_root / SEO_GENERATOR).exists():
        integration_tests.append("scripts/build_public_seo.test.mjs")
    commands = [["npm", "run", "public:test"]]
    if integration_tests:
        commands.append(["node", "--test", *integration_tests])
    commands.extend([["npm", "test"], ["npm", "run", "validate"]])
    for command in commands:
        subprocess.run(command, cwd=repo_root, env=env, check=True)
    if release_identity(repo_root) != identity:
        raise ValueError("source changed during release checks")
    receipt = prepare(repo_root, output, seo_root=seo_root, replace=replace)
    subprocess.run(
        ["node", "scripts/check_public_catalog.cjs", str(output / "site")],
        cwd=repo_root,
        check=True,
    )
    validate_package(repo_root, output, seo_root=seo_root)
    receipt["releaseChecks"] = {
        "sourceCommit": identity["commit"],
        "commands": [
            *[" ".join(command) for command in commands],
            "public artifact validation",
            "shipped catalog decoder and script syntax",
        ],
    }
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, default=Path("tmp/public-release"))
    parser.add_argument("--owner-db", type=Path, required=True)
    parser.add_argument("--seo-root", type=Path)
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    result = check_release(
        args.repo_root.resolve(),
        args.output.absolute(),
        args.owner_db,
        seo_root=args.seo_root,
        replace=args.replace,
    )
    print(
        json.dumps(
            {
                "identity": result["identity"],
                "validation": result["validation"],
                "releaseChecks": result["releaseChecks"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
