# Contributing to EPUB Reader

This guide covers the technical side: architecture, tooling, and tests. For the
user-facing overview, see [README.md](README.md); for the setup users follow,
see [INSTALL.md](INSTALL.md).

## Architecture

EPUB Reader is two halves that never share state:

- **The extension** (`extension/`) holds the book, renders it, and drives playback.
  It stores settings and one "where I was" note per book. Nothing else.
- **The helper** (`server/`, Go) turns text into audio. It is told the
  text of the sentence being read and nothing else — no book, no filename, no
  reading history.

The browser starts the helper over **native messaging** (`com.raffleberry.epubreader`)
whenever speech is needed, and the helper exits when the browser hangs up —
autostart and autoclose, with no port, no address and nothing to keep running.
If it isn't installed, that is a first-class state in the UI, not an error:
the reader says where to get it and links to [INSTALL.md](INSTALL.md).

- Extension: Vue 3 + Pinia (setup stores) + TypeScript (`<script setup>`),
  Bootstrap, **WXT** (Vite under the hood), `bun`. EPUBs render with
  `vue-reader` (epub.js).
- Helper: Go + [`edge-tts-go`](https://github.com/raffleberry/edge-tts-go) +
  [`gogpu/systray`](https://github.com/gogpu/systray) for the tray icon.
- Task runner: `just`. Go deps: `go mod`. JS deps: `bun`.

### Layout

```text
INSTALL.md          # the setup users follow: run once, then never again
extension/          # the browser extension (WXT root)
  wxt.config.ts     # srcDir: src, module-vue + auto-icons, generated manifest
  vitest.config.ts  # WxtVitest: unit tests with a working in-memory browser
  playwright.config.ts # e2e against the *built* extension + the real binary
  entrypoints/      # background.ts, reader/ (unlisted page), options/
  src/
    ext/            # settings.ts (storage items), serve.ts (native-messaging
                    # channel + probe + "download it" message), shelf.ts (last
                    # place), marks.ts (bookmarks)
    api/            # voice.ts + settings.ts (native calls, ServerDown)
    store/          # prefs (settings + helper state), reader (open book),
                    # player (read-aloud), sidecar
    views/          # OpenBook (start screen), Reader, Options
    components/     # Sidecar, ReaderBar, ServerBadge, RecentCard, TocList,
                    # BookmarksPanel, SettingsPanel
    tts/            # locate.ts (sentence→DOM), mark.ts (the live highlight),
                    # cfi.ts (spine positions), sound.ts (the audio element)
    text/epub.ts    # zip → sentences
    assets/         # app.css (palette + chrome), icon.svg (base for PNGs)
  test/             # vitest specs
  e2e/              # playwright specs (built extension + the real helper)
  fixtures/         # sample.epub, used by the e2e tests
server/             # the speech helper (Go module)
  main.go           # flags + mode dispatch (tray vs native host vs install)
  native.go         # length-prefixed stdio loop + method dispatch
  tts.go            # edge-tts synthesis + cached ensure()
  cache.go          # bounded on-disk MP3+timings LRU
  settings.go       # validated JSON settings in the system config dir
  install.go        # manifest install/uninstall for every browser
  tray.go           # systray icon: auto-install on first run, cache menu
```

### Helper (`server/`)

- **Modes.** One binary, three jobs: default launch with a terminal goes to
  the tray (and installs the native-messaging manifest on first run);
  launched by the browser (stdin is a pipe, or `--native-host`) it serves
  one native-messaging session on stdin/stdout until EOF and exits;
  `--install` / `--uninstall` only (un)register and exit. `--tray` forces
  tray mode; `--extension-id ID` (repeatable, or
  `EPUB_READER_EXTENSION_IDS`) authorises extra Chrome unpacked ids.
- **Protocol.** 4-byte little-endian length + JSON. Request
  `{"id":1,"method":"speak","params":{"text":"…"}}`; response
  `{"id":1,"ok":true,"result":{…}}` or `{"id":1,"ok":false,"error":"…"}}`.
  Methods: `ping` (`{ok, version}` — the extension's liveness probe),
  `getSettings` / `putSettings`, `cacheStats` / `clearCache`,
  `speak {text, voice?}` (base64 MP3 + words), `ttsWords {text, voice?}`,
  `prefetch {texts}` (first 20, junk skipped, warmed in background).
  Speech failure surfaces as `ok:false` (never silence).
- **`Lru`** is a bounded on-disk cache of MP3 + word timings, keyed
  `sha1(voice + text)` so identical sentences share an entry across books.
  `saveSettings()` re-trims it when the size cap changes.
- **Dirs:** `~/.cache/epub-reader/tts`, `~/.config/epub-reader/settings.json`
  (Linux; OS cache/config dirs elsewhere). Overridable for tests with
  `EPUB_READER_CACHE_DIR` / `EPUB_READER_CONFIG_FILE`.
- **Install** writes `com.raffleberry.epubreader.json` into every
  Chromium profile dir + Firefox's hosts dir (plus the registry on
  Windows), pointing at the running executable — so moving the file means
  running it once more. The manifest allow-lists Firefox's stable add-on
  id; Chrome unpacked ids come from `--extension-id`.

### Extension (`extension/`, WXT)

- `srcDir: "src"`, so `entrypoints/` sits next to `views/`, `components/` and
  `store/`. Auto-imports are **off** (`imports: false`): this codebase imports
  everything explicitly.
- The manifest is generated in `wxt.config.ts`: `storage` + `nativeMessaging`
  permissions, an `action` with no popup, `options_ui`, and — for Firefox —
  a gecko id and `data_collection_permissions`. There are deliberately **no**
  `host_permissions`: speech is not HTTP any more. Firefox is built with
  `--mv3` (WXT defaults Firefox to MV2).
- `entrypoints/background.ts`: the toolbar button opens `/reader.html`, or
  focuses the tab it opened last (tracked in **session** storage, forgotten on
  `tabs.onRemoved`, so a recycled tab id can't hijack a click). No `tabs`
  permission is requested.
- **Storage is `wxt/utils/storage`**, never `localStorage`:
  - `ext/settings.ts` defines one item per preference (there is no server
    address to keep any more).
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
- `ext/serve.ts` owns the helper channel: one persistent `connectNative`
  port, request ids routed to waiters, `probe()` (never throws),
  `downMessage()` / `ServerDown`, and `onServerDown`/`reportDown` so a spawn
  that never connected marks the helper down immediately. It prefers the
  page's `chrome`/`browser` globals (which is also what lets the tests fake
  the helper by stubbing the `chrome` global) and falls back to WXT's
  `browser`. The UI shows the state in three places: a `ServerBadge` in the
  reader bar, a dismissible banner over the book, and the player-error row.
  `player.start` probes first, and play/resume are **disabled** while it is
  down — so pressing play with no helper says so instead of failing on a
  call. `prefs.watchServer()` pings every 15 s while the tab is visible, so
  a helper that dies mid-session is noticed even if you aren't speaking yet.
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

- `setup` (go mod download + bun install) · `server` (tray) ·
  `host-install [ID]` (register the helper for dev) · `ext` / `ext-firefox`
  (wxt dev, opens a browser with the extension)
- `build` (`.output/chrome-mv3`) · `build-firefox` (`.output/firefox-mv3`) ·
  `zip` (store-ready archives for both)
- `check` (go vet + go test + vitest + vue-tsc + build) · `e2e` (playwright
  against the built extension + the real binary; first time:
  `bun x playwright install chromium`) · `package` (go build →
  `dist/epub-reader`) · `package-all` (linux + windows)

## Tests

`server/*_test.go` — settings validation, the LRU (eviction, trim, clear),
the native framing and method dispatch over pinned temp dirs.
Offline-safe: the speech service is never called.

`extension/test/` — vitest. `locate.test.ts` (sentence/word paints),
`mark.test.ts` (the highlight survives a re-rendered document), `player.test.ts`
(`ensureSentenceDoc` with a fake rendition), `selection.test.ts`
(read-from-here DOM-position resolution), `settings.test.ts` (voices, per-theme
highlight CSS, per-theme link CSS with a contrast check, speed clamp/persist,
helper state via a stubbed `chrome.runtime.connectNative`), `serve.test.ts`
(the native channel: routing, shared port, helper errors, `ServerDown`,
`reportDown`), `shelf.test.ts`
(fingerprint, LRU cap, and the promise that nothing book-shaped is stored),
`marks.test.ts` (bookmarks per book, newest first, the per-book cap, an evicted
book taking its bookmarks, and the promise that a bookmark is an index plus a
short excerpt). `test/blob.ts` shims `Blob.arrayBuffer()`, which jsdom lacks.

`extension/e2e/` — playwright against `.output/chrome-mv3` in a persistent
context. `extension.spec.ts`: the manifest asks for nothing it doesn't use
(`storage` + `nativeMessaging`, no host permissions); the toolbar opens the
reader; a missing helper is reported honestly *and* play is disabled; hiding
the sidebar really does replace the chapter document and Reader re-hooks the
new one; a picked EPUB renders and leaves only a `shelf` entry; the book is
one continuous scroll; a bookmark made from a selection is stored under the
book's fingerprint, listed in the sidebar, counted on the start screen and
deleted along with the book. `server.spec.ts`: builds the real Go binary and
talks the framed native protocol at it (ping, settings round-trip, speech
validation, prefetch + cache stats) — skipped without a Go toolchain.
Because the book is one stack, several chapter documents are live at once:
`e2e/chapter.ts` holds the helpers that pick the one a test means
(`chapterFrames`, `proseFrame`, `frameWith`, `replacedFrame`).

## Guidance

Flat modules, short Go-style names, full types on the TS boundary.
