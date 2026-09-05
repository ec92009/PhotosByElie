#!/usr/bin/env python3
"""Exercise signed-runtime preview dependencies using disposable synthetic media."""
from pathlib import Path
import tempfile

import backstage_photos_job  # Loads only the fixed sealed dependency directory.
from PIL import Image
from sidecar_state_db import _prepare_upload_bridge_artifact


def main():
    with tempfile.TemporaryDirectory(prefix="backstage-preview-smoke-") as temporary:
        root = Path(temporary)
        source = root / "synthetic.jpg"
        Image.new("RGB", (2000, 1400), (75, 120, 160)).save(source)
        for maximum in (900, 1800):
            output, mime = _prepare_upload_bridge_artifact(
                export_path=source,
                planned_key={"kind": "public-preview", "key": f"synthetic_{maximum}.jpg"},
                media_type="photo", artifact_root=root / "output",
            )
            with Image.open(output) as preview:
                assert preview.width == maximum and mime == "image/jpeg"
                assert any(low != high for low, high in preview.getextrema()), "Watermark is missing"
    print("Isolated signed-runtime preview smoke passed: 900px and 1800px watermarked JPEGs.")


if __name__ == "__main__":
    main()
