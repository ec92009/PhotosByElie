#!/usr/bin/env python3
"""Import, publish, and optionally upload configured Real Estate client media."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from local_server import (
    _real_estate_paths,
    _sanitize_real_estate_public_manifest,
    _write_real_estate_app_context,
)


REPO_ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = Path("assets/owner-actions/real-estate-clients.local.json")
IMPORT_ROOT = Path("tmp/real-estate-import")
SOURCE_ROOT = Path("/Volumes/Saturn/Pictures/RE")
MEDIA_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".heic", ".mov", ".mp4", ".m4v"}


def emit(kind: str, **payload: Any) -> None:
    print(f"PBE_RE_{kind} {json.dumps(payload, sort_keys=True)}", flush=True)


def slugify(value: str, fallback: str = "client") -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").casefold()).strip("-")
    return slug or fallback


def key_prefix(value: str) -> str:
    return re.sub(r"/+", "/", str(value or "").strip().strip("/"))


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def configured_state() -> dict[str, Any]:
    state = read_json(REPO_ROOT / CONFIG_PATH, {})
    if not isinstance(state, dict):
        state = {}
    clients = state.get("clients")
    if not isinstance(clients, list):
        state["clients"] = []
    return state


def convention_fields(customer: str) -> dict[str, str]:
    name = str(customer or "").strip()
    slug = slugify(name)
    return {
        "id": slug,
        "username": name,
        "sourceRoot": str(SOURCE_ROOT / name) if name else "",
        "outputSlug": slug,
        "publicSlug": slug,
        "galleryKey": f"{name}-gallery" if name else "",
        "galleryTitle": name,
        "publicKeyPrefix": key_prefix(f"RE/{name}/previews") if name else "",
        "privateKeyPrefix": key_prefix(f"RE/{name}/masters") if name else "",
    }


def normalized_client(raw_client: dict[str, Any]) -> dict[str, Any]:
    client = dict(raw_client)
    customer = str(client.get("customer") or client.get("name") or client.get("username") or client.get("id") or "").strip()
    convention = convention_fields(customer)
    for key, value in convention.items():
        client[key] = str(client.get(key) or value).strip()
    client["customer"] = customer
    client["email"] = str(client.get("email") or "").strip()
    client["accessCode"] = str(client.get("accessCode") or "").strip()
    if not str(client.get("accessCodeSalt") or "").strip():
        client["accessCodeSalt"] = uuid.uuid4().hex
    properties = client.get("properties")
    client["properties"] = [str(item).strip() for item in properties if str(item).strip()] if isinstance(properties, list) else []
    return client


def media_count(root: Path) -> int:
    if not root.is_dir():
        return 0
    return sum(1 for path in root.rglob("*") if path.is_file() and path.suffix.lower() in MEDIA_EXTENSIONS)


def property_names(client: dict[str, Any]) -> tuple[list[str], list[str]]:
    source_root = Path(str(client.get("sourceRoot") or "")).expanduser()
    configured = [str(item).strip() for item in client.get("properties") or [] if str(item).strip()]
    if configured:
        available = [name for name in configured if (source_root / name).is_dir()]
        missing = [name for name in configured if name not in available]
        return available, missing
    if not source_root.is_dir():
        return [], []
    return sorted(path.name for path in source_root.iterdir() if path.is_dir()), []


def run_streamed(command: list[str], env: dict[str, str] | None = None, on_line=None) -> tuple[int, str]:
    process = subprocess.Popen(
        command,
        cwd=REPO_ROOT,
        env={**os.environ, **(env or {})},
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=1,
    )
    output_lines: list[str] = []
    assert process.stdout is not None
    for line in process.stdout:
        line = line.rstrip("\n")
        output_lines.append(line)
        print(line, flush=True)
        if on_line:
            on_line(line)
    return process.wait(), "\n".join(output_lines)


def run_captured(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, cwd=REPO_ROOT, text=True, capture_output=True, check=False)


def import_client(client: dict[str, Any], properties: list[str], force: bool) -> dict[str, Any]:
    source_root = Path(str(client.get("sourceRoot") or "")).expanduser()
    command = [
        sys.executable,
        "-u",
        "scripts/import_real_estate_gallery.py",
        "--source-root",
        str(source_root),
        "--output-root",
        IMPORT_ROOT.as_posix(),
        "--customer",
        str(client.get("customer") or ""),
        "--username",
        str(client.get("username") or client.get("customer") or ""),
        "--email",
        str(client.get("email") or ""),
        "--access-code-env",
        "PBE_REAL_ESTATE_ACCESS_CODE",
        "--access-code-salt",
        str(client.get("accessCodeSalt") or ""),
        "--gallery-key",
        str(client.get("galleryKey") or ""),
        "--gallery-title",
        str(client.get("galleryTitle") or ""),
        "--public-key-prefix",
        str(client.get("publicKeyPrefix") or ""),
        "--private-key-prefix",
        str(client.get("privateKeyPrefix") or ""),
        "--progress-json",
    ]
    for property_name in properties:
        command.extend(["--album", property_name])
    if force:
        command.append("--force")
    exit_code, output = run_streamed(command, {"PBE_REAL_ESTATE_ACCESS_CODE": str(client.get("accessCode") or "")})
    if exit_code:
        raise RuntimeError(output.splitlines()[-1] if output.strip() else "real-estate import failed")
    manifest_path = REPO_ROOT / IMPORT_ROOT / slugify(str(client.get("customer") or "")) / "manifest.json"
    manifest = read_json(manifest_path, {})
    stats = manifest.get("stats") if isinstance(manifest, dict) else {}
    return {
        "manifestPath": manifest_path,
        "media": int(stats.get("photoCount") or 0) if isinstance(stats, dict) else 0,
    }


def publish_client(client: dict[str, Any], manifest_path: Path) -> Path:
    manifest = read_json(manifest_path, {})
    if not isinstance(manifest, dict):
        raise RuntimeError(f"manifest is not readable: {manifest_path}")
    paths = _real_estate_paths(REPO_ROOT, client)
    paths["public_dir"].mkdir(parents=True, exist_ok=True)
    _write_real_estate_app_context(_sanitize_real_estate_public_manifest(manifest), paths["public_context"])
    return paths["public_context"]


def upload_summary(manifest_path: Path, scope: str, workers: int, backend: str) -> dict[str, Any]:
    command = [
        sys.executable,
        "scripts/upload_real_estate_media.py",
        "--manifest",
        str(manifest_path.relative_to(REPO_ROOT)),
        "--scope",
        scope,
        "--workers",
        str(workers),
        "--backend",
        backend,
        "--json",
    ]
    result = run_captured(command)
    if result.returncode:
        raise RuntimeError((result.stdout or result.stderr).strip() or "real-estate upload dry-run failed")
    return json.loads(result.stdout or "{}")


def upload_client(client: dict[str, Any], manifest_path: Path, scope: str, workers: int, backend: str, upload: bool) -> dict[str, Any]:
    summary = upload_summary(manifest_path, scope, workers, backend)
    emit(
        "UPLOAD_START",
        client=str(client.get("customer") or ""),
        total=int(summary.get("items") or 0),
        alreadyUploaded=int(summary.get("alreadyUploaded") or 0),
    )
    if not upload:
        return summary
    command = [
        sys.executable,
        "-u",
        "scripts/upload_real_estate_media.py",
        "--manifest",
        str(manifest_path.relative_to(REPO_ROOT)),
        "--scope",
        scope,
        "--workers",
        str(workers),
        "--backend",
        backend,
        "--upload",
    ]
    def emit_upload_progress(line: str) -> None:
        match = re.match(r"progress\s+([0-9,]+)/([0-9,]+)\s+failed=([0-9,]+)\s+uploaded=([0-9.]+)\s+MiB", line)
        if match:
            emit(
                "UPLOAD_PROGRESS",
                client=str(client.get("customer") or ""),
                completed=int(match.group(1).replace(",", "")),
                total=int(match.group(2).replace(",", "")),
                failed=int(match.group(3).replace(",", "")),
                uploadedMiB=float(match.group(4)),
            )
    exit_code, output = run_streamed(command, on_line=emit_upload_progress)
    if exit_code:
        raise RuntimeError(output.splitlines()[-1] if output.strip() else "real-estate upload failed")
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync configured Real Estate clients into local/public bundles and R2.")
    parser.add_argument("--client", action="append", default=[], help="Client id/name to sync. Repeatable.")
    parser.add_argument("--scope", choices=("public", "private", "both"), default="both")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--backend", choices=("wrangler", "s3"), default=os.environ.get("PBE_R2_BACKEND", "wrangler"))
    parser.add_argument("--upload", action="store_true", help="Actually upload Real Estate media to R2.")
    parser.add_argument("--publish", action="store_true", help="Refresh tracked public app-context bundles.")
    parser.add_argument("--force", action="store_true", help="Re-render existing Real Estate previews.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    state = configured_state()
    requested = {slugify(value) for value in args.client}
    all_clients = [normalized_client(client) for client in state.get("clients", []) if isinstance(client, dict)]
    clients = list(all_clients)
    if requested:
        clients = [client for client in clients if slugify(str(client.get("id") or client.get("customer") or "")) in requested]

    changed_config = False
    completed_clients = 0
    imported_media = 0
    uploaded_items = 0
    skipped_clients = 0
    emit("START", clients=len(clients), upload=bool(args.upload), publish=bool(args.publish), scope=args.scope)
    for index, client in enumerate(clients, start=1):
        customer = str(client.get("customer") or client.get("id") or "").strip()
        source_root = Path(str(client.get("sourceRoot") or "")).expanduser()
        properties, missing_properties = property_names(client)
        total_media = sum(media_count(source_root / property_name) for property_name in properties)
        emit(
            "CLIENT_START",
            index=index,
            totalClients=len(clients),
            client=customer,
            properties=len(properties),
            missingProperties=missing_properties,
            media=total_media,
        )
        if not customer or not source_root.is_dir() or not client.get("accessCode") or not properties:
            skipped_clients += 1
            emit("CLIENT_SKIPPED", client=customer, reason="missing source, password, or property media")
            continue
        before_salt = str(client.get("accessCodeSalt") or "")
        try:
            imported = import_client(client, properties, bool(args.force))
            imported_media += int(imported.get("media") or 0)
            public_context = ""
            if args.publish:
                public_context = str(publish_client(client, imported["manifestPath"]).relative_to(REPO_ROOT))
                emit("PUBLISH_DONE", client=customer, path=public_context)
            summary = upload_client(client, imported["manifestPath"], args.scope, args.workers, args.backend, bool(args.upload))
            uploaded_items += int(summary.get("items") or 0)
            client["lastImportedAt"] = datetime.now(timezone.utc).isoformat()
            if args.upload:
                client["lastUploadAt"] = datetime.now(timezone.utc).isoformat()
            completed_clients += 1
            emit(
                "CLIENT_DONE",
                index=index,
                totalClients=len(clients),
                client=customer,
                media=int(imported.get("media") or 0),
                uploadItems=int(summary.get("items") or 0),
                publicContext=public_context,
            )
        except Exception as error:
            skipped_clients += 1
            emit("CLIENT_FAILED", client=customer, error=str(error))
            return 1
        changed_config = changed_config or before_salt != str(client.get("accessCodeSalt") or "")

    if clients:
        by_id = {str(client.get("id") or slugify(str(client.get("customer") or ""))): client for client in all_clients}
        for client in clients:
            by_id[str(client.get("id") or slugify(str(client.get("customer") or "")))] = client
        state["clients"] = sorted(by_id.values(), key=lambda item: str(item.get("customer") or item.get("id")))
        if changed_config or completed_clients:
            state["updated_at"] = datetime.now(timezone.utc).isoformat()
            write_json(REPO_ROOT / CONFIG_PATH, state)
    emit("DONE", clients=completed_clients, skipped=skipped_clients, importedMedia=imported_media, uploadItems=uploaded_items)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
