# Reader

EPUB reader + read-aloud. Books live in the browser (IndexedDB); the server only makes speech.

- Backend: Python + `aiohttp`: `POST /api/tts/audio|words|prefetch {text}`, settings + cache API. No book state.
- Frontend: Vue 3 + Pinia + TypeScript (`<script setup>`), Bootstrap, `bun`. EPUBs render with `vue-reader`.
- Task runner: `just`. Python deps: `uv`. JS deps: `bun`.

## Layout

```text
backend/    # server.py (routes), voice.py (edge-tts + disk LRU),
            # settings.py (validated JSON), store.py (system dirs)
frontend/   # main.ts, router.ts, types.ts, theme.ts, db.ts (IndexedDB),
            # api/ (voice, settings), text/epub.ts (zip->sentences),
            # tts/locate.ts (sentence->DOM), store/ (reader, player, sidecar),
            # views/ (Library, Reader), components/ (TopBar, BookCard,
            # ReaderBar, Sidecar, TocList, BookmarksPanel, SettingsPanel,
            # StorageGate)
tests/      # pytest, offline-safe (TTS service never touched)
frontend/e2e/ # playwright chromium highlighter tests (`just e2e`)
```

## Run

```sh
just setup     # install python + js deps
just dev       # backend :8000 + frontend :5173
just server    # backend only  -> http://127.0.0.1:8000
just web       # frontend only -> http://127.0.0.1:5173
just build     # vue-tsc + vite build into frontend/dist (served by backend)
just check     # compileall + pytest + frontend build
just e2e       # playwright chromium tests for the highlighter
```

First launch asks for persistent storage (`StorageGate`); the app refuses to run without it. Upload `.epub` files in Library (parsed with JSZip + DOMParser, same `00-0003` sentence keys as before). **Read aloud** highlights the sentence, then each spoken word, with toggleable auto-scroll. The book is one continuous scroll; the mouse wheel advances chapters at the end (direction flippable in Settings).

Speech cache is a shared content-hashed LRU in the OS cache dir (`~/.cache/reader/tts` on Linux), capped by Settings (default 100 MB); the player pre-generates the next few sentences while you listen. First generation needs internet (edge-tts); replay is offline.

## Adding a document format later

New `src/text/<fmt>.ts` exporting `parseEpub`-shaped `{title, sentences}`; player/highlighter reuse as-is.
