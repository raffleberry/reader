"""HTTP server: TTS API + settings + static UI.

Books live in the UI (IndexedDB); this server only speaks.
Run: uv run python -m reader.
"""
import asyncio
import os

from aiohttp import web

from reader import browser, settings, voice
from reader.paths import dist

DIST = dist()
MAX_PREFETCH = 20


async def health(_req):
    return web.json_response({"ok": True})


async def get_settings(_req):
    return web.json_response(settings.load())


async def put_settings(req):
    try:
        body = await req.json()
    except ValueError:
        return web.json_response({"error": "body must be JSON"}, status=400)
    try:
        out = settings.save(body)
    except ValueError as err:
        return web.json_response({"error": str(err)}, status=400)
    await voice.CACHE.trim(out["cache_mb"] * 1024 * 1024)
    return web.json_response(out)


async def cache_stats(_req):
    return web.json_response(await voice.CACHE.stats())


async def cache_clear(_req):
    await voice.CACHE.clear()
    return web.json_response({"ok": True})


async def speak(req):
    try:
        body = await req.json()
    except ValueError:
        return web.json_response({"error": "body must be JSON"}, status=400)
    try:
        audio, _words = await voice.ensure(str(body.get("text", "")))
    except ValueError as err:
        return web.json_response({"error": str(err)}, status=400)
    except RuntimeError as err:
        return web.json_response({"error": str(err)}, status=502)
    return web.Response(body=audio, content_type="audio/mpeg")


async def speak_words(req):
    try:
        body = await req.json()
    except ValueError:
        return web.json_response({"error": "body must be JSON"}, status=400)
    try:
        _audio, words = await voice.ensure(str(body.get("text", "")))
    except ValueError as err:
        return web.json_response({"error": str(err)}, status=400)
    except RuntimeError as err:
        return web.json_response({"error": str(err)}, status=502)
    return web.json_response({"words": words})


async def prefetch(req):
    try:
        body = await req.json()
    except ValueError:
        return web.json_response({"error": "body must be JSON"}, status=400)
    texts = body.get("texts", [])
    if not isinstance(texts, list):
        return web.json_response({"error": "texts must be a list"}, status=400)
    for text in texts[:MAX_PREFETCH]:
        if isinstance(text, str) and text.strip():
            asyncio.ensure_future(_warm(text))
    return web.json_response({"ok": True}, status=202)


async def _warm(text: str):
    try:
        await voice.ensure(text)
    except (ValueError, RuntimeError):
        pass  # real request will surface the error


def make_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/api/health", health)
    app.router.add_get("/api/settings", get_settings)
    app.router.add_put("/api/settings", put_settings)
    app.router.add_get("/api/cache/stats", cache_stats)
    app.router.add_delete("/api/cache", cache_clear)
    app.router.add_post("/api/tts/audio", speak)
    app.router.add_post("/api/tts/words", speak_words)
    app.router.add_post("/api/tts/prefetch", prefetch)
    if DIST.joinpath("index.html").exists():
        app.router.add_static("/assets", DIST / "assets", show_index=False)
        app.router.add_get("/{tail:.*}", index_page)
    else:
        app.router.add_get("/", dev_hint)
    return app


async def index_page(_req):
    return web.FileResponse(DIST / "index.html")


async def dev_hint(_req):
    return web.Response(
        text="Reader API is up. Build the web UI with `just build` or run dev mode with `just web`.",
        content_type="text/plain",
    )


def main():
    port = int(os.getenv("PORT", "8000"))
    url = f"http://127.0.0.1:{port}"
    print(f"Reader at {url}", flush=True)
    browser.open(url)
    web.run_app(make_app(), host="127.0.0.1", port=port, print=None)


if __name__ == "__main__":
    main()
