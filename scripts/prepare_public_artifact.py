"""Build a complete, allowlisted static customer candidate. This command never deploys."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from scripts.public_artifact_policy import (
    CATALOG,
    IDENTITY,
    MARKER,
    RECEIPT,
    SEO_GENERATOR,
    regular_file,
    release_identity,
    sha256,
    source_files,
)
from scripts.validate_public_artifact import validate_site


def check_output(output: Path, replace: bool) -> None:
    """Only replace an owned generated package, including after a concurrent build."""
    if output.is_symlink():
        raise ValueError("artifact output must not be a symlink")
    if output.exists():
        marker = output / MARKER
        if (
            not replace
            or marker.is_symlink()
            or not marker.is_file()
            or marker.read_text() != "PhotosByElie generated public artifact package\n"
        ):
            raise ValueError("existing output requires --replace and a generated artifact marker")


def prepare(
    repo_root: Path, output: Path, *, seo_root: Path | None = None, replace: bool = False
) -> dict:
    """Stage in isolation and expose a candidate only after all static checks pass."""
    repo_root = repo_root.resolve(strict=True)
    if output.is_symlink():
        raise ValueError("artifact output must not be a symlink")
    output = output.resolve()
    if output == repo_root or repo_root.is_relative_to(output):
        raise ValueError("artifact output must not replace or alias the repository")
    check_output(output, replace)
    if (repo_root / SEO_GENERATOR).exists():
        regular_file(repo_root, SEO_GENERATOR)
        seo_output = seo_root or repo_root / "tmp/public-seo"
        if seo_output.is_symlink():
            raise ValueError("SEO output must not be a symlink")
        seo_output = seo_output.resolve()
        if (
            repo_root.is_relative_to(seo_output)
            or output.is_relative_to(seo_output)
            or seo_output.is_relative_to(output)
        ):
            raise ValueError("SEO output overlaps repository or customer package")
        if seo_output.is_relative_to(repo_root) and not seo_output.is_relative_to(
            repo_root / "tmp"
        ):
            raise ValueError("generated SEO output inside the repository must stay under tmp/")
        catalog_hash = sha256(repo_root / CATALOG)
        subprocess.run(
            [
                "node",
                str(repo_root / SEO_GENERATOR),
                "--repo-root",
                str(repo_root),
                "--catalog",
                str(repo_root / CATALOG),
                "--output",
                str(seo_output),
            ],
            cwd=repo_root,
            check=True,
        )
        if sha256(repo_root / CATALOG) != catalog_hash:
            raise ValueError("public catalog changed during SEO generation")
    sources = source_files(repo_root, seo_root)
    if any(source.is_relative_to(output) for source in sources.values()):
        raise ValueError("artifact output overlaps public source inputs")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".pbe-public-stage-", dir=output.parent) as directory:
        package = Path(directory)
        site = package / "site"
        for name, source in sources.items():
            target = site / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
        identity = release_identity(repo_root)
        (site / IDENTITY).write_text(json.dumps(identity, indent=2, sort_keys=True) + "\n")
        validation = validate_site(repo_root, site, seo_root=seo_root)
        checker = regular_file(repo_root, "scripts/check_public_catalog.cjs")
        try:
            subprocess.run(
                ["node", str(checker), "--generation-only", str(site)],
                cwd=repo_root,
                check=True,
                capture_output=True,
                text=True,
            )
        except subprocess.CalledProcessError as error:
            raise ValueError(
                f"public catalog generation check failed: {error.stderr.strip()}"
            ) from error
        names = set(sources) | {IDENTITY}
        receipt = {
            "schema": "photosbyelie.public-artifact-receipt.v1",
            "identity": identity,
            "validation": validation,
            "files": {name: sha256(site / name) for name in sorted(names)},
        }
        (package / RECEIPT).write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
        (package / MARKER).write_text("PhotosByElie generated public artifact package\n")
        lock = output.with_name(output.name + ".lock")
        lock.mkdir()
        try:
            check_output(output, replace)
            previous = package.with_name(package.name + "-previous")
            if output.exists():
                output.rename(previous)
            try:
                package.rename(output)
            except OSError:
                if previous.exists():
                    previous.rename(output)
                raise
            if previous.exists():
                shutil.rmtree(previous)
        finally:
            lock.rmdir()
    return receipt


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, default=Path("tmp/public-release"))
    parser.add_argument("--seo-root", type=Path)
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    receipt = prepare(args.repo_root, args.output, seo_root=args.seo_root, replace=args.replace)
    print(
        json.dumps(
            {
                "output": str(args.output / "site"),
                "identity": receipt["identity"],
                **receipt["validation"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
