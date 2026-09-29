# EPUB Reader — read your EPUB books aloud, in your browser

EPUB Reader is a browser extension that opens an `.epub` from your
computer, lets you read it comfortably, and reads it to you out loud with
word-by-word highlighting. Speech is made by a small helper on your own
machine — EPUB Reader is the only thing that ever sees your books, and it
forgets them the moment you close the tab.

## Get EPUB Reader

1. **Install the extension:**
   - **Firefox** — install from
     [addons.mozilla.org](https://addons.mozilla.org/en-US/firefox/addon/epub-reader-with-tts/).
   - **Chrome / Edge / Brave / Arc** — from the
     [releases page](https://github.com/raffleberry/reader/releases/latest):
     `chrome://extensions` → *Developer mode* on → *Load unpacked*
     (or drag the `.zip`'s contents there). Store links for other
     browsers coming soon.
2. **Download the speech helper** from the
   [releases page](https://github.com/raffleberry/reader/releases/latest)
   (Windows or Linux).
   It is one file. **Run it once** — a terminal shows the install
   step by step and says when it is done — and you never need to run
   it again: the browser starts it whenever you press play, and it
   quits on its own when you are done.
3. **Click EPUB Reader's toolbar button.** It opens a reader tab; choose an
   `.epub` and start reading.

Full walkthrough, troubleshooting and uninstall: [INSTALL.md](INSTALL.md).

Reading works without the helper. Only read-aloud needs it, and if it
isn't installed EPUB Reader says so plainly — with a link to download
it — wherever you would have expected to hear something.

## Your privacy comes first

- **Your books are never stored.** Not in the extension, not in your browser's
  database, not on disk. The file you pick is read into memory, read, and gone
  when you close the tab.
- **One small note is kept**, per book: the page you stopped on, the chapter,
  and the sentence being read — about 150 bytes, so EPUB Reader can put you back
  exactly where you were. No text, no cover, no file contents.
- **Bookmarks are the one text you keep**, and only the lines you marked
  yourself: a short excerpt, so the list still means something with the book
  closed, plus the sentence it points at. Deleting a book from the start screen
  deletes its bookmarks with it.
- **No account, no tracking, no analytics.** There is nothing to sign into and
  nothing phones home.
- **The helper only makes speech.** It receives the sentence being read, and
  nothing else: no book, no filename, no reading history. It keeps a cache of
  generated audio on your machine so a sentence is only ever spoken once.
- **Nothing else can use it.** There is no port and no address: the browser
  starts the helper itself over native messaging, so a random website can't
  spend your speech or read your cache.

## Features

**Open a book, forget it.** Choose an `.epub` (or drop it on the page). The
whole book opens as **one long scroll** — no page turns, and scrolling never
stops at a chapter edge — and it is never written anywhere.

**Pick up where you stopped.** Choose the same file again and EPUB Reader returns you
to the page, and pressing play continues from the sentence the voice was on, not
the top of the chapter. The start screen keeps a *recently read* list — the
chapter, how far you got, and how many bookmarks you left in each book. EPUB Reader
holds no copy of those books, so there is nothing to open from there: the list is
a record, and the only thing it can do is forget.

**Bookmarks.** Select a passage and mark it. The sidebar lists your bookmarks
for the open book, newest first; click one to jump to it. A bookmark belongs to
the file, not to the tab, so it is still there the next time you open that book —
even if you have renamed or moved it — and it goes when you delete the book from
the start screen.

**Comfortable reading.** Four themes (light, sepia, dark, Monokai) and adjustable
text size. EPUB Reader repaints every chapter for the theme you picked — its links
too, which are otherwise often a blue that disappears on a dark background. A
progress bar with a marker for every chapter sits along the bottom, and hovering
a marker tells you which chapter it is.

**Read-aloud with follow-along highlighting.** The chapter is read aloud in a
natural voice; the sentence lights up, then each word as it is spoken. Select
any passage and a small menu offers *bookmark*, *read from here* and *copy*.

**47 English voices.** Choose the voice you like best, starting with Ava
(default). Speech is generated the first time a sentence is heard and then
cached on your computer, so replaying it is instant.

**Playback speed.** Listen at half speed or up to twice as fast without the
voice changing pitch.

**Auto-scroll (optional).** Off by default; turn it on in Settings to have the
page follow the narration.

## A note on speech
Turning text into speech uses a free online voice service the first time each
sentence is heard, so that first listen needs internet. After that the audio is
cached on your computer (100 MB by default, adjustable in Settings) and replays
without a connection.

## Screenshots

![Library view](docs/Screenshot%202026-09-30%20at%2001-28-11%20EPUB%20Reader.png)
![Settings Panel](docs/Screenshot%202026-09-30%20at%2001-28-48%20EPUB%20Reader.png)
![Book View with text selection](docs/Screenshot%202026-09-30%20at%2001-29-59%20EPUB%20Reader.png)
![Read Aloud with text highlight](docs/Screenshot%202026-09-30%20at%2001-30-08%20EPUB%20Reader.png)

## Support

Need help, found a bug, or have an idea? Please
[open an issue](https://github.com/raffleberry/reader/issues) — that's the
fastest way to get support. Tell us what you were doing, what you expected,
and what happened (your browser + version help a lot).

## Source code

EPUB Reader is open source under the [MIT license](LICENSE). If you'd like to build it yourself or contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).
