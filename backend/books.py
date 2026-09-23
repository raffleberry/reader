"""Book library: store raw EPUB files + metadata on disk."""
import json
import time
import uuid
from pathlib import Path

from . import store

OK = {".epub"}


def kind_of(name: str) -> str:
    """Return 'epub' or '' when unsupported."""
    ext = Path(name).suffix.lower()
    return ext[1:] if ext in OK else ""


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def all() -> list[dict]:
    """List all books (newest first)."""
    if not store.META.exists():
        return []
    try:
        rows = json.loads(store.META.read_text())
    except (ValueError, OSError):
        return []
    return sorted(rows, key=lambda b: b.get("created", 0), reverse=True)


def _save(rows: list[dict]) -> None:
    store.dirs()
    store.META.write_text(json.dumps(rows, indent=2))


def add(name: str, data: bytes) -> dict:
    """Save an uploaded EPUB, record metadata."""
    if kind_of(name) != "epub":
        raise ValueError("only .epub is supported for now")
    if not data:
        raise ValueError("empty file")
    if not data[:4] == b"PK\x03\x04":
        raise ValueError("not a valid .epub file")
    store.dirs()
    bid = new_id()
    (store.UPLOADS / f"{bid}.epub").write_bytes(data)
    book = {
        "id": bid,
        "title": Path(name).stem,
        "format": "epub",
        "size": len(data),
        "created": int(time.time()),
    }
    rows = all()
    rows.append(book)
    _save(rows)
    return book


def get(bid: str) -> dict | None:
    return next((b for b in all() if b["id"] == bid), None)


def raw_path(book: dict) -> Path:
    return store.UPLOADS / f"{book['id']}.{book['format']}"


def text_cache(book_id: str) -> Path:
    return store.CACHE / book_id / "sentences.json"


def audio_dir(book_id: str) -> Path:
    return store.CACHE / book_id / "audio"


def drop(bid: str) -> bool:
    """Delete book files, cache + metadata. Returns True when found."""
    book = get(bid)
    if book is None:
        return False
    raw_path(book).unlink(missing_ok=True)
    import shutil

    shutil.rmtree(store.CACHE / bid, ignore_errors=True)
    _save([b for b in all() if b["id"] != bid])
    return True
