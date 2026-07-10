#!/usr/bin/env python3
"""Background Mac connector for cloud Owner actions.

The connector does not serve a local web UI. It polls the authenticated Worker
queue, performs the small set of hardware/local-file tasks this Mac supports,
and posts results back to the cloud Owner action ledger.
"""

from __future__ import annotations

import argparse
import base64
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
import json
from pathlib import Path
import platform
import shlex
import socket
import subprocess
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen


DEFAULT_CONFIG_PATH = Path.home() / ".config" / "photosbyelie" / "connector.json"
CONNECTOR_VERSION = "1.0"
DEFAULT_INTERVAL_SECONDS = 5
MAX_PREVIEW_BYTES = 250_000


@dataclass(frozen=True)
class ConnectorConfig:
    worker_base: str
    connector_id: str
    token: str
    repo_root: Path
    interval_seconds: int = DEFAULT_INTERVAL_SECONDS


def _clean_connector_id(value: object) -> str:
    cleaned = "".join(character if character.isalnum() or character in "._-" else "-" for character in str(value or "").strip().lower())
    return cleaned.strip("-")[:80]


def load_config(path: Path) -> ConnectorConfig:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise RuntimeError(f"Connector config is missing: {path}") from error
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Connector config is unreadable: {path}: {error}") from error
    worker_base = str(payload.get("workerBase") or "").strip().rstrip("/")
    connector_id = _clean_connector_id(payload.get("connectorId"))
    token = str(payload.get("token") or "").strip()
    repo_root = Path(str(payload.get("repoRoot") or "")).expanduser().resolve()
    interval = max(2, min(300, int(payload.get("intervalSeconds") or DEFAULT_INTERVAL_SECONDS)))
    if not worker_base.startswith("https://"):
        raise RuntimeError("Connector workerBase must use HTTPS.")
    if not connector_id:
        raise RuntimeError("Connector connectorId is required.")
    if len(token) < 24:
        raise RuntimeError("Connector token is missing or too short.")
    if not (repo_root / "scripts" / "sidecar_state_db.py").exists():
        raise RuntimeError(f"PhotosByElie repoRoot is invalid: {repo_root}")
    return ConnectorConfig(worker_base, connector_id, token, repo_root, interval)


