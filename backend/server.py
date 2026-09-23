"""HTTP server: JSON API + static frontend. Run: uv run python -m backend.server."""
import os
from dataclasses import asdict
from pathlib import Path

from aiohttp import web

from . import books, store, text, voice

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "frontend" / "dist"
MAX_FILE = 100 * 1024 * 1024  # 100 MB uploads
CT = {"epub": "application/epub+zip"}


async def health(_req):
    return web.json_response({"ok": True})


async def list_books(_req):
    return web.json_response(books.all())


async def add_book(req):
    post = await req.post()
    field = post.get("file")
    if field is None or not hasattr(field, "file"):
        return web.json_response({"error": "send a file as field 'file'"}, status=400)
    try:
        book = books.add(field.filename or "book", field.file.read())
    except ValueError as err:
        return web.json_response({"error": str(err)}, status=400)
    return web.json_response(book, status=201)


async def show_book(req):
    book = books.get(req.match_info["id"])
    if book is None:
        return web.json_response({"error": "not found"}, status=404)
    return web.json_response(book)


async def send_file(req):
    book = books.get(req.match_info["id"])
    if book is None:
        return web.json_response({"error": "not found"}, status=404)
    raw = books.raw_path(book)
    if not raw.exists():
        return web.json_response({"error": "file missing"}, status=404)
    return web.FileResponse(raw, headers={"Content-Type": CT[book["format"]]})


async def send_text(req):
    book = books.get(req.match_info["id"])
    if book is None:
        return web.json_response({"error": "not found"}, status=404)
    try:
        chapters = text.load_chapters(
            book["format"], books.raw_path(book), books.text_cache(book["id"])
        )
    except ValueError as err:
        return web.json_response({"error": str(err)}, status=400)
    return web.json_response({"chapters": [asdict(c) for c in chapters]})


async def send_audio(req):
    book = books.get(req.match_info["id"])
    if book is None:
        return web.json_response({"error": "not found"}, status=404)
    try:
        audio, _words = await voice.ensure_audio(book, req.match_info["key"])
    except KeyError:
        return web.json_response({"error": "unknown sentence"}, status=404)
    except RuntimeError as err:
        return web.json_response({"error": str(err)}, status=502)
    return web.FileResponse(audio, headers={"Content-Type": "audio/mpeg"})


async def send_words(req):
    book = books.get(req.match_info["id"])
    if book is None:
        return web.json_response({"error": "not found"}, status=404)
    try:
        _audio, words = await voice.ensure_audio(book, req.match_info["key"])
    except KeyError:
        return web.json_response({"error": "unknown sentence"}, status=404)
    except RuntimeError as err:
        return web.json_response({"error": str(err)}, status=502)
    return web.json_response({"words": words})


async def drop_book(req):
    if not books.drop(req.match_info["id"]):
        return web.json_response({"error": "not found"}, status=404)
    return web.json_response({"ok": True})


def make_app() -> web.Application:
    store.dirs()
    app = web.Application(client_max_size=MAX_FILE)
    app.router.add_get("/api/health", health)
    app.router.add_get("/api/books", list_books)
    app.router.add_post("/api/books", add_book)
    app.router.add_get("/api/books/{id}", show_book)
    app.router.add_get("/api/books/{id}/file", send_file)
    app.router.add_get("/api/books/{id}/sentences", send_text)
    app.router.add_get("/api/books/{id}/audio/{key}", send_audio)
    app.router.add_get("/api/books/{id}/words/{key}", send_words)
    app.router.add_delete("/api/books/{id}", drop_book)
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
    web.run_app(make_app(), host="127.0.0.1", port=port, print=None)
    print(f"Reader at http://127.0.0.1:{port}")


if __name__ == "__main__":
    main()
