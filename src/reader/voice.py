"""Read-aloud: edge-tts audio + word timings in a shared disk LRU.

Keyed by content hash (voice + text), so identical sentences share one
entry across books and switching voices just misses to fresh entries.
The byte cap comes from settings and can change at runtime.
"""
import asyncio
import hashlib
import json
from collections import OrderedDict
from pathlib import Path

from reader import settings, store

MAX_TEXT = 5000


def key_for(voice: str, text: str) -> str:
    return hashlib.sha1(f"{voice}\n{text}".encode()).hexdigest()[:40]


class Lru:
    """Bounded MP3 + timings cache on disk. Not per-book, not permanent."""

    def __init__(self, base: Path, max_bytes: int):
        self.base = base
        self.max_bytes = max_bytes
        self.lock = asyncio.Lock()
        self.sizes: OrderedDict[str, int] = OrderedDict()
        self._scan()

    def _scan(self):
        total = 0
        for mp3 in self.base.glob("*.mp3"):
            words = mp3.with_suffix(".json")
            if words.exists():
                size = mp3.stat().st_size + words.stat().st_size
                self.sizes[mp3.stem] = size
                total += size
        self.bytes = total

    def _paths(self, key: str) -> tuple[Path, Path]:
        return self.base / f"{key}.mp3", self.base / f"{key}.json"

    async def get(self, key: str) -> tuple[bytes, list] | None:
        async with self.lock:
            if key not in self.sizes:
                return None
            audio, words_file = self._paths(key)
            if not audio.exists() or not words_file.exists():
                self._drop(key)
                return None
            self.sizes.move_to_end(key)
            return audio.read_bytes(), json.loads(words_file.read_text())

    async def put(self, key: str, audio: bytes, words: list) -> None:
        async with self.lock:
            self.base.mkdir(parents=True, exist_ok=True)
            a_path, w_path = self._paths(key)
            a_path.write_bytes(audio)
            words_json = json.dumps(words).encode()
            w_path.write_bytes(words_json)
            self._add(key, len(audio) + len(words_json))
            while self.bytes > self.max_bytes and self.sizes:
                old, _size = self.sizes.popitem(last=False)
                self.bytes -= _size
                a_path, w_path = self._paths(old)
                a_path.unlink(missing_ok=True)
                w_path.unlink(missing_ok=True)

    def _add(self, key: str, size: int):
        self.bytes += size - self.sizes.get(key, 0)
        self.sizes[key] = size
        self.sizes.move_to_end(key)

    def _drop(self, key: str):
        size = self.sizes.pop(key, 0)
        self.bytes -= size
        a_path, w_path = self._paths(key)
        a_path.unlink(missing_ok=True)
        w_path.unlink(missing_ok=True)

    async def trim(self, max_bytes: int) -> None:
        async with self.lock:
            self.max_bytes = max_bytes
            while self.bytes > self.max_bytes and self.sizes:
                old, _size = self.sizes.popitem(last=False)
                self.bytes -= _size
                a_path, w_path = self._paths(old)
                a_path.unlink(missing_ok=True)
                w_path.unlink(missing_ok=True)

    async def stats(self) -> dict:
        async with self.lock:
            return {"entries": len(self.sizes), "bytes": self.bytes}

    async def clear(self) -> None:
        async with self.lock:
            for key in list(self.sizes):
                a_path, w_path = self._paths(key)
                a_path.unlink(missing_ok=True)
                w_path.unlink(missing_ok=True)
            self.sizes.clear()
            self.bytes = 0


CACHE = Lru(store.tts_dir(), settings.load()["cache_mb"] * 1024 * 1024)


async def synth(voice: str, text: str) -> tuple[bytes, list]:
    """One edge-tts call. Raises RuntimeError when the service fails."""
    try:
        import edge_tts
    except ImportError as err:
        raise RuntimeError("edge-tts is not installed (run: just setup)") from err
    sound = bytearray()
    words: list = []
    try:
        talk = edge_tts.Communicate(text, voice, boundary="WordBoundary")
        async for msg in talk.stream():
            if msg["type"] == "audio":
                sound.extend(msg["data"])
            elif msg["type"] == "WordBoundary":
                words.append(
                    {
                        "text": msg["text"],
                        "start_ms": msg["offset"] // 10000,
                        "end_ms": (msg["offset"] + msg["duration"]) // 10000,
                    }
                )
    except Exception as err:
        raise RuntimeError(f"speech service failed: {err}") from err
    if not sound:
        raise RuntimeError("speech service returned no audio")
    return bytes(sound), words


async def ensure(text: str, voice: str = "") -> tuple[bytes, list]:
    """Audio bytes + word timings for one text (cached)."""
    text = " ".join(text.split())
    if not text:
        raise ValueError("empty text")
    if len(text) > MAX_TEXT:
        raise ValueError(f"text too long (max {MAX_TEXT} chars)")
    cfg = settings.load()
    voice = voice or cfg["voice"]
    CACHE.max_bytes = cfg["cache_mb"] * 1024 * 1024
    key = key_for(voice, text)
    hit = await CACHE.get(key)
    if hit is not None:
        return hit
    audio, words = await synth(voice, text)
    await CACHE.put(key, audio, words)
    return audio, words