class WorkerClient:
    def __init__(self, config: ConnectorConfig):
        self.config = config

    def request(self, method: str, path: str, payload: dict | None = None) -> dict:
        data = None if payload is None else json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        request = Request(
            f"{self.config.worker_base}{path}",
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.config.token}",
                "Accept": "application/json",
                "User-Agent": f"PhotosByElie-Mac-Connector/{CONNECTOR_VERSION}",
                **({"Content-Type": "application/json"} if data is not None else {}),
            },
        )
        try:
            with urlopen(request, timeout=60) as response:
                body = json.loads(response.read().decode("utf-8") or "{}")
        except HTTPError as error:
            try:
                detail = json.loads(error.read().decode("utf-8") or "{}")
            except (json.JSONDecodeError, UnicodeDecodeError):
                detail = {}
            message = detail.get("error", {}).get("message") if isinstance(detail.get("error"), dict) else detail.get("error")
            raise RuntimeError(message or f"Worker returned HTTP {error.code} for {path}.") from error
        except (URLError, OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Worker request failed for {path}: {error}") from error
        if body.get("ok") is False or body.get("error"):
            error = body.get("error")
            message = error.get("message") if isinstance(error, dict) else str(error)
            raise RuntimeError(message or "Worker request failed.")
        return body

    def heartbeat(self) -> dict:
        return self.request("POST", "/owner/connector/heartbeat", {
            "hostname": socket.gethostname(),
            "platform": f"{platform.system()} {platform.machine()}",
            "version": CONNECTOR_VERSION,
            "capabilities": ["apple-photos", "sidecar", "owner-sqlite", "catalog-registration"],
        })

    def actions(self) -> list[dict]:
        body = self.request("GET", "/owner/connector/actions")
        return [action for action in body.get("actions", []) if isinstance(action, dict)]

    def transition(self, action_id: str, transition: str, payload: dict | None = None) -> dict:
        return self.request(
            "POST",
            f"/owner/connector/actions/{quote(action_id, safe='')}/{transition}",
            payload or {},
        )


def _load_local_modules(repo_root: Path):
    scripts_path = str(repo_root / "scripts")
    if scripts_path not in sys.path:
        sys.path.insert(0, scripts_path)
    from local_server import new_owner_connector_result, new_owner_sidecar_decision_result
    from sidecar_server import _preview_cache_path, _run_apple_photos_bridge_app_task

    return new_owner_connector_result, new_owner_sidecar_decision_result, _preview_cache_path, _run_apple_photos_bridge_app_task


def _preview_data_url(repo_root: Path, item: dict, preview_cache_path, run_bridge_task) -> tuple[str, str]:
    asset_id = str(item.get("assetId") or "").strip()
    if not asset_id:
        return "", "missing asset id"
    destination = preview_cache_path(repo_root, asset_id, 480)
    if not destination.exists():
        payload = run_bridge_task(
            repo_root,
            ["preview", "--asset-id", asset_id, "--destination", str(destination), "--max-pixel", "480"],
            timeout=90,
        )
        if not payload.get("ok"):
            return "", str(payload.get("error") or payload.get("code") or "preview unavailable")
    try:
        data = destination.read_bytes()
    except OSError as error:
        return "", str(error)
    if not data:
        return "", "preview is empty"
    if len(data) > MAX_PREVIEW_BYTES:
        return "", f"preview exceeds {MAX_PREVIEW_BYTES} bytes"
    return f"data:image/jpeg;base64,{base64.b64encode(data).decode('ascii')}", ""


def _attach_previews(repo_root: Path, items: list[dict], preview_cache_path, run_bridge_task) -> tuple[list[dict], list[dict]]:
    enriched = [dict(item) for item in items]
    errors: list[dict] = []
    # PhotoKit is permission-identity sensitive and the bridge app serializes
    # resource callbacks more reliably than several simultaneous app launches.
    worker_count = 1
    with ThreadPoolExecutor(max_workers=worker_count) as executor:
        futures = {
            executor.submit(_preview_data_url, repo_root, item, preview_cache_path, run_bridge_task): index
            for index, item in enumerate(enriched)
        }
        for future in as_completed(futures):
            index = futures[future]
            try:
                preview_url, error = future.result()
            except Exception as exception:  # noqa: BLE001 - one preview must not fail the action.
                preview_url, error = "", str(exception)
            if preview_url:
                enriched[index]["previewDataUrl"] = preview_url
            if error:
                enriched[index]["previewError"] = error
                errors.append({"assetId": enriched[index].get("assetId"), "error": error})
    return enriched, errors


def _run_repo_json(config: ConnectorConfig, arguments: list[str], timeout: int = 3600) -> dict:
    command = "cd " + shlex.quote(str(config.repo_root)) + " && " + " ".join(shlex.quote(item) for item in arguments)
    completed = subprocess.run(
        ["/bin/zsh", "-lic", command],
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    output = (completed.stdout or "").strip()
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or output or f"Command exited {completed.returncode}").strip())
    try:
        payload = json.loads(output or "{}")
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Connector command returned invalid JSON: {output[-500:]}") from error
    if payload.get("ok") is False:
        raise RuntimeError(str(payload.get("error") or payload.get("result") or "Connector command failed."))
    return payload


