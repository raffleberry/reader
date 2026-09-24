# Reader — your private EPUB library with read-aloud

Reader is a private place for your ebooks. It runs on your own computer, your books stay in your own browser, and nothing you read is ever uploaded, tracked, or synced anywhere. There is no account, no cloud, and no analytics.

## Get the app

Download the latest version for your computer — no installation needed, just run it:

**[Download Reader (Windows / Linux)](https://github.com/raffleberry/reader/releases/latest)**

When it starts, Reader opens in your browser automatically. Everything happens on your machine from there.

Just want a quick look? The online demo runs entirely in your browser — reading, themes, bookmarks, and the table of contents all work, but read-aloud needs the downloaded app. Wherever speech would play, the demo points you to the download above.

## Your privacy comes first

- **Your books stay in your browser.** Uploaded ebooks are stored in your browser's own local database (IndexedDB) on your device. They are never sent to any server.
- **No account, no tracking.** There is nothing to sign into and nothing phones home.
- **The server only makes speech.** The small program bundled with the app turns text into spoken audio when you press play. It keeps no record of your books or your reading.
- **Persistent storage, your call.** On first launch the app asks your permission to keep your library safely stored so the browser doesn't clear it. If you decline, the app won't run — rather than risk silently losing your books.

## Features

**Your library.** Add `.epub` files from your computer and they appear as cards in your library. Your reading position in each book is remembered, so reopening a book takes you right back to where you left off.

**Comfortable reading.** Books flow as one continuous page you scroll through — there are no fiddly page turns. Four themes (light, sepia, dark, and Monokai) and an adjustable text size let you set up exactly the look that's easy on your eyes, day or night.

**Table of contents.** Jump to any chapter from the sidebar. A progress bar at the bottom always shows where you are in the book, with markers for each chapter that you can hover and click.

**Read-aloud with follow-along highlighting.** Press play and the current chapter is read to you in a natural voice while the spoken sentence — and then each word as it sounds — lights up on the page. Great for accessibility, language learning, or just resting your eyes.

**47 English voices.** Choose the voice you like best, starting with the default (Ava). Speech is generated the first time a sentence is heard and then cached on your computer, so replaying it is instant — and works offline.

**Playback speed.** Listen slower or up to twice as fast without the voice changing pitch, from the Settings panel.

**Read from anywhere.** Select any passage in the book and a small menu lets you start listening from that exact sentence, save it as a bookmark, or copy the text.

**Bookmarks.** Save passages you want to come back to. Each bookmark jumps straight back to its place in the book with a brief flash so you can find it.

**Auto-scroll (optional).** If you like, the page can follow along with the narration automatically. It's off by default — turn it on in Settings.

**Mouse-wheel chapter turning.** Scrolling past the end of a chapter glides into the next one, with a small progress indicator. If the direction feels wrong on your mouse, flip it in Settings.

## A note on speech

Turning text into speech uses a free online voice service the first time each sentence is heard, so that first listen needs internet. After that, the audio is saved in a cache on your computer (up to 100 MB by default, adjustable in Settings) and replays fully offline.

## Help and source code

Reader is open source. If something isn't working or you have an idea, please [open an issue](https://github.com/raffleberry/reader/issues). If you'd like to build it yourself or contribute, see [CONTRIBUTING.md](CONTRIBUTING.md).
