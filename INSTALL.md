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

It is one file, and you can run it from anywhere: on its first run it
copies itself into its own folder and registers with the browsers, so
don't worry about where the download landed.

## 3. Run it once

Double-click it (or run it from a terminal). A terminal window walks
through the install:

1. where the helper file is kept,
2. every browser registration it writes (or leaves unchanged),
3. `Installed.` — and that is the whole setup.

**You never need to run it again.** Pressing play in the reader starts
the helper automatically and it closes itself when the browser is done
with it. Running it again later just re-installs (that is also how
updates work: download the new file, run it once).

## Everyday use

- Press play on any sentence. The first time a sentence is heard it needs
  internet (a free voice service speaks it); afterwards the audio is
  cached on your computer and replays instantly — and offline.
- The reader badge says `speech ready` when the helper answers. If it
  says `no speech helper`, the page tells you where to get it.

Voice, cache size, speed and the rest live in the reader's own settings
(the sidebar, or the extension's options page) — the helper has no
window of its own: running it just installs it and exits.

## Troubleshooting

**"No speech helper" after installing.** Run the helper once more (step
3) — installing is what that first run does — and read what the
terminal says: it names every registration it wrote. Then press
*Retry* in the reader.

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
*Open Anyway* (or `xattr -d com.apple.quarantine epub-reader-…*).

**One helper, several browsers.** Installing registers it for Chrome,
Edge, Brave, Chromium *and* Firefox at once. Run once, use anywhere.

## Uninstall

1. Run `epub-reader --uninstall` (removes the browser registration;
   the installed helper file is left in place — delete that folder too
   if you want everything gone).
2. Delete the download, if you still have it.
3. Remove the extension from the browser.
4. Optionally delete cached speech and settings:
   - Linux: `~/.cache/raffleberry.github.io/epub-reader`, `~/.config/raffleberry.github.io/epub-reader`
   - macOS: `~/Library/Caches/raffleberry.github.io/epub-reader`, `~/Library/Application Support/raffleberry.github.io/epub-reader`
   - Windows: `%LOCALAPPDATA%\raffleberry.github.io\epub-reader`, `%APPDATA%\raffleberry.github.io\epub-reader`

## Privacy in one paragraph

Your books never leave the open tab and are gone when you close it. The
helper only ever receives the sentence being read — no book, no
filename, no history — and keeps its generated audio on your machine.
There is no port and no address: the browser starts the helper itself,
so no website can reach it. No account, no tracking, no analytics.