def _upload_and_register(config: ConnectorConfig, action: dict) -> dict:
    payload = action.get("payload") if isinstance(action.get("payload"), dict) else {}
    requested = max(1, min(24, int(payload.get("limit") or 1)))
    runs = []
    for _index in range(requested):
        run = _run_repo_json(config, [
            sys.executable,
            "scripts/sidecar_upload_bridge.py",
            "--execute",
            "--limit",
            "1",
            "--json",
        ])
        items = list(run.get("items") or [])
        if not items:
            break
        runs.append({
            "runId": run.get("runId"),
            "status": run.get("status"),
            "summary": run.get("summary") or {},
            "items": [{
                "assetId": item.get("assetId"),
                "photoId": item.get("photoId"),
                "filename": item.get("filename"),
                "status": item.get("status") or item.get("upload", {}).get("status"),
            } for item in items],
        })
        if run.get("status") == "failed":
            break
    registration = _run_repo_json(config, [
        sys.executable,
        "scripts/sidecar_maintenance.py",
        "register-uploaded-catalog",
    ])
    return {
        "connectorId": config.connector_id,
        "type": "sidecar-upload-publish",
        "requestedCount": requested,
        "runCount": len(runs),
        "runs": runs,
        "registration": registration.get("result") or {},
        "rebuild": registration.get("rebuild") or {},
        "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def execute_action(config: ConnectorConfig, action: dict) -> dict:
    action_type = str(action.get("type") or "").strip()
    if action_type == "owner-connector-check":
        return {
            "connectorId": config.connector_id,
            "type": action_type,
            "hostname": socket.gethostname(),
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    connector_result, decision_result, preview_cache_path, run_bridge_task = _load_local_modules(config.repo_root)
    if action_type == "sidecar-culling-review":
        local = connector_result(config.repo_root, {"action": action, "connectorId": config.connector_id})
        manifest = action.get("payload", {}).get("manifest", {}) if isinstance(action.get("payload"), dict) else {}
        items = list(local.get("preview", {}).get("items") or [])
        preview_errors: list[dict] = []
        if manifest.get("includePreviews", True):
            items, preview_errors = _attach_previews(
                config.repo_root,
                items,
                preview_cache_path,
                run_bridge_task,
            )
        result = dict(local.get("result") or {})
        result["previewItems"] = items
        result["stateCounts"] = list(local.get("preview", {}).get("stateCounts") or [])
        result["previewErrors"] = preview_errors
        result["readOnly"] = False
        return result
    if action_type == "sidecar-review-decision":
        payload = action.get("payload") if isinstance(action.get("payload"), dict) else {}
        decision = decision_result(config.repo_root, {
            "assetId": payload.get("assetId"),
            "action": payload.get("decision"),
            "rating": payload.get("rating"),
            "color": payload.get("color"),
            "title": payload.get("title"),
            "keywords": payload.get("keywords"),
            "metadataState": payload.get("metadataState"),
        })
        return {
            "connectorId": config.connector_id,
            "type": action_type,
            "sourceActionId": str(payload.get("sourceActionId") or ""),
            "decision": decision,
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
    if action_type == "sidecar-upload-publish":
        return _upload_and_register(config, action)
    raise RuntimeError(f"Unsupported connector action: {action_type or 'missing'}")


def process_once(config: ConnectorConfig, client: WorkerClient) -> int:
    client.heartbeat()
    processed = 0
    for action in client.actions():
        action_id = str(action.get("id") or "").strip()
        if not action_id:
            continue
        try:
            if action.get("state") == "queued":
                action = client.transition(action_id, "claim").get("action") or action
            if action.get("state") != "claimed":
                continue
            result = execute_action(config, action)
            client.transition(action_id, "complete", {"result": result})
            processed += 1
        except Exception as error:  # noqa: BLE001 - failure must be recorded in the cloud ledger.
            try:
                client.transition(action_id, "fail", {"message": str(error)[:500]})
            except Exception:
                pass
            print(f"{action_id}: {error}", file=sys.stderr, flush=True)
    return processed


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the PhotosByElie background Mac connector.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--once", action="store_true", help="Poll once and exit.")
    args = parser.parse_args()
    config = load_config(args.config.expanduser())
    client = WorkerClient(config)
    while True:
        try:
            processed = process_once(config, client)
            if processed:
                print(f"Processed {processed} Owner action(s).", flush=True)
        except Exception as error:  # noqa: BLE001 - daemon retries transient network/auth failures.
            print(str(error), file=sys.stderr, flush=True)
            if args.once:
                return 1
        if args.once:
            return 0
        time.sleep(config.interval_seconds)


if __name__ == "__main__":
    raise SystemExit(main())
