#!/usr/bin/env python3
"""Reader — the local speech server for the Reader browser extension.

One file, one job: turn plain text into spoken audio. The extension holds
the books and does the reading; this process only speaks. It keeps a small
disk cache so a sentence is generated once and replays instantly.

Run it:

    uv run reader.py            # http://127.0.0.1:8000
    uv run reader.py --port 9000
    ./reader                    # the packaged binary (Windows / Linux)

The extension is told where to look in its settings; this side never needs
configuring. Everything the server stores is disposable: cached audio in
the system cache dir, and a voice/cache-size preference in the config dir.
"""
import argparse
import asyncio
import hashlib
import json
import os
import threading
import webbrowser
from collections import OrderedDict
from pathlib import Path

from aiohttp import web
from platformdirs import user_cache_dir, user_config_dir

VERSION = "1.0.0"
APP = "reader"
MAX_TEXT = 5000
MAX_PREFETCH = 20
DEFAULTS = {"cache_mb": 100, "readahead": 3, "voice": "en-US-AvaNeural"}
MIN_MB, MAX_MB = 10, 2000
MAX_AHEAD = 10
# Prefixed, because the extension is the only client and the server should
# be useless to a random web page: a plain site must not be able to spend
# the user's speech quota.
EXT_ORIGINS = ("chrome-extension://", "moz-extension://")


# --- system dirs ------------------------------------------------------
# Linux: ~/.cache/reader/tts + ~/.config/reader/settings.json. macOS and
# Windows follow platformdirs (~/Library/Caches, %LOCALAPPDATA%). Nothing
# book-shaped lives here: books never reach the server at all.


def tts_dir() -> Path:
    d = Path(user_cache_dir(APP)) / "tts"
    d.mkdir(parents=True, exist_ok=True)
    return d


def settings_file() -> Path:
    d = Path(user_config_dir(APP))
    d.mkdir(parents=True, exist_ok=True)
    return d / "settings.json"


# --- settings ---------------------------------------------------------


def load_settings() -> dict:
    """Settings merged over defaults (unknown keys dropped)."""
    try:
        saved = json.loads(settings_file().read_text())
    except (ValueError, OSError):
        saved = {}
    return {k: saved.get(k, v) for k, v in DEFAULTS.items()}


def check_settings(patch: dict) -> dict:
    """Validated full settings from a partial update. Raises ValueError."""
    if not isinstance(patch, dict):
        raise ValueError("settings must be an object")
    out = load_settings()
    for key, val in patch.items():
        if key == "cache_mb":
            if not isinstance(val, (int, float)) or not MIN_MB <= val <= MAX_MB:
                raise ValueError(f"cache_mb must be {MIN_MB}-{MAX_MB}")
            out[key] = int(val)
        elif key == "readahead":
            if not isinstance(val, int) or not 0 <= val <= MAX_AHEAD:
                raise ValueError(f"readahead must be 0-{MAX_AHEAD}")
            out[key] = val
        elif key == "voice":
            if not isinstance(val, str) or not 3 <= len(val) <= 80:
                raise ValueError("voice must be a voice name")
            out[key] = val
        else:
            raise ValueError(f"unknown setting: {key}")
    return out


async def save_settings(patch: dict) -> dict:
    """Persist settings and re-apply the cache cap. Raises ValueError."""
    out = check_settings(patch)
    settings_file().write_text(json.dumps(out, indent=1))
    await cache().trim(out["cache_mb"] * 1024 * 1024)
    return out


