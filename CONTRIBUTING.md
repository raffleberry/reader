# Contributing to Reader

This guide covers the technical side: architecture, tooling, and tests. For the
user-facing overview, see [README.md](README.md).

## Architecture

Reader is two halves that never share state:

- **The extension** (`src/ui/`) holds the book, renders it, and drives playback.
  It stores settings and one "where I was" note per book. Nothing else.
- **The server** (`reader.py`, one file) turns text into audio. It is told the
  text of the sentence being read and nothing else — no book, no filename, no
  reading history.

The extension finds the server over plain HTTP on the loopback interface. If it
isn't there, that is a first-class state in the UI, not an error: the reader
says where it looked and links to the download.

- Extension: Vue 3 + Pinia (setup stores) + TypeScript (`<script setup>`),
  Bootstrap, **WXT** (Vite under the hood), `bun`. EPUBs render with
  `vue-reader` (epub.js).
- Server: Python + `aiohttp` + `edge-tts` + `platformdirs`, `uv`.
- Task runner: `just`. Python deps: `uv`. JS deps: `bun`.

### Layout

```text
reader.py           # the whole server: settings, disk LRU, edge-tts, routes, CORS
tests/test_reader.py# pytest, offline-safe (the TTS service is never called)
src/ui/
  wxt.config.ts     # srcDir: src, module-vue + auto-icons, generated manifest
  vitest.config.ts  # WxtVitest: unit tests with a working in-memory browser
  playwright.config.ts # e2e against the *built* extension
  entrypoints/      # background.ts, reader/ (unlisted page), options/
  src/
    ext/            # settings.ts (storage items), serve.ts (server address +
                    # probe + "download it" message), shelf.ts (last place),
                    # marks.ts (bookmarks)
    api/            # voice.ts + settings.ts (absolute URLs, ServerDown)
    store/          # prefs (settings + server state), reader (open book),
                    # player (read-aloud), sidecar
    views/          # OpenBook (start screen), Reader, Options
    components/     # Sidecar, ReaderBar, ServerBadge, RecentCard, TocList,
                    # BookmarksPanel, SettingsPanel
    tts/            # locate.ts (sentence→DOM), mark.ts (the live highlight),
                    # cfi.ts (spine positions), sound.ts (the audio element)
    text/epub.ts    # zip → sentences
    assets/         # app.css (palette + chrome), icon.svg (base for PNGs)
  test/             # vitest specs
  e2e/              # playwright specs (built extension + the real server)
  fixtures/         # sample.epub, used by the e2e tests
```

### Server (`reader.py`)

- `GET /` (info page), `GET /api/health` (`{ok, version}` — the extension's
  liveness probe), `GET|PUT /api/settings`, `GET /api/cache/stats`,
  `DELETE /api/cache`, `POST /api/tts/audio|words {text}`,
  `POST /api/tts/prefetch {texts}` (202, max 20). TTS failure → 502.
- **CORS is extension-only.** `cors_headers()` reflects the caller's `Origin`
  only when it starts with `chrome-extension://` or `moz-extension://`.
  Chromium doesn't need this (host permissions bypass CORS); Firefox does,
  because its MV3 host permissions are opt-in. It also means a normal web page
  cannot use the server.
- `Lru` is a bounded on-disk cache of MP3 + word timings, keyed
  `sha1(voice + text)` so identical sentences share an entry across books.
  `save_settings()` re-trims it when the size cap changes.
- CLI: `--port` (or `PORT`), `--host` (or `HOST`), `--open`, `--version`.
- Dirs: `~/.cache/reader/tts`, `~/.config/reader/settings.json` (Linux;
  platformdirs elsewhere).
- **No UI is served.** The extension is the only client.

### Extension (`src/ui/`, WXT)

- `srcDir: "src"`, so `entrypoints/` sits next to `views/`, `components/` and
  `store/`. Auto-imports are **off** (`imports: false`): this codebase imports
  everything explicitly.
- The manifest is generated in `wxt.config.ts`: `storage` permission,
  loopback host permissions (match patterns ignore the port), an `action` with
  no popup, `options_ui`, and — for Firefox — a gecko id and
  `data_collection_permissions`. Firefox is built with `--mv3` (WXT defaults
  Firefox to MV2).
