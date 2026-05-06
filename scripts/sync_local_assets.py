#!/usr/bin/env python3
"""Sync PhotosByElie local-only asset vaults between two checkouts.

Git owns the public Expo subset. This script owns the ignored local vaults:
Reserve, Hidden, and review logs.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_PATHS = (
    Path("assets/reserve"),
    Path("assets/hidden"),
    Path(".review-logs"),
)

OPTIONAL_EXPO_PATH = Path("assets/expo")

KNOWN_PEERS = {
    "max": (
        Path("/Volumes/MHD2/Users/ecohen/Dev/PhotosByElie"),
        Path("/Volumes/MHD2/Users/ecohen/Dev/photosByElie"),
        Path("/Volumes/Max/Users/ecohen/Dev/PhotosByElie"),
        Path("/Volumes/Max/Users/ecohen/Dev/photosByElie"),
    ),
    "david": (
        Path("/Volumes/David/Users/ecohen/Dev/PhotosByElie"),
        Path("/Volumes/David/Users/ecohen/Dev/photosByElie"),
        Path("/Volumes/Macintosh HD/Users/ecohen/Dev/PhotosByElie"),
        Path("/Volumes/Macintosh HD/Users/ecohen/Dev/photosByElie"),
    ),
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync ignored PhotosByElie Reserve/Hidden assets between local and peer checkouts."
    )
    parser.add_argument(
        "peer",
        nargs="?",
        help="Peer repo path, or a known peer name: max or david. Defaults to the first mounted known peer.",
    )
    parser.add_argument(
        "--direction",
        choices=("push", "pull"),
        default="push",
        help="push sends this checkout to the peer; pull receives from the peer. Default: push.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually copy files. Without this flag the script runs rsync as a dry run.",
    )
    parser.add_argument(
        "--delete",
        action="store_true",
        help="Mirror deletions to the destination. Leave off for additive safety.",
    )
    parser.add_argument(
        "--include-expo",
        action="store_true",
        help="Also sync tracked assets/expo. Normally Git should handle Expo.",
    )
    parser.add_argument(
        "--path",
        action="append",
        dest="paths",
        help="Relative path to sync. Repeat to override the default Reserve/Hidden/log set.",
    )
    parser.add_argument(
        "--progress",
        action="store_true",
        help="Show per-file rsync progress.",
    )
    return parser.parse_args()


def is_repo_root(path: Path) -> bool:
    return (path / "VERSION").is_file() and (path / "photos-data.js").is_file() and (path / "assets").is_dir()


def first_existing_known_peer() -> Path | None:
    for candidates in KNOWN_PEERS.values():
        for path in candidates:
            if path.exists():
                return path
    return None


def resolve_peer(value: str | None) -> Path:
    if not value:
        detected = first_existing_known_peer()
        if detected:
            return detected
        names = ", ".join(KNOWN_PEERS)
        raise SystemExit(f"No mounted peer repo found. Pass a path or one of: {names}.")

    if value in KNOWN_PEERS:
        for path in KNOWN_PEERS[value]:
            if path.exists():
                return path
        candidates = "\n".join(f"  - {path}" for path in KNOWN_PEERS[value])
        raise SystemExit(f"No mounted checkout found for {value}. Tried:\n{candidates}")

    return Path(value).expanduser().resolve()


def relative_paths(args: argparse.Namespace) -> list[Path]:
    if args.paths:
        paths = [Path(item) for item in args.paths]
    else:
        paths = list(DEFAULT_PATHS)
    if args.include_expo and OPTIONAL_EXPO_PATH not in paths:
        paths.append(OPTIONAL_EXPO_PATH)
    return paths


def ensure_safe_relative(path: Path) -> Path:
    if path.is_absolute() or ".." in path.parts:
        raise SystemExit(f"Sync paths must be repo-relative and cannot escape the checkout: {path}")
    return path


def du(path: Path) -> str:
    if not path.exists():
        return "missing"
    try:
        result = subprocess.run(
            ["du", "-sh", str(path)],
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return result.stdout.split()[0]
    except Exception:
        return "unknown"


def run_rsync(source: Path, destination: Path, *, apply: bool, delete: bool, progress: bool) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "rsync",
        "-a",
        "--human-readable",
        "--itemize-changes",
        "--exclude",
        ".DS_Store",
    ]
    if not apply:
        command.append("--dry-run")
    if delete:
        command.append("--delete")
    if progress:
        command.append("--progress")
    command.extend([f"{source}/" if source.is_dir() else str(source), f"{destination}/"])
    print(" ".join(command))
    subprocess.run(command, check=True)


def main() -> int:
    args = parse_args()
    if not shutil.which("rsync"):
        raise SystemExit("rsync is required for asset sync.")

    peer_root = resolve_peer(args.peer)
    if not is_repo_root(REPO_ROOT):
        raise SystemExit(f"Current script is not inside a PhotosByElie checkout: {REPO_ROOT}")
    if not is_repo_root(peer_root):
        raise SystemExit(f"Peer path does not look like a PhotosByElie checkout: {peer_root}")
    if os.path.realpath(REPO_ROOT) == os.path.realpath(peer_root):
        raise SystemExit("Local and peer checkouts resolve to the same path; refusing to sync.")

    source_root, destination_root = (
        (REPO_ROOT, peer_root) if args.direction == "push" else (peer_root, REPO_ROOT)
    )
    mode = "APPLY" if args.apply else "DRY RUN"
    print(f"{mode}: {args.direction} local asset vaults")
    print(f"Source:      {source_root}")
    print(f"Destination: {destination_root}")
    print(f"Delete destination extras: {'yes' if args.delete else 'no'}")

    for relative in map(ensure_safe_relative, relative_paths(args)):
        source = source_root / relative
        destination = destination_root / relative
        print(f"\n{relative} ({du(source)} source)")
        if not source.exists():
            print("  skipped: source path does not exist")
            continue
        run_rsync(source, destination, apply=args.apply, delete=args.delete, progress=args.progress)

    if not args.apply:
        print("\nDry run only. Re-run with --apply to copy files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