# --- speech cache -----------------------------------------------------


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
            self._evict()

    def _add(self, key: str, size: int):
        self.bytes += size - self.sizes.get(key, 0)
        self.sizes[key] = size
        self.sizes.move_to_end(key)

    def _evict(self):
        """Oldest-first eviction down to the cap. Caller holds the lock."""
        while self.bytes > self.max_bytes and self.sizes:
            old, size = self.sizes.popitem(last=False)
            self.bytes -= size
            self._unlink(old)

    def _unlink(self, key: str):
        a_path, w_path = self._paths(key)
        a_path.unlink(missing_ok=True)
        w_path.unlink(missing_ok=True)

    def _drop(self, key: str):
        self.bytes -= self.sizes.pop(key, 0)
        self._unlink(key)

    async def trim(self, max_bytes: int) -> None:
        async with self.lock:
            self.max_bytes = max_bytes
            self._evict()

    async def stats(self) -> dict:
        async with self.lock:
            return {"entries": len(self.sizes), "bytes": self.bytes}

    async def clear(self) -> None:
        async with self.lock:
            for key in list(self.sizes):
                self._unlink(key)
            self.sizes.clear()
            self.bytes = 0


CACHE: Lru | None = None


def cache() -> Lru:
    """The process-wide cache, built on first use (not at import)."""
    global CACHE
    if CACHE is None:
        CACHE = Lru(tts_dir(), load_settings()["cache_mb"] * 1024 * 1024)
    return CACHE


# --- synthesis --------------------------------------------------------


async def synth(voice: str, text: str) -> tuple[bytes, list]:
    """One edge-tts call. Raises RuntimeError when the service fails."""
    try:
        import edge_tts
    except ImportError as err:
        raise RuntimeError("edge-tts is not installed (run: uv sync)") from err
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
    cfg = load_settings()
    voice = voice or cfg["voice"]
    c = cache()
    key = key_for(voice, text)
    hit = await c.get(key)
    if hit is not None:
        return hit
    audio, words = await synth(voice, text)
    await c.put(key, audio, words)
    return audio, words


# --- routes -----------------------------------------------------------


def cors_headers(req: web.Request) -> dict:
    """Reflect the caller's origin, but only for a browser extension.

    Chromium ignores CORS for a host the extension has permission for;
    Firefox makes the user grant it, so the server has to answer too. The
    allow-list keeps a normal web page from spending the user's speech.
    """
    origin = req.headers.get("Origin", "")
    if not origin.startswith(EXT_ORIGINS):
        return {}
    return {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
    }


@web.middleware
async def cors(req: web.Request, handler):
    if req.method == "OPTIONS":
        return web.Response(status=204, headers=cors_headers(req))
    resp = await handler(req)
    resp.headers.update(cors_headers(req))
    return resp


async def health(_req: web.Request) -> web.Response:
    """The extension's liveness probe; version so it can say which build."""
    return web.json_response({"ok": True, "version": VERSION})