- `entrypoints/background.ts`: the toolbar button opens `/reader.html`, or
  focuses the tab it opened last (tracked in **session** storage, forgotten on
  `tabs.onRemoved`, so a recycled tab id can't hijack a click). No `tabs`
  permission is requested.
- **Storage is `wxt/utils/storage`**, never `localStorage`:
  - `ext/settings.ts` defines one item per preference.
  - `ext/shelf.ts` keeps up to 8 "where I was" notes. A book is identified by
    `sha-256(size ‖ mtime ‖ first 256 KB)` — enough to recognise the same file
    after a rename or move, without reading (or keeping) the whole thing.
  - `ext/marks.ts` keeps bookmarks under that same fingerprint: a sentence
    index, a chapter label and ≤140 characters of the selected text, capped at
    200 per book. A bookmark is only reachable through a shelf entry, so
    `shelf.remember` drops the bookmarks of any book the shelf evicts, and
    `marks.forgetBook` is what the start screen's delete calls.
  - `store/prefs.ts` hydrates those items into refs before the first render and
    `watch`es them, so the sidebar and the options page stay in step.
- `ext/serve.ts` owns the server address: `normalizeUrl`, the module-scope
  `api(path)` used by `api/*`, `probe()` (2 s timeout, never throws),
  `downMessage()` / `ServerDown`, and `onServerDown`/`reportDown` so a request
  that never connected marks the server down immediately. The UI shows the
  state in three places: a `ServerBadge` in the reader bar, a dismissible
  banner over the book, and the player-error row. `player.start` probes first,
  and play/resume are **disabled** while it is down — so pressing play with no
  server says so instead of failing on a request. `prefs.watchServer()` polls
  `GET /api/health` every 15 s while the tab is visible, so a server that dies
  mid-session is noticed even if you aren't speaking yet.
- Reader: `EpubView` + custom chrome; depend only on `BookRendition`
  (`types.ts`), never the epub.js `Rendition` class. Gotchas: `openAs:'binary'`;
  `.reader-frame` must be `relative` and neutralize EpubView's absolute
  `.reader` inset; iframe keys are ours (`enable-key=false`,
  `enable-wheel=false` — the wheel is the browser's now); location state
  (cfi/href/spine) comes from our own `relocated` listener; highlight and link
  CSS is injected per chapter via `hooks.content`; chrome is static in-flow
  edges; a ResizeObserver re-measures the rendition on frame size changes.
- **The book is one continuous scroll.** `epubOptions` is
  `{flow:'scrolled-doc', manager:'continuous'}`: whole chapters are stacked in a
  single `.epub-container` scroll, and epub.js appends the next (or the
  previous) section as you reach one. There are no chapter edges, so there is
  no overscroll pill and no scroll-direction setting — the wheel and the
  scrollbar scroll natively, and the arrow keys page a screenful.
  - The manager decides whether to stack more from the container's *scroll
    height*, and re-checks only when you scroll. That leaves two gaps, which
    `Reader.vue`'s `stackAhead()` closes by calling `manager.fill()` on every
    `relocated`: the first section's height settles *after* epub.js's own
    `fill()` ran, and a section that fits the screen leaves nothing to scroll,
    so no scroll ever comes. Without it the book opens one chapter long and
    stays that way. Each stacked section relocates, so it converges.
  - Several chapter documents are live at once, so anything we inject goes
    through `hooks.content`, and e2e tests must pick the frame they mean
    (`e2e/chapter.ts`).
- **`hooks.content` fires on every re-render, not just the first load.**
  `rendition.resize()` → `manager.resize()` → `views.clear()` + re-render, and
  hiding the sidebar resizes the frame — so the chapter document is destroyed
  and rebuilt, and every span we injected dies with it. That is why the
  highlight is kept as *text* in `tts/mark.ts`: the content hook calls
  `rerender(doc)`, which re-finds the sentence in the new document and rewinds
  the word cursor so the audio clock re-paints the current word. Anything else
  injected into a chapter document belongs in the same hook.
- `relocated` → `reader.scheduleSave()` debounces the shelf write, and
  `pagehide` flushes it. Playback position comes along in the note, so
  `reader.playFrom()` can continue mid-chapter.
- Chapter CSS: `theme.ts` carries the highlight rules *and* per-theme link
  colours (`LINK_CSS`), both injected into every chapter document. A book's own
  stylesheet usually picks a link colour that disappears on our background, so
  ours is `!important`; a test asserts the dark themes' links clear the page
  background by a real contrast ratio. Scrolling to a sentence (auto-scroll, a
  bookmark jump) centres the chapter's iframe *first*, then the sentence
  inside it — centring the iframe alone would only land mid-chapter.
- Bookmarks: made from the selection popup (`markSel`, which files the sentence
  the selection started in), listed by `BookmarksPanel` in the sidecar — it
  follows storage, so one made while the panel is open just appears. A jump
  reuses the read-aloud path (`ensureSentenceDoc`) and flashes the sentence with
  a plain `paint`, so it can't collide with the highlight playback owns.
- Start screen: the "recently read" list is a record, not a launcher. Each card
  shows the chapter, progress and bookmark count, and its only control deletes
  everything about that document (note + bookmarks, confirmed first).
- Player: read-aloud starts at `playFrom(firstAudible())`; `ensureSentenceDoc`
  displays once per chapter then pages forward until the sentence is visible
  (same-page sentences never redisplay); client-side speed (prefs, pitch
  preserved); auto-scroll off by default; an AbortError from a paused load is
  never a UI error (retry once).
- Scrub row: floating-ui thumb popup + TOC chapter markers with tooltips; text
  selection shows a floating-ui popup (bookmark / read from here / copy).
- Deps: `@floating-ui/dom`, `@wxt-dev/module-vue`, `@wxt-dev/auto-icons`
  (renders `assets/icon.svg` to the PNG sizes each store wants), `vitest`,
  `@playwright/test`, `jsdom` (pinned to v26 — jsdom 30 breaks vitest 5's
  environment setup), TS v5.

## Commands (`just` is truth; don't invent)

- `setup` (uv sync + bun install) · `server` :8000 · `ext` (wxt dev, opens a
  browser with the extension) · `dev` both
- `build` (`.output/chrome-mv3`) · `build-firefox` (`.output/firefox-mv3`) ·
  `zip` (store-ready archives for both)
- `check` (compileall + pytest + vitest + vue-tsc + build) · `e2e` (playwright
  against the built extension; first time: `bun x playwright install chromium`) ·
  `package` (PyInstaller onefile → `dist/reader(.exe)`)

## Tests

`tests/test_reader.py` — settings validation, the LRU (eviction, trim, clear),
the CORS allow-list, and the routes over a real HTTP client. Offline-safe: the
TTS service is never called.

`src/ui/test/` — vitest. `locate.test.ts` (sentence/word paints),
`mark.test.ts` (the highlight survives a re-rendered document), `player.test.ts`
(`ensureSentenceDoc` with a fake rendition), `selection.test.ts`
(read-from-here DOM-position resolution), `settings.test.ts` (voices, per-theme
highlight CSS, per-theme link CSS with a contrast check, speed clamp/persist,
server state), `serve.test.ts` (address
normalisation, probe, the download message, `reportDown`), `shelf.test.ts`
(fingerprint, LRU cap, and the promise that nothing book-shaped is stored),
`marks.test.ts` (bookmarks per book, newest first, the per-book cap, an evicted
book taking its bookmarks, and the promise that a bookmark is an index plus a
short excerpt). `test/blob.ts` shims `Blob.arrayBuffer()`, which jsdom lacks.

`src/ui/e2e/` — playwright against `.output/chrome-mv3` in a persistent
context. `extension.spec.ts`: the manifest asks for nothing it doesn't use; the
toolbar opens the reader; a missing server is reported honestly *and* play is
disabled; hiding the sidebar really does replace the chapter document and Reader
re-hooks the new one; a picked EPUB renders and leaves only a `shelf` entry;
the book is one continuous scroll (sections stacked, the wheel going both ways
with nothing to stop at, and a contents click landing on the chapter's own
anchor); a bookmark made from a selection is stored under the book's
fingerprint, listed in the sidebar, counted on the start screen — where the card
has no open button — and deleted along with the book. `server.spec.ts`: boots
the real `reader.py`, points the extension at it, presses play, and — with real
speech — checks the same highlighted sentence is still there after the sidebar
is hidden (skipped when the speech service is unreachable). Polls that inspect
a chapter frame must tolerate it being detached mid-re-render.

Because the book is one stack, several chapter documents are live at once:
`e2e/chapter.ts` holds the helpers that pick the one a test means
(`chapterFrames`, `proseFrame`, `frameWith`, `replacedFrame`). Two consequences
bite: a chapter's own `getBoundingClientRect()` is in *its* coordinates, so add
the iframe's offset to ask "is this on screen?"; and a re-render produces a new
frame object, so re-find it by its text rather than by position.

## Guidance

Flat modules, short Go-style names, full types on the TS boundary.
