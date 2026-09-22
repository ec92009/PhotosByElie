"""Bounded OpenAI image editing transport; credentials and image bytes never log."""
from __future__ import annotations

import base64
import io
import json
import os
from pathlib import Path
import subprocess
import urllib.error
import urllib.request
import uuid

MODEL = "gpt-image-2.5-sunburst"
KEYCHAIN_SERVICE = "PhotosByElie OpenAI Image API"
MAX_IMAGE_BYTES = 32 * 1024 * 1024


def api_key() -> str:
    """Use the process credential or the personal app's existing Keychain entry."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        result = subprocess.run(
            ["/usr/bin/security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"],
            capture_output=True, text=True, timeout=10, check=False,
        )
        key = result.stdout.strip() if result.returncode == 0 else ""
    if not key:
        raise ValueError("OpenAI image credential is missing from Keychain.")
    return key


def configuration() -> dict:
    try:
        api_key()
        return {"configured": True, "model": MODEL, "message": "OpenAI visual editing is ready."}
    except (ValueError, subprocess.SubprocessError):
        return {"configured": False, "model": MODEL,
                "message": "Configure the OpenAI image credential in Keychain to generate visual drafts."}


def image_dimensions(data: bytes) -> tuple[int, int]:
    """Decode fully before accepting an artifact, with a bounded pixel budget."""
    from PIL import Image
    with Image.open(io.BytesIO(data)) as image:
        if image.width * image.height > 20_000_000 or min(image.size) < 256:
            raise ValueError("Visual image dimensions are outside the supported range.")
        image.load()
        return image.size


def edit_image(before: Path, categories: list[str], *, note: str = "") -> tuple[bytes, dict]:
    """One provider attempt, with no automatic retries that could duplicate charges."""
    payload = before.read_bytes()
    if len(payload) > 8 * 1024 * 1024:
        raise ValueError("The visual input exceeds the bounded preview size.")
    width, height = image_dimensions(payload)
    scale = 1536 / max(width, height)
    size = f"{max(256, round(width * scale / 16) * 16)}x{max(256, round(height * scale / 16) * 16)}"
    instructions = {
        "lighting-exposure": "Correct exposure and recover natural-looking tonal detail.",
        "contrast": "Correct contrast gently while retaining realistic tonal detail.",
        "white-balance-color": "Correct white balance and color casts naturally.",
        "perspective-geometry": "Correct lens distortion and leaning verticals conservatively.",
        "distracting-items": "Remove only small temporary clutter; retain permanent fixtures, appliances and furniture.",
    }
    prompt = " ".join([
        "Edit this exact real-estate photograph into a photorealistic repair draft.",
        "Keep the same property, viewpoint, framing and aspect ratio. Do not invent or remove architectural features,",
        "windows, doors, permanent fixtures, appliances or structural defects. Do not add decoration, people or text.",
        "Evaluate every requested category, correcting only what needs repair.",
        "Make only these owner-requested corrections:",
        *(instructions[category] for category in categories),
    ])
    if note.strip():
        prompt += " Owner instructions for this photo: " + note.strip()
    boundary = "pbe-" + uuid.uuid4().hex
    body = bytearray()
    fields = {"model": MODEL, "prompt": prompt, "n": "1", "quality": "medium",
              "size": size, "output_format": "png"}
    for name, value in fields.items():
        body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode())
    body.extend(f'--{boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="before.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode())
    body.extend(payload)
    body.extend(f'\r\n--{boundary}--\r\n'.encode())

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError("OpenAI image request redirect refused.")

    request = urllib.request.Request("https://api.openai.com/v1/images/edits", data=bytes(body),
        headers={"Authorization": "Bearer " + api_key(),
                 "Content-Type": "multipart/form-data; boundary=" + boundary})
    try:
        with urllib.request.build_opener(NoRedirect).open(request, timeout=300) as response:
            raw = response.read(MAX_IMAGE_BYTES * 2 + 1)
            if len(raw) > MAX_IMAGE_BYTES * 2:
                raise ValueError("OpenAI image response exceeded its size limit.")
            result = json.loads(raw)
            request_id = response.headers.get("x-request-id", "")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"OpenAI image request failed (HTTP {error.code}); check account access or quota before retrying.") from None
    except (urllib.error.URLError, TimeoutError):
        raise RuntimeError("OpenAI image request timed out or disconnected. Its outcome is uncertain; no automatic retry was made.") from None
    items = result.get("data") or []
    if len(items) != 1 or not items[0].get("b64_json"):
        raise ValueError("OpenAI returned no single rendered visual draft.")
    rendered = base64.b64decode(items[0]["b64_json"], validate=True)
    if len(rendered) > MAX_IMAGE_BYTES or not rendered.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("OpenAI returned an unsupported visual image.")
    out_width, out_height = image_dimensions(rendered)
    return rendered, {"provider": "openai", "model": MODEL, "requestId": request_id,
                      "quality": "medium", "pixelWidth": out_width, "pixelHeight": out_height,
                      "usage": result.get("usage", {})}