LANDING = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Reader server</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{{font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:4rem auto;
padding:0 1.5rem;background:#121212;color:#e8e8e8}}
a{{color:#a6e22e}}code{{background:#272822;padding:.15rem .4rem;border-radius:.3rem}}
h1{{font-size:1.5rem}}</style></head><body>
<h1>Reader speech server is running</h1>
<p>Version {version}, on <code>{url}</code>.</p>
<p>Reader is a browser extension. Install it, and it finds this server on its
own &mdash; there is nothing to configure unless you moved it to another port.</p>
<p>Download the extension from
<a href="https://github.com/raffleberry/reader/releases/latest">the Reader releases</a>.
</p>
<p>Keep this window open while you listen. Press Ctrl-C to stop the server.</p>
</body></html>"""


async def landing(req: web.Request) -> web.Response:
    """A human landing page, for anyone who opens the address by hand."""
    url = f"http://{req.host}"
    return web.Response(
        text=LANDING.format(version=VERSION, url=url), content_type="text/html"
    )


async def get_settings(_req: web.Request) -> web.Response:
    return web.json_response(load_settings())


async def put_settings(req: web.Request) -> web.Response:
    try:
        body = await req.json()
    except ValueError:
        return web.json_response({"error": "body must be JSON"}, status=400)
    try:
        out = await save_settings(body)
    except ValueError as err:
        return web.json_response({"error": str(err)}, status=400)
    return web.json_response(out)


async def cache_stats(_req: web.Request) -> web.Response:
    return web.json_response(await cache().stats())


async def cache_clear(_req: web.Request) -> web.Response:
    await cache().clear()
    return web.json_response({"ok": True})


async def _body(req: web.Request) -> tuple[str | None, web.Response | None]:
    """Parsed JSON body, or (None, error response)."""
    try:
        body = await req.json()
    except ValueError:
        return None, web.json_response({"error": "body must be JSON"}, status=400)
    if not isinstance(body, dict):
        return None, web.json_response({"error": "body must be an object"}, status=400)
    return str(body.get("text", "")), None


async def speak(req: web.Request) -> web.Response:
    """MP3 for one sentence. 400 for a bad request, 502 when TTS fails."""
    text, err = await _body(req)
    if err:
        return err
    try:
        audio, _words = await ensure(text or "")
    except ValueError as err:
        return web.json_response({"error": str(err)}, status=400)
    except RuntimeError as err:
        return web.json_response({"error": str(err)}, status=502)
    return web.Response(body=audio, content_type="audio/mpeg")


async def speak_words(req: web.Request) -> web.Response:
    """Word timings for one sentence, so the reader can follow along."""
    text, err = await _body(req)
    if err:
        return err
    try:
        _audio, words = await ensure(text or "")
    except ValueError as err:
        return web.json_response({"error": str(err)}, status=400)
    except RuntimeError as err:
        return web.json_response({"error": str(err)}, status=502)
    return web.json_response({"words": words})


async def prefetch(req: web.Request) -> web.Response:
    """Warm several upcoming sentences (capped, best-effort)."""
    try:
        body = await req.json()
    except ValueError:
        return web.json_response({"error": "body must be JSON"}, status=400)
    texts = body.get("texts", []) if isinstance(body, dict) else []
    if not isinstance(texts, list):
        return web.json_response({"error": "texts must be a list"}, status=400)
    for text in texts[:MAX_PREFETCH]:
        if isinstance(text, str) and text.strip():
            asyncio.ensure_future(_warm(text))
    return web.json_response({"ok": True}, status=202)


async def _warm(text: str):
    try:
        await ensure(text)
    except (ValueError, RuntimeError):
        pass  # the real request will surface the error


def make_app() -> web.Application:
    app = web.Application(middlewares=[cors])
    app.router.add_get("/", landing)
    app.router.add_get("/api/health", health)
    app.router.add_get("/api/settings", get_settings)
    app.router.add_put("/api/settings", put_settings)
    app.router.add_get("/api/cache/stats", cache_stats)
    app.router.add_delete("/api/cache", cache_clear)
    app.router.add_post("/api/tts/audio", speak)
    app.router.add_post("/api/tts/words", speak_words)
    app.router.add_post("/api/tts/prefetch", prefetch)
    return app


# --- entry point ------------------------------------------------------


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(prog="reader", description="Reader speech server")
    p.add_argument("--port", type=int, default=int(os.getenv("PORT", "8000")))
    p.add_argument("--host", default=os.getenv("HOST", "127.0.0.1"))
    p.add_argument(
        "--open", action="store_true", help="open the info page in a browser"
    )
    p.add_argument("--version", action="version", version=VERSION)
    return p.parse_args()


def open_page(url: str) -> None:
    """Best-effort browser open; a headless box just ignores it."""

    def _open():
        try:
            webbrowser.open(url)
        except Exception:
            pass

    threading.Timer(0.5, _open).start()


def main() -> None:
    args = parse_args()
    url = f"http://{args.host}:{args.port}"
    print(f"Reader speech server {VERSION} on {url}", flush=True)
    if args.host not in ("127.0.0.1", "localhost", "::1"):
        print(f"WARNING: listening on {args.host} — reachable from your network", flush=True)
    print("The Reader extension finds it on its own. Ctrl-C to stop.", flush=True)
    if args.open:
        open_page(url)
    web.run_app(make_app(), host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
