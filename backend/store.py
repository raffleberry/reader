"""Disk paths and tiny JSON store for books."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STORAGE = ROOT / "storage"
UPLOADS = STORAGE / "uploads"
CACHE = STORAGE / "cache"
META = STORAGE / "books.json"


def dirs():
    """Create storage dirs (idempotent)."""
    UPLOADS.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)
    return STORAGE
