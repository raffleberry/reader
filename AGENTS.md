# AGENTS.md

## Status

EPUB reader + read-aloud app (verified 2026-09-23). No git history yet.

## Commands (via `just`)

- `just setup` — `uv sync --group dev` + `bun install` in `frontend/`
- `just server` — backend API on `:8000`; `just web` — vite dev on `:5173` (proxies `/api`); `just dev` — both
- `just build` — frontend typecheck (`vue-tsc`) + production build into `frontend/dist` (backend serves it statically)
- `just check` — `compileall` + `pytest` + frontend build

## Facts

- EPUB only. PDFs were dropped deliberately (pending a highlighting strategy); `books.py` rejects non-EPUB uploads. No markitdown, no `marked`.
- Backend package is `backend/`: `server.py` (routes), `books.py` (raw file store), `text.py` (per-format sentence interface), `voice.py` (edge-tts), `store.py` (paths). `PORT` env overrides 8000.
- Text interface: `text.SOURCES` maps format -> object with `chapters(raw)`. New formats only touch `text.py`. Sentences cached at `storage/cache/{id}/sentences.json`; keys look like `00-0003` (chapter-sentence).
- TTS: `voice.ensure_audio(book, key)` returns cached-or-generated MP3 path + `[{text, start_ms, end_ms}]` (edge-tts `WordBoundary`, 100ns ticks // 10000). First generation needs internet; failures surface as HTTP 502. Default voice `en-US-AriaNeural` in `voice.py`.
- API: `GET /api/health`, `GET/POST /api/books`, `GET /api/books/{id}`, `GET /api/books/{id}/file` (raw epub), `GET /api/books/{id}/sentences`, `GET /api/books/{id}/audio/{key}` (mp3), `GET /api/books/{id}/words/{key}`, `DELETE /api/books/{id}`. Upload field is `file`; 100 MB cap.
- Frontend (`frontend/`, bun, TypeScript with `<script setup lang="ts">`, Bootstrap for all styling — no custom CSS except TOC drawer, highlight colors + reader height in `App.vue`): `EpubView` from `vue-reader` (CSS `vue-reader/lib/index.css`), raw rendition kept `markRaw` in `store/reader.ts`. `Reader.vue` passes `:epub-init-options="{ openAs: 'epub' }"` — epub.js sniffs the book type from the URL extension, and our extensionless `/file` route is misread as an unpacked directory (fetches `META-INF/container.xml`, gets index.html, dies with an XML parse error). Reader chrome is custom around `EpubView` (template ref `nextPage`/`prevPage`/`setLocation`): `ReaderBar` (TOC, page turn, Pages/Scroll flow via `:key` remount keeping `:location` CFI, font scale, theme), `TocDrawer` (Bootstrap-style manual offcanvas from `tocChanged`), page theme/font/highlight CSS painted per chapter in `rendition.hooks.content`. Our code only depends on the narrow `BookRendition` surface in `src/types.ts`, never the epubjs `Rendition` class type (structurally brittle). TypeScript is pinned to v5 (`vue-tsc` breaks on v7). Vite `server.host` is pinned to `127.0.0.1` (bare vite binds `::1` only, so `127.0.0.1:5173` refuses connections). Playback lives in `store/player.ts` (single module-scope `Audio`, run counter drops stale fetches).
- Sentence->screen mapping (`src/tts/locate.ts`): backend text matched against chapter DOM on whitespace-collapsed copies with a raw-offset back-map; unfound words are skipped, never misaligned. Highlight CSS is injected per chapter via `rendition.hooks.content` (app CSS can't reach the book iframes); viewer needs the sized `.reader-frame` parent (`height: 100%` inside). EpubView's root (`.reader`) is `position: absolute` with a 50px inset — `.reader-frame` must be `position: relative` and neutralize it (`.reader-frame > div.reader { inset: 0 }`), or the book positions against the viewport. Arrow keys inside the book are owned by us (`keydown` attached per chapter in the same content hook; `:enable-key="false"` on EpubView to avoid double flips) — iframe events never reach the top window, and the library's own keyup listener is unreliable.
- Tests: `tests/test_books.py`, `tests/test_text.py` (offline-safe; TTS service never touched). `flat`/`wordSpans` verified via `bun -e`.

## Guidance

- Do not invent build/test/lint commands — the `just` recipes are the source of truth.
- Keep code beginner-simple: flat modules, short Go-style names, full types on the TS API boundary (`<script setup lang="ts">`).
- Sentence splitter (`text.split_sentences`) is regex-dumb on purpose; upgrade only if real books mis-split.
