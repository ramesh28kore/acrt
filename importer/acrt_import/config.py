"""Environment, paths and the target-database safety guard."""

from __future__ import annotations

import os
import pathlib
import time
from dataclasses import dataclass
from urllib.parse import urlparse

PACKAGE_ROOT = pathlib.Path(__file__).resolve().parents[1]  # importer/
REPO_ROOT = PACKAGE_ROOT.parent
IMAGE_DIR = REPO_ROOT / "public" / "content" / "images"
IMAGE_URL_PREFIX = "/content/images/"
MANIFEST_PATH = PACKAGE_ROOT / "image_manifest.json"
REPORT_DIR = PACKAGE_ROOT / "reports"
BACKUP_DIR = PACKAGE_ROOT / "backups"

DEFAULT_IMAGE_HOSTS = ("assets.ccbp.in",)
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
MAX_GUARD_AGE_S = 24 * 3600


class ConfigError(Exception):
    """A setting is missing or a safety rule refuses the run."""


def load_env_file(path: pathlib.Path) -> None:
    """Minimal KEY=VALUE reader. Existing environment variables win."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key, value = key.strip(), value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


@dataclass(frozen=True)
class Config:
    scraper_dir: pathlib.Path
    cheat_sheet_dir: pathlib.Path
    private_dir: pathlib.Path
    dsn: str | None
    image_hosts: tuple[str, ...]

    @property
    def target_host(self) -> str:
        return host_of(self.dsn) if self.dsn else "-"


def load_config(env_file: pathlib.Path | None = None) -> Config:
    load_env_file(env_file or PACKAGE_ROOT / ".env")
    scraper = os.environ.get("SCRAPER_DIR", "").strip()
    if not scraper:
        raise ConfigError("SCRAPER_DIR is not set. Point it at the export folder (see importer/.env.example).")
    scraper_dir = pathlib.Path(scraper).expanduser().resolve()
    if not scraper_dir.is_dir():
        raise ConfigError(f"SCRAPER_DIR does not exist: {scraper_dir}")

    sheets = os.environ.get("CHEAT_SHEET_DIR", "").strip()
    cheat_dir = pathlib.Path(sheets).expanduser().resolve() if sheets else scraper_dir.parent / "course_cheat_sheets_styled"

    private = os.environ.get("PRIVATE_DIR", "").strip()
    private_dir = pathlib.Path(private).expanduser() if private else PACKAGE_ROOT / "private"
    if not private_dir.is_absolute():
        private_dir = (REPO_ROOT / private_dir).resolve()

    hosts = tuple(h.strip().lower() for h in os.environ.get("IMAGE_HOSTS", "").split(",") if h.strip())
    return Config(
        scraper_dir=scraper_dir,
        cheat_sheet_dir=cheat_dir,
        private_dir=private_dir,
        dsn=os.environ.get("IMPORT_DATABASE_URL") or None,
        image_hosts=hosts or DEFAULT_IMAGE_HOSTS,
    )


def host_of(dsn: str) -> str:
    return (urlparse(dsn).hostname or "").lower()


def is_local(dsn: str) -> bool:
    return host_of(dsn) in LOCAL_HOSTS


def _fresh(path: pathlib.Path) -> bool:
    return path.is_file() and (time.time() - path.stat().st_mtime) <= MAX_GUARD_AGE_S


def check_write_target(
    dsn: str | None,
    confirm_remote: str | None = None,
    backup_file: pathlib.Path | None = None,
    plan_report: pathlib.Path | None = None,
) -> str:
    """Refuse a write to anything but a local database unless the operator proves intent.

    A remote target needs the host typed back, a backup file written in the last 24 hours and a plan report
    from the last 24 hours. Returns the host name for the run record.
    """
    if not dsn:
        raise ConfigError("IMPORT_DATABASE_URL is not set.")
    host = host_of(dsn)
    if not host:
        raise ConfigError("IMPORT_DATABASE_URL has no host.")
    if host in LOCAL_HOSTS:
        return host
    if (confirm_remote or "").lower() != host:
        raise ConfigError(
            f"{host} is not a local database. Writing to it needs --confirm-remote {host} "
            "plus --backup-file and --plan-report, and the owner's approval."
        )
    if backup_file is None or not _fresh(backup_file):
        raise ConfigError("A remote write needs --backup-file pointing at a backup written in the last 24 hours.")
    if plan_report is None or not _fresh(plan_report):
        raise ConfigError("A remote write needs --plan-report from a plan run in the last 24 hours.")
    return host
