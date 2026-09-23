# AGENTS.md

EPUB reader + read-aloud. Books live in browser IndexedDB (gated on `persist()`); backend is TTS-only, stateless. Verified 2026-09-24, no git history.

## Commands (`just` is truth; don't invent)

- `setup` (uv sync + bun install) · `server` :8000 · `web` :5173 (proxies /api) · `dev` both
- `build` (vue-tsc + vite → frontend/dist, served by backend) · `check` (compileall + pytest + build) · `e2e` (playwright chromium highlighter tests; first time: `bun x playwright install chromium`)

## Backend (`backend/`, uv, aiohttp + edge-tts + platformdirs)

- `server.py`: `GET /api/health|settings|cache/stats`, `PUT /api/settings`, `DELETE /api/cache`, `POST /api/tts/audio|words {text}`, `POST /api/tts/prefetch {texts}` (202, max 20). TTS fail → 502. `PORT` overrides 8000.
- `voice.py`: shared disk LRU keyed `sha1(voice+text)`; `settings.py`: validated JSON (`cache_mb` 10-2000, `readahead` 0-10, voice str).
- Dirs: `~/.cache/reader/tts`, `~/.config/reader/settings.json` (Linux; platformdirs elsewhere).

## Frontend (`frontend/`, bun, TS `<script setup>`, Bootstrap; custom CSS only App.vue)

- `db.ts` (IDB v2: `books` + `marks` with `bookId` index), `text/epub.ts` (zip→sentences, keys `00-0003`; chapters parsed as lenient HTML, splitter regex-dumb on purpose), `api/voice|settings`, `store/reader|player|sidecar` (player: module-scope `Audio` with lookahead queue, run + play tokens drop stale work, rAF word sync), `tts/locate.ts` (sentence→DOM via whitespace-collapsed back-map incl. whitespace-only nodes; words painted via live-DOM search inside the sentence element so paint-splits can't drift; skips unfound words, prefix fallback when the tail differs), `theme.ts` (`data-theme` + `data-bs-theme` on `<html>`, 4 themes incl. monokai).
- Views: `Library`, `Reader` (no Settings route — settings live in the sidecar). Components: `TopBar`, `BookCard`, `ReaderBar`, `Sidecar` (toc/marks/settings tabs + collapse rail), `TocList`, `BookmarksPanel`, `SettingsPanel`, `StorageGate`.
- Reader: `EpubView` + custom chrome; depend only on `BookRendition` (`types.ts`: display/prev/next/resize/getContents/hooks/on/off, `book.locations` + `book.spine`), never epubjs `Rendition` class. Gotchas: `openAs:'binary'` (ArrayBuffer input; `'epub'` would fetch `"[object ArrayBuffer]"`); `.reader-frame` must be `relative` + neutralize EpubView's absolute `.reader` inset; iframe keys + wheel owned by us (`enable-key=false`, `enable-wheel=false`); location state (cfi/href/spine) comes from our own `relocated` listener — vue-reader's `update:location` carries only the CFI string; highlight CSS injected per chapter via `hooks.content`; chrome is static in-flow edges (top ReaderBar with `p / N · chapter`, bottom scrub row: prev/next, slider, play, count); a ResizeObserver re-measures the rendition on frame size changes.
- Player: read-aloud starts at the current chapter (`firstAudible`; exact-page CFI seek is a queued follow-up); `ensureSentenceDoc` displays once per chapter then pages forward until the sentence is visible (same-page sentences never redisplay); client-side playback speed (`rate`, localStorage, pitch preserved); auto-scroll defaults off (Settings); AbortError from a paused/interrupted load is never a UI error (retry once).
- Wheel: the book is one continuous scroll; edge-overscroll advances chapters (9 ticks + 120px, jitter deadband, 800ms cooldown, suppressed at book ends) with an `over-ind` pill; chapter edge = iframe-rect vs `.epub-container`-rect visibility (never scroll offsets); direction is a `reader.wheel` setting (Normal/Inverted, localStorage).
- Scrub row: floating-ui thumb popup + TOC chapter markers (spine→first-location, one per page) with floating-ui tooltips; text selection shows a floating-ui popup (bookmark / read-from-here / copy); bookmarks jump + flash via `BookmarksPanel`.
- Deps: `@floating-ui/dom` (all floating UI), TS pinned v5 (vue-tsc breaks on v7); vite host `127.0.0.1` (bare vite binds `::1` only).

## Tests

`test_settings.py`, `test_voice.py` — offline-safe, TTS never touched.
`frontend/e2e/` — playwright chromium (`just e2e`, boots vite dev itself): `highlight.spec.ts` (locate.ts sentence/word paints), `player.spec.ts` (`ensureSentenceDoc` display/page-turn via a fake rendition), `selection.spec.ts` (read-from-here DOM-position resolution), `settings.spec.ts` (Ava-default voices, per-theme highlight CSS, playback rate clamp/persist/apply).

## Guidance

Flat modules, short Go-style names, full types on the TS boundary.
