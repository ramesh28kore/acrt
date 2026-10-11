"""Course images: mapping source URLs to mirrored files, and downloading them safely.

The mirrored files live in public/content/images and are referenced as /content/images/<name>. The naming rule is the
previous importer's (`local_name`), and the app's own resolver uses the same rule, so a filename collision between two
different source URLs is an error rather than a silent rename.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import pathlib
import re
import shutil
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from urllib.parse import urlparse

from .config import IMAGE_DIR, IMAGE_URL_PREFIX, MANIFEST_PATH

URL_RE = re.compile(r"""https?://[^\s"'()<>\\]+?\.(?:png|jpe?g|gif|svg|webp)""", re.I)
SOURCES = (("statements_html", "*.html"), ("mcq_json", "*.json"), ("html", "*.html"))
USER_AGENT = "avanthi-portal-content-mirror/2.0"
TIMEOUT_S = 30
MAX_BYTES = 5 * 1024 * 1024
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
)


class ImageError(Exception):
    pass


def is_content_image(url: str) -> bool:
    """True for course figures; false for the source platform's logos, badges and avatars."""
    u = (url or "").lower()
    return "/frontend/content/" in u or "card-notes-attachment" in u


def local_name(url: str) -> str:
    base = url.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1]
    return re.sub(r"[^a-z0-9._-]+", "-", base.lower()).strip("-.") or "image.png"


def sniff(data: bytes) -> str | None:
    for prefix, mime in MAGIC:
        if data.startswith(prefix):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def load_manifest(path: pathlib.Path = MANIFEST_PATH) -> dict[str, dict]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("images", {})


def save_manifest(images: dict[str, dict], path: pathlib.Path = MANIFEST_PATH) -> None:
    body = {"version": 1, "images": dict(sorted(images.items()))}
    path.write_text(json.dumps(body, indent=1, sort_keys=True) + "\n", encoding="utf-8")


@dataclass
class ImageResolver:
    """Rewrites a source image URL to the stored path, or None when it was never mirrored."""

    manifest: dict[str, dict] = field(default_factory=load_manifest)
    image_dir: pathlib.Path = IMAGE_DIR
    unmirrored: set[str] = field(default_factory=set)
    used: set[str] = field(default_factory=set)

    @property
    def ready(self) -> bool:
        return bool(self.manifest)

    def __call__(self, url: str) -> str | None:
        url = (url or "").strip()
        entry = self.manifest.get(url)
        if entry and (self.image_dir / entry["file"]).exists():
            self.used.add(entry["file"])
            return f"{IMAGE_URL_PREFIX}{entry['file']}"
        self.unmirrored.add(url)
        return None


MARKDOWN_IMAGE_RE = re.compile(r"(!\[[^\]]*\]\()([^)\s]+)(\))")


def rewrite_markdown_images(text: str, resolve: ImageResolver) -> str:
    """Point each `![alt](url)` at the mirrored file; a reference that cannot be mirrored is removed."""

    def repl(match: re.Match[str]) -> str:
        url = match.group(2)
        if not is_content_image(url):
            return match.group(0)
        local = resolve(url)
        return f"{match.group(1)}{local}{match.group(3)}" if local else ""

    return MARKDOWN_IMAGE_RE.sub(repl, text or "")


def discover(scraper_dir: pathlib.Path) -> tuple[dict[str, str], list[str]]:
    """url -> local filename for every course image the export references, plus warnings."""
    urls: set[str] = set()
    warnings: list[str] = []
    for sub, pattern in SOURCES:
        directory = scraper_dir / sub
        if not directory.exists():
            warnings.append(f"{directory} not found, skipped")
            continue
        for path in sorted(directory.glob(pattern)):
            text = path.read_text(encoding="utf-8", errors="replace")
            urls.update(m.strip() for m in URL_RE.findall(text) if is_content_image(m))

    mapping: dict[str, str] = {}
    taken: dict[str, str] = {}
    for url in sorted(urls):
        name = local_name(url)
        if name in taken and taken[name] != url:
            raise ImageError(f"two different images share the filename {name!r}: {taken[name]} and {url}")
        taken[name] = url
        mapping[url] = name
    return mapping, warnings


def _public_address(host: str) -> bool:
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            return False
    return bool(infos)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # a redirect could leave the allowlist
        return None


