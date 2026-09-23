# Reader

Local web app to read EPUB books in the browser and listen to them read aloud with word-level highlighting.

- Backend: Python + `aiohttp`. Text comes from a small per-format interface (`backend/text.py`); speech from edge-tts (`backend/voice.py`).
- Frontend: Vue 3 + Pinia, TypeScript (`<script setup lang="ts">`), Bootstrap, managed with `bun`. EPUBs render with `vue-reader` (epub.js). `bun run build` typechecks (`vue-tsc`) then bundles.
- Task runner: `just`. Python deps: `uv`. JS deps: `bun`.

## Layout

```text
backend/    # server.py (routes), books.py (library), text.py (sentence interface),
            # voice.py (edge-tts audio + word timings), store.py (paths)
frontend/   # TypeScript: main.ts, router.ts, types.ts, api/, store/ (reader, player),
            # tts/locate.ts (sentence->DOM mapping), views/ (Library, Reader),
            # components/ (TopBar, BookCard, ReaderBar, TocDrawer, PlayerBar)
storage/    # local data: uploads/*.epub, cache/{id}/ (sentences.json, audio/)
tests/      # pytest, offline-safe
```

## Run

```sh
just setup     # install python + js deps
just dev       # backend :8000 + frontend :5173 (or run separately below)
just server    # backend only  -> http://127.0.0.1:8000
just web       # frontend only -> http://127.0.0.1:5173
just build     # production frontend build (served by backend)
just check     # compile + tests + frontend build
```

Upload an `.epub` in the Library view, open it, press **Read aloud**. The current sentence highlights yellow, the spoken word highlights orange, and auto-scroll (toggleable) follows along. Audio + timings are cached under `storage/cache/`, so replay works offline — but the first generation needs internet (edge-tts calls the Microsoft speech service).

## Adding a document format later (e.g. PDF)

1. Write a class with `chapters(raw) -> list[Chapter]` in `backend/text.py` and register it in `SOURCES`. TTS, caching, and routes work unchanged.
2. Add a viewer component + sentence locator on the frontend (`src/tts/`), reusing `store/player.js` as-is.
