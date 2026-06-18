#!/usr/bin/env python3
"""Dry-run-first cleanup for ignored PhotosByElie local artifacts."""

from __future__ import annotations

import argparse
import datetime as dt
import shutil
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARCHIVE_ROOT = REPO_ROOT.parent / "PhotosByElie-local-archive"

REMOVE_PATHS = (
    ".playwright-mcp",
    "node_modules",
    "scripts/__pycache__",
)

ARCHIVE_PATHS = (
    "tmp",
    "output",
    ".curation-logs",
    "PhotosByElie Blacklist.app",
    "handwritten notes",
    ".review-logs/import-source-thumbs",
    "assets/owner-actions/aggressive-culling-backups",
)

ARCHIVE_GLOBS = (
    "facebook-built-in-*.md",
    "facebook-built-in-*.png",
    "assets/owner-actions/aggressive-culling-*.json",
    "assets/owner-actions/approved-burst-culling-result-*.json",
    "assets/owner-actions/blocked-to-wastebasket-result-*.json",
    "assets/owner-actions/review-state-normalization-*.json",
)

PROTECTED_PATHS = (
    ".env.stripe-test.local",
    ".wrangler",
    "assets/hidden",
    "assets/owner-actions/Owner.sqlite",
    "assets/owner-actions/Owner.sqlite-shm",
    "assets/owner-actions/Owner.sqlite-wal",
    "assets/owner-actions/etsy-about-candidates",
    "assets/owner-actions/etsy-listing-packages",
    "assets/owner-actions/pixelmator-edits.local.json",
    "assets/owner-actions/real-estate-clients.local.json",
    "assets/owner-actions/title-keyword-review-queue",
    "pixelmator.pro.edits",
    "pixelmator.pro.imported-edits",
)


@dataclass(frozen=True)
class Action:
    kind: str
    path: Path
    size: int


def relative(path: Path) -> str:
    return path.relative_to(REPO_ROOT).as_posix()


def path_size(path: Path) -> int:
    if not path.exists() and not path.is_symlink():
        return 0
    if path.is_file() or path.is_symlink():
        return path.lstat().st_size
    return sum(item.lstat().st_size for item in path.rglob("*") if item.exists() or item.is_symlink())


def format_bytes(size: int) -> str:
    value = float(size)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if value < 1024 or unit == "TB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    raise AssertionError("unreachable")


def overlaps(candidate: Path, protected: Path) -> bool:
    return candidate == protected or candidate in protected.parents or protected in candidate.parents


def protected_paths() -> list[Path]:
    return [(REPO_ROOT / item).resolve() for item in PROTECTED_PATHS]


def assert_not_protected(path: Path) -> None:
    candidate = path.resolve()
    for protected in protected_paths():
        if overlaps(candidate, protected):
            raise SystemExit(f"Refusing to touch protected local state: {relative(path)}")


def collect_actions() -> list[Action]:
    actions: list[Action] = []

    for ds_store in REPO_ROOT.rglob(".DS_Store"):
        if ".git" in ds_store.relative_to(REPO_ROOT).parts:
            continue
        actions.append(Action("remove", ds_store, path_size(ds_store)))

    for item in REMOVE_PATHS:
        path = REPO_ROOT / item
        if path.exists() or path.is_symlink():
            assert_not_protected(path)
            actions.append(Action("remove", path, path_size(path)))

    for item in ARCHIVE_PATHS:
        path = REPO_ROOT / item
        if path.exists() or path.is_symlink():
            assert_not_protected(path)
            actions.append(Action("archive", path, path_size(path)))

    for pattern in ARCHIVE_GLOBS:
        for path in REPO_ROOT.glob(pattern):
            if path.exists() or path.is_symlink():
                assert_not_protected(path)
                actions.append(Action("archive", path, path_size(path)))

    unique: dict[Path, Action] = {}
    for action in actions:
        existing = unique.get(action.path)
        if existing is None or existing.kind == "remove":
            unique[action.path] = action
    return sorted(unique.values(), key=lambda action: (action.kind, relative(action.path)))


def apply_actions(actions: list[Action], archive_root: Path) -> Path:
    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    archive_dir = archive_root / f"{timestamp}-repo-cleanup"

    for action in actions:
        if action.kind == "remove":
            if action.path.is_dir() and not action.path.is_symlink():
                shutil.rmtree(action.path)
            else:
                action.path.unlink(missing_ok=True)
            continue

        destination = archive_dir / action.path.relative_to(REPO_ROOT)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(action.path), str(destination))
    return archive_dir


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="perform cleanup; default is a dry run")
    parser.add_argument(
        "--archive-root",
        type=Path,
        default=DEFAULT_ARCHIVE_ROOT,
        help=f"archive root for moved artifacts (default: {DEFAULT_ARCHIVE_ROOT})",
    )
    args = parser.parse_args()

    actions = collect_actions()
    total = sum(action.size for action in actions)
    mode = "APPLY" if args.apply else "DRY RUN"
    print(f"{mode}: {len(actions)} cleanup action(s), {format_bytes(total)} selected")
    for action in actions:
        print(f"{action.kind:7} {format_bytes(action.size):>10}  {relative(action.path)}")

    if args.apply and actions:
        archive_dir = apply_actions(actions, args.archive_root)
        print(f"Archived artifacts under: {archive_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