def fetch(
    url: str,
    hosts: tuple[str, ...],
    *,
    allow_private: bool = False,
    opener: urllib.request.OpenerDirector | None = None,
) -> tuple[bytes, str]:
    """Download one image. Raises ImageError with the reason; returns (bytes, mime)."""
    parsed = urlparse(url)
    if parsed.scheme != "https" and not (allow_private and parsed.scheme == "http"):
        raise ImageError("only https images are fetched")
    host = (parsed.hostname or "").lower()
    if host not in hosts:
        raise ImageError(f"host {host or '?'} is not in the image allowlist")
    if not allow_private and not _public_address(host):
        raise ImageError(f"host {host} does not resolve to a public address")

    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    opener = opener or urllib.request.build_opener(_NoRedirect)
    try:
        with opener.open(request, timeout=TIMEOUT_S) as response:
            declared = (response.headers.get_content_type() or "").lower()
            length = response.headers.get("Content-Length")
            if length and length.isdigit() and int(length) > MAX_BYTES:
                raise ImageError(f"declared size {length} exceeds {MAX_BYTES} bytes")
            data = response.read(MAX_BYTES + 1)
    except urllib.error.HTTPError as exc:
        raise ImageError(f"HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ImageError(f"network error: {exc}") from exc

    if len(data) > MAX_BYTES:
        raise ImageError(f"larger than {MAX_BYTES} bytes")
    if declared not in ALLOWED_TYPES:
        raise ImageError(f"content type {declared or '?'} is not an allowed image type")
    mime = sniff(data)
    if mime is None:
        raise ImageError("file contents are not a PNG, JPEG, GIF or WebP image")
    return data, mime


@dataclass
class MirrorResult:
    fetched: list[str] = field(default_factory=list)
    present: list[str] = field(default_factory=list)
    failed: list[tuple[str, str]] = field(default_factory=list)
    missing: list[str] = field(default_factory=list)  # dry run only


def mirror(
    scraper_dir: pathlib.Path,
    hosts: tuple[str, ...],
    *,
    apply: bool,
    image_dir: pathlib.Path = IMAGE_DIR,
    manifest_path: pathlib.Path = MANIFEST_PATH,
    force: bool = False,
    allow_private: bool = False,
    opener: urllib.request.OpenerDirector | None = None,
) -> MirrorResult:
    """Make every referenced course image exist locally and record it, with its hash, in the manifest."""
    mapping, _ = discover(scraper_dir)
    manifest = load_manifest(manifest_path)
    result = MirrorResult()

    for url, name in sorted(mapping.items(), key=lambda kv: kv[1]):
        dest = image_dir / name
        if dest.exists() and not force:
            data = dest.read_bytes()
            result.present.append(name)
            if apply and url not in manifest:
                manifest[url] = {"file": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
            continue
        if not apply:
            result.missing.append(name)
            continue
        try:
            data, _mime = fetch(url, hosts, allow_private=allow_private, opener=opener)
        except ImageError as exc:
            result.failed.append((url, str(exc)))
            continue
        image_dir.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        tmp.write_bytes(data)
        tmp.replace(dest)
        manifest[url] = {"file": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
        result.fetched.append(name)

    if apply:
        image_dir.mkdir(parents=True, exist_ok=True)
        save_manifest({u: e for u, e in manifest.items() if (image_dir / e["file"]).exists()}, manifest_path)
    return result


def seed_from(
    source_dir: pathlib.Path,
    source_manifest: pathlib.Path,
    *,
    image_dir: pathlib.Path = IMAGE_DIR,
    manifest_path: pathlib.Path = MANIFEST_PATH,
) -> tuple[int, int, list[str]]:
    """Reuse images another checkout already mirrored: copy files that are valid images and record their hashes.

    Existing files are never overwritten. Returns (copied, already_present, rejected_names).
    """
    legacy = json.loads(source_manifest.read_text(encoding="utf-8"))
    manifest = load_manifest(manifest_path)
    image_dir.mkdir(parents=True, exist_ok=True)
    copied = present = 0
    rejected: list[str] = []
    for url, name in legacy.items():
        if local_name(url) != name:
            rejected.append(name)
            continue
        src = source_dir / name
        if not src.is_file():
            rejected.append(name)
            continue
        data = src.read_bytes()
        if len(data) > MAX_BYTES or sniff(data) is None:
            rejected.append(name)
            continue
        dest = image_dir / name
        if dest.exists():
            present += 1
        else:
            shutil.copyfile(src, dest)
            copied += 1
        manifest[url] = {"file": name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}
    save_manifest(manifest, manifest_path)
    return copied, present, rejected
