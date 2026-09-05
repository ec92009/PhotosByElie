"""Transport and public-static boundaries for retained local HTTP helpers."""
from __future__ import annotations

from http import HTTPStatus
import ipaddress
from pathlib import Path
from urllib.parse import urlsplit

try:
    from .prepare_cloudflare_static_prototype import FORBIDDEN_PARTS, PUBLIC_FILES, PUBLIC_TREES, ROOT_FILES
except ImportError:
    from prepare_cloudflare_static_prototype import FORBIDDEN_PARTS, PUBLIC_FILES, PUBLIC_TREES, ROOT_FILES

WEB_BUNDLE_FILES = {
    line.strip() for line in Path(__file__).with_name("pbe_owner_web_bundle_paths.txt").read_text().splitlines()
    if line.strip() and not line.startswith("#") and not line.startswith(":")
}

# Customer pages beyond the bounded static prototype use the same public boundary.
CUSTOMER_FILES = {
    "index.html", "basket.html", "basket.js", "order.html", "order.js",
    "liked.html", "liked.js", "real-estate.html", "real-estate.js",
    "embedded-browser.js", "assets/pano-nerja.jpg",
}
STATIC_SUFFIXES = {".html", ".css", ".js", ".mjs", ".json", ".webmanifest", ".svg",
                   ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico",
                   ".woff", ".woff2", ".ttf", ".otf", ".mp4", ".webm"}


def valid_local_authority(authority: str, port: int, *, allow_lan: bool = False) -> bool:
    """Accept literal local authorities, never a hostname that merely resembles an IP."""
    try:
        parsed = urlsplit("http://" + authority)
        if parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            return False
        if (parsed.port or 80) != port:
            return False
        host = parsed.hostname or ""
        if host == "localhost":
            return True
        address = ipaddress.ip_address(host)
        return address.is_loopback or (allow_lan and address.is_private and not address.is_unspecified)
    except ValueError:
        return False


class LocalHttpSecurityMixin:
    """Apply checks before every verb, including inherited HEAD/static dispatch."""

    def parse_request(self) -> bool:
        if not super().parse_request():
            return False
        hosts = self.headers.get_all("Host", [])
        if len(hosts) != 1 or not valid_local_authority(
            hosts[0], self.server.server_port,
            allow_lan=bool(getattr(self.server, "allow_lan_owner", False)),
        ) or not self.path.startswith("/") or self.path.startswith("//"):
            self.send_error(HTTPStatus.FORBIDDEN, "Invalid local Host authority")
            return False
        return True

    def send_head(self):
        """Serve explicit public assets only; directories and private aliases stay closed."""
        root = Path(self.directory).resolve()
        target = Path(self.translate_path(self.path)).resolve()
        if target.is_dir():
            target = (target / "index.html").resolve()
        try:
            relative = target.relative_to(root)
        except ValueError:
            self.send_error(HTTPStatus.FORBIDDEN, "Private local file")
            return None
        parts = relative.parts
        public_file = relative.as_posix() in set(ROOT_FILES) | set(PUBLIC_FILES) | CUSTOMER_FILES | WEB_BUNDLE_FILES
        public_tree = any(relative.as_posix().startswith(tree + "/") for tree in PUBLIC_TREES)
        if (not target.is_file() or any(part.startswith(".") for part in parts)
                or FORBIDDEN_PARTS.intersection(parts)
                or not (public_file or (public_tree and target.suffix.lower() in STATIC_SUFFIXES))):
            self.send_error(HTTPStatus.FORBIDDEN, "Private local file")
            return None
        return super().send_head()
