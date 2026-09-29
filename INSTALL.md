# Installing EPUB Reader

EPUB Reader is two pieces that find each other on their own:

- **The extension** holds your books and does the reading. Reading works
  with this alone.
- **The speech helper** is a small app on your computer that turns text
  into speech. Only read-aloud needs it.

You set the helper up **once**. After that the browser starts it whenever
you press play, and it quits on its own when you are done — there is
nothing to keep running and nothing to configure.

## 1. Install the extension

- **Chrome / Edge / Brave / Arc** — install *EPUB Reader* from the
  [Chrome Web Store](https://chromewebstore.google.com/), or load it
  unpacked from the
  [releases page](https://github.com/raffleberry/reader/releases/latest):
  `chrome://extensions` → *Developer mode* on → *Load unpacked*.
- **Firefox** — install it from
  [Firefox Add-ons](https://addons.mozilla.org/), or Temporarily from the
  releases page: `about:debugging` → *This Firefox* → *Load Temporary
  Add-on* → pick `manifest.json`.

Click the toolbar button. It opens a reader tab; choose an `.epub` and
start reading. Reading works already — speech comes next.

## 2. Download the speech helper

From the same [releases page](https://github.com/raffleberry/reader/releases/latest),
download the helper for your computer:

- Windows: `epub-reader-windows-amd64.exe`
- Linux: `epub-reader-linux-amd64`

It is one file. Put it somewhere it can stay (for example your home
folder or `~/bin`) — the browser will look for it exactly where it is
now, so don't run it from Downloads and delete it later.

## 3. Run it once

Double-click it (or run it from a terminal). On its first run it:

1. installs itself as the browser's speech helper,
2. shows a small book icon in the system tray,
3. tells you it is installed — and that is the whole setup.

**You never need to run it again.** Leave the tray icon or quit it;
either way, pressing play in the reader starts the helper automatically
and it closes itself when the browser is done with it. If you move the
file later, just run it once more from its new home.

## Everyday use

- Press play on any sentence. The first time a sentence is heard it needs
  internet (a free voice service speaks it); afterwards the audio is
  cached on your computer and replays instantly — and offline.
- The reader badge says `speech ready` when the helper answers. If it
  says `no speech helper`, the page tells you where to get it.
- The tray icon is optional day to day: click it for a status note, or
  open its menu to reinstall the helper, clear cached speech, open the
  cache folder, or quit.

Voice, cache size, speed and the rest live in the reader's own settings
(the sidebar, or the extension's options page) — the helper has no
window of its own.

## Troubleshooting

**"No speech helper" after installing.** Run the helper once more (step
3) — installing is what that first run does. Then press *Retry* in the
reader. If it still says no, check the file hasn't moved since.

**Chrome loaded unpacked says no, but Firefox works.** Unpacked Chrome
extensions get a per-machine id, and the helper allow-lists the ids it
was told about at install time. Find the id on `chrome://extensions`,
then reinstall from a terminal:

```
epub-reader --install --extension-id PASTE_THE_ID_HERE
```

Store-installed EPUB Reader needs none of this: its id ships in the
helper already.

**Windows SmartScreen / macOS "unidentified developer".** The helper is
unsigned, so the first run may need an explicit allow: Windows →
*More info → Run anyway*; macOS → System Settings → Privacy & Security →
*Open Anyway* (or `xattr -d com.apple.quarantine epub-reader-…`).

**Linux tray icon missing.** The helper works without it (speech still
auto-starts), the icon just has nowhere to sit on some minimal
desktops. Everything else — including `--install` — works headless.

**One helper, several browsers.** Installing registers it for Chrome,
Edge, Brave, Chromium *and* Firefox at once. Run once, use anywhere.

## Uninstall

1. Run `epub-reader --uninstall` (removes the browser registration).
2. Delete the file.
3. Remove the extension from the browser.
4. Optionally delete cached speech and settings:
   - Linux: `~/.cache/epub-reader`, `~/.config/epub-reader`
   - macOS: `~/Library/Caches/epub-reader`, `~/Library/Application Support/epub-reader`
   - Windows: `%LOCALAPPDATA%\epub-reader`, `%APPDATA%\epub-reader`

## Privacy in one paragraph

Your books never leave the open tab and are gone when you close it. The
helper only ever receives the sentence being read — no book, no
filename, no history — and keeps its generated audio on your machine.
There is no port and no address: the browser starts the helper itself,
so no website can reach it. No account, no tracking, no analytics.
