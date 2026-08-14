#!/usr/bin/env python3
"""Materialize and verify an immutable Owner connector code runtime."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess


MANIFEST_NAME = "connector-runtime-manifest.json"
MANIFEST_KIND = "photosbyelie-owner-connector-runtime"
MANIFEST_SCHEMA_VERSION = 1
REQUIRED_RUNTIME_FILES = frozenset(
    {
        "scripts/fixture_pipeline.py",
        "scripts/local_server.py",
        "scripts/new_owner_connector.py",
        "scripts/new_owner_connector_launch_agent.plist.in",
        "scripts/owner_connector_runtime.py",
        "scripts/requested_ai_proposal_pass.py",
        "scripts/sidecar_server.py",
        "scripts/sidecar_state_db.py",
    }
)


class ConnectorRuntimeError(RuntimeError):
    """Raised when a connector runtime cannot be safely created or trusted."""


@dataclass(frozen=True)
class ConnectorRuntimeVerification:
    revision: str
    file_count: int
    manifest_sha256: str


@dataclass(frozen=True)
class CommitScriptEntry:
    path: PurePosixPath
    object_id: str
    mode: int


def _sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_script_path(value: object) -> PurePosixPath:
    relative = PurePosixPath(str(value or ""))
    if (
        relative.is_absolute()
        or not relative.parts
        or relative.parts[0] != "scripts"
        or any(part in {"", ".", ".."} for part in relative.parts)
    ):
        raise ConnectorRuntimeError(f"Unsafe connector runtime path: {value!r}")
    return relative


def _run_git(source_root: Path, *arguments: str) -> bytes:
    git = shutil.which("git")
    if not git:
        raise ConnectorRuntimeError("git is required to materialize the connector runtime.")
    completed = subprocess.run(
        [git, "-C", str(source_root), *arguments],
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise ConnectorRuntimeError(
            f"Git could not provide connector runtime provenance: {detail or 'command failed.'}"
        )
    return completed.stdout


def resolve_commit(source_root: Path, revision: str) -> str:
    """Resolve a revision to one exact commit object SHA."""
    if not revision or "\0" in revision:
        raise ConnectorRuntimeError("The connector runtime revision is empty or unsafe.")
    output = _run_git(
        source_root,
        "rev-parse",
        "--verify",
        "--end-of-options",
        f"{revision}^{{commit}}",
    )
    resolved = output.decode("ascii", errors="strict").strip().lower()
    if not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", resolved):
        raise ConnectorRuntimeError("Git returned an invalid connector runtime commit SHA.")
    return resolved


def _commit_script_entries(source_root: Path, commit_sha: str) -> list[CommitScriptEntry]:
    raw_tree = _run_git(
        source_root,
        "ls-tree",
        "-r",
        "-z",
        "--full-tree",
        commit_sha,
        "--",
        "scripts",
    )
    entries: list[CommitScriptEntry] = []
    seen: set[str] = set()
    for raw_entry in raw_tree.split(b"\0"):
        if not raw_entry:
            continue
        metadata, separator, raw_path = raw_entry.partition(b"\t")
        fields = metadata.split()
        if not separator or len(fields) != 3:
            raise ConnectorRuntimeError("Git returned a malformed connector runtime tree entry.")
        mode_text, object_type, object_id = fields
        try:
            relative = _safe_script_path(raw_path.decode("utf-8", errors="strict"))
            object_id_text = object_id.decode("ascii", errors="strict").lower()
        except UnicodeError as error:
            raise ConnectorRuntimeError("Git returned a non-text connector runtime tree entry.") from error
        relative_text = str(relative)
        if relative_text in seen:
            raise ConnectorRuntimeError(f"Duplicate connector runtime commit path: {relative_text}")
        seen.add(relative_text)
        if object_type != b"blob" or mode_text not in {b"100644", b"100755"}:
            raise ConnectorRuntimeError(
                f"Connector runtime commit entry is not a regular file: {relative_text}"
            )
        if not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", object_id_text):
            raise ConnectorRuntimeError(f"Connector runtime Git object is invalid: {relative_text}")
        entries.append(
            CommitScriptEntry(
                path=relative,
                object_id=object_id_text,
                mode=0o555 if mode_text == b"100755" else 0o444,
            )
        )
    entries.sort(key=lambda entry: str(entry.path))
    if not entries:
        raise ConnectorRuntimeError("The source commit contains no connector runtime files.")
    missing = sorted(REQUIRED_RUNTIME_FILES - {str(entry.path) for entry in entries})
    if missing:
        raise ConnectorRuntimeError(
            "The source commit is missing required connector runtime files: " + ", ".join(missing)
        )
    return entries


def materialize_runtime(source_root: Path, destination: Path, revision: str) -> ConnectorRuntimeVerification:
    """Copy one commit's scripts into a symlink-free, read-only runtime snapshot."""
    expanded_source = source_root.expanduser()
    if expanded_source.is_symlink():
        raise ConnectorRuntimeError(f"The connector runtime source must not be a symlink: {expanded_source}")
    source_root = expanded_source.resolve(strict=True)
    destination = destination.expanduser()
    commit_sha = resolve_commit(source_root, revision)
    commit_entries = _commit_script_entries(source_root, commit_sha)
    if destination.is_symlink():
        raise ConnectorRuntimeError(f"The connector runtime destination must not be a symlink: {destination}")
    destination.mkdir(parents=True, exist_ok=True)
    if any(destination.iterdir()):
        raise ConnectorRuntimeError(f"The connector runtime destination is not empty: {destination}")

    file_entries: list[dict[str, object]] = []
    for commit_entry in commit_entries:
        destination_file = destination.joinpath(*commit_entry.path.parts)
        destination_file.parent.mkdir(parents=True, exist_ok=True)
        destination_file.write_bytes(
            _run_git(source_root, "cat-file", "blob", commit_entry.object_id)
        )
        file_entries.append(
            {
                "path": str(commit_entry.path),
                "sha256": _sha256(destination_file),
                "size": destination_file.stat().st_size,
                "mode": f"{commit_entry.mode:04o}",
            }
        )

    manifest_path = destination / MANIFEST_NAME
    manifest = {
        "schemaVersion": MANIFEST_SCHEMA_VERSION,
        "kind": MANIFEST_KIND,
        "sourceRevision": commit_sha,
        "files": file_entries,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    for entry in file_entries:
        destination_file = destination.joinpath(*PurePosixPath(str(entry["path"])).parts)
        destination_file.chmod(int(str(entry["mode"]), 8))
    manifest_path.chmod(0o444)
    directories = sorted(
        (item for item in destination.rglob("*") if item.is_dir()),
        key=lambda item: len(item.parts),
        reverse=True,
    )
    for directory in directories:
        directory.chmod(0o555)
    destination.chmod(0o555)
    return validate_runtime(destination)


def validate_runtime(runtime_root: Path) -> ConnectorRuntimeVerification:
    """Verify manifest coverage, hashes, modes, and absence of runtime symlinks."""
    expanded_root = runtime_root.expanduser()
    if expanded_root.is_symlink():
        raise ConnectorRuntimeError(f"The connector runtime root must not be a symlink: {expanded_root}")
    try:
        runtime_root = expanded_root.resolve(strict=True)
    except FileNotFoundError as error:
        raise ConnectorRuntimeError(f"The connector runtime root is missing: {expanded_root}") from error
    if not runtime_root.is_dir():
        raise ConnectorRuntimeError(f"The connector runtime root is not a directory: {runtime_root}")

    manifest_path = runtime_root / MANIFEST_NAME
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ConnectorRuntimeError(f"The connector runtime manifest is missing or unsafe: {manifest_path}")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ConnectorRuntimeError(f"The connector runtime manifest is unreadable: {error}") from error
    if manifest.get("schemaVersion") != MANIFEST_SCHEMA_VERSION or manifest.get("kind") != MANIFEST_KIND:
        raise ConnectorRuntimeError("The connector runtime manifest schema or kind is unsupported.")
    revision = str(manifest.get("sourceRevision") or "")
    if not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", revision):
        raise ConnectorRuntimeError("The connector runtime manifest does not name an exact commit SHA.")
    raw_entries = manifest.get("files")
    if not isinstance(raw_entries, list) or not raw_entries:
        raise ConnectorRuntimeError("The connector runtime manifest contains no files.")

    expected_paths: set[str] = set()
    for raw_entry in raw_entries:
        if not isinstance(raw_entry, dict):
            raise ConnectorRuntimeError("The connector runtime manifest contains an invalid file entry.")
        relative = _safe_script_path(raw_entry.get("path"))
        relative_text = str(relative)
        if relative_text in expected_paths:
            raise ConnectorRuntimeError(f"Duplicate connector runtime manifest path: {relative_text}")
        expected_paths.add(relative_text)
        file_path = runtime_root.joinpath(*relative.parts)
        if file_path.is_symlink() or not file_path.is_file():
            raise ConnectorRuntimeError(f"Connector runtime file is missing or unsafe: {relative_text}")
        mode_text = str(raw_entry.get("mode") or "")
        if mode_text not in {"0444", "0555"}:
            raise ConnectorRuntimeError(f"Connector runtime manifest mode is invalid: {relative_text}")
        actual_stat = file_path.stat(follow_symlinks=False)
        if stat.S_IMODE(actual_stat.st_mode) != int(mode_text, 8):
            raise ConnectorRuntimeError(f"Connector runtime file mode changed: {relative_text}")
        if actual_stat.st_size != raw_entry.get("size"):
            raise ConnectorRuntimeError(f"Connector runtime file size changed: {relative_text}")
        expected_sha256 = str(raw_entry.get("sha256") or "").lower()
        if not re.fullmatch(r"[0-9a-f]{64}", expected_sha256) or _sha256(file_path) != expected_sha256:
            raise ConnectorRuntimeError(f"Connector runtime file checksum changed: {relative_text}")

    missing = sorted(REQUIRED_RUNTIME_FILES - expected_paths)
    if missing:
        raise ConnectorRuntimeError(
            "The connector runtime manifest omits required files: " + ", ".join(missing)
        )
    scripts_root = runtime_root / "scripts"
    if scripts_root.is_symlink() or not scripts_root.is_dir():
        raise ConnectorRuntimeError("The connector runtime scripts directory is missing or unsafe.")
    if stat.S_IMODE(scripts_root.stat(follow_symlinks=False).st_mode) != 0o555:
        raise ConnectorRuntimeError("The connector runtime scripts directory mode changed.")
    actual_paths: set[str] = set()
    for item in scripts_root.rglob("*"):
        if item.is_symlink():
            raise ConnectorRuntimeError(f"Connector runtime contains a symlink: {item.relative_to(runtime_root)}")
        if item.is_dir():
            if stat.S_IMODE(item.stat(follow_symlinks=False).st_mode) != 0o555:
                raise ConnectorRuntimeError(f"Connector runtime directory mode changed: {item.relative_to(runtime_root)}")
            continue
        if not item.is_file():
            raise ConnectorRuntimeError(f"Connector runtime contains a non-regular entry: {item.relative_to(runtime_root)}")
        actual_paths.add(item.relative_to(runtime_root).as_posix())
    unexpected = sorted(actual_paths - expected_paths)
    if unexpected:
        raise ConnectorRuntimeError(
            "The connector runtime contains unmanifested files: " + ", ".join(unexpected)
        )
    if stat.S_IMODE(runtime_root.stat(follow_symlinks=False).st_mode) != 0o555:
        raise ConnectorRuntimeError("The connector runtime root mode changed.")
    if stat.S_IMODE(manifest_path.stat(follow_symlinks=False).st_mode) != 0o444:
        raise ConnectorRuntimeError("The connector runtime manifest mode changed.")

    return ConnectorRuntimeVerification(
        revision=revision,
        file_count=len(expected_paths),
        manifest_sha256=_sha256(manifest_path),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    materialize = subparsers.add_parser("materialize", help="Create a read-only runtime snapshot.")
    materialize.add_argument("--source", type=Path, required=True)
    materialize.add_argument("--destination", type=Path, required=True)
    materialize.add_argument("--revision", required=True)
    verify = subparsers.add_parser("verify", help="Verify an existing runtime snapshot.")
    verify.add_argument("--runtime", type=Path, required=True)
    args = parser.parse_args()

    try:
        result = (
            materialize_runtime(args.source, args.destination, args.revision)
            if args.command == "materialize"
            else validate_runtime(args.runtime)
        )
    except ConnectorRuntimeError as error:
        parser.error(str(error))
    print(
        json.dumps(
            {
                "ok": True,
                "revision": result.revision,
                "fileCount": result.file_count,
                "manifestSHA256": result.manifest_sha256,
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
