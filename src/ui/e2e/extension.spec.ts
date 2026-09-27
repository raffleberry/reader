import { chromium, test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { BrowserContext } from "@playwright/test";
import { chapterFrames, frameWith, proseFrame, replacedFrame } from "./chapter";

/**
 * The extension as a user meets it: a toolbar button that opens a reader tab,
 * a start screen that opens a real EPUB, and an honest answer when the
 * speech server isn't running. Chromium loads the built MV3 output, so the
 * manifest and the content-security policy are the shipped ones.
 */

const EXT = new URL("../.output/chrome-mv3", import.meta.url).pathname;
const FIXTURE = new URL("../fixtures/sample.epub", import.meta.url).pathname;

const manifest = JSON.parse(readFileSync(`${EXT}/manifest.json`, "utf8"));

/** A context with the extension loaded, plus its id. */
async function withReader(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const context = await chromium.launchPersistentContext("", {
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  // The service worker only starts once the extension has something to do;
  // its URL is the one place the generated id shows up.
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 20_000 });
  const extensionId = new URL(worker.url()).host;
  return { context, extensionId };
}


test.describe.configure({ mode: "serial" });

test("manifest asks for nothing it doesn't use", () => {
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toEqual(["storage"]);
  // Loopback only: we speak to a server on the user's own machine.
  expect(manifest.host_permissions).toEqual(["http://127.0.0.1/*", "http://localhost/*"]);
  // No content scripts, no web-accessible resources, no broad host access.
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.web_accessible_resources).toBeUndefined();
  expect(manifest.host_permissions).not.toContain("<all_urls>");
});

test("the toolbar button opens the reader", async () => {
  const { context, extensionId } = await withReader();
  try {
    // What background.ts does on action.onClicked.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/reader.html`);
    await expect(page.getByRole("heading", { name: "Reader", exact: true })).toBeVisible();
    await expect(page.getByText("Choose an EPUB")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("the start screen says so when the server is missing", async () => {
  const { context, extensionId } = await withReader();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/reader.html`);
    // Nothing is listening on 8000 in CI, so the badge must say so and
    // offer the download rather than failing quietly.
    const badge = page.locator(".server-badge");
    await expect(badge).toHaveClass(/down/, { timeout: 15_000 });
    await expect(badge).toContainText("no speech server");
    await expect(page.getByRole("link", { name: /Download the Reader server/i })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("hiding the sidebar re-renders the chapter, and Reader re-hooks it", async () => {
  // Reported bug: collapsing the sidebar resized the frame, epub.js threw the
  // chapter document away and re-rendered it — taking every highlight with it.
  // The fix re-applies the highlight in the content hook, so this checks the
  // two halves of that: that the document really is replaced, and that our
  // hook runs on the replacement.
  const { context, extensionId } = await withReader();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/reader.html`);
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.locator(".reader-frame iframe").first()).toBeVisible({ timeout: 30_000 });
    // The prose chapter, not the cover: the book is one continuous stack.
    await expect.poll(async () => (await proseFrame(page)) !== undefined, { timeout: 20_000 }).toBe(true);

    // Mark the live document, so we can tell it was replaced.
    const before = await proseFrame(page);
    expect(before).toBeDefined();
    await before!.evaluate(() => {
      (window as unknown as { __readerProbe?: number }).__readerProbe = 1;
    });

    await page.getByTitle("Hide sidebar").click();
    await expect(page.locator(".sidecar.collapsed")).toBeVisible();

    // A brand new document, and Reader's own page styling applied to it.
    await expect
      .poll(
        async () => {
          // The frame is a new object after the re-render, so find it again —
          // by its text, since the stack holds the other chapters too.
          const frame = await replacedFrame(page, before!, "Project Gutenberg");
          if (!frame) return "no frame";
          // epub.js destroys the old iframe before the new one exists, so the
          // frame can vanish under us mid-poll; that is just "not yet".
          try {
            const probe = await frame.evaluate(
              () => (window as unknown as { __readerProbe?: number }).__readerProbe ?? 0,
            );
            const styled = await frame.evaluate(() => {
              const style = document.getElementById("reader-page-style");
              return !!style && style.textContent.includes(".tts-sent");
            });
            return probe === 0 && styled ? "re-hooked" : `probe=${probe} styled=${styled}`;
          } catch {
            return "detached";
          }
        },
        { timeout: 15_000 },
      )
      .toBe("re-hooked");
  } finally {
    await context.close();
  }
});

test("a picked EPUB opens and renders, and only the place is kept", async () => {
  const { context, extensionId } = await withReader();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/reader.html`);
    await page.setInputFiles('input[type="file"]', FIXTURE);

    // The book renders inside the viewer iframe.
    await expect(page.locator(".reader-frame iframe").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".reader-frame")).toContainText(/\w/, { timeout: 30_000 });

    // The only thing in storage is a note about where we were. The write is
    // debounced (a scroll fires a burst of page turns), so wait for it.
    await expect
      .poll(async () => (await page.evaluate(() => browser.storage.local.get(null))), {
        timeout: 15_000,
      })
      .toMatchObject({ shelf: [{ place: { cfi: expect.stringMatching(/^epubcfi/) } }] });

    const stored = await page.evaluate(() => browser.storage.local.get(null));
    expect(Object.keys(stored).sort()).toEqual(["shelf"]);
    // No book bytes, no sentences, no blob: just the place.
    expect(JSON.stringify(stored).length).toBeLessThan(2000);

    // No speech server in CI, so play must be disabled rather than offering
    // a press that can only fail.
    const play = page.locator(".play-group .btn-success");
    await expect(play).toBeDisabled({ timeout: 15_000 });
    await expect(play).toHaveAttribute("title", /needs the Reader server/);
  } finally {
    await context.close();
  }
});

test("the book is one continuous scroll, and the contents jump to a chapter", async () => {
  // The reader's default: no chapter edges, no overscroll pill — the wheel
  // just keeps going, and epub.js stacks the next section as it is reached.
  const { context, extensionId } = await withReader();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/reader.html`);
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.locator(".reader-frame iframe").first()).toBeVisible({ timeout: 30_000 });

    /** Where the book is: how many sections are stacked, and how far down. */
    const scroll = async (): Promise<{ views: number; top: number; height: number; page: string }> => {
      const at = await page.evaluate(() => {
        const el = document.querySelector(".epub-container") as HTMLElement;
        return {
          views: el.querySelectorAll(".epub-view").length,
          top: Math.round(el.scrollTop),
          height: el.scrollHeight,
          page: document.querySelector(".page-count")?.textContent?.trim() ?? "",
        };
      });
      return at;
    };

    // The stack is primed before the reader has touched anything: the cover
    // and the first chapter are one scroll, not two.
    await expect.poll(async () => (await scroll()).views, { timeout: 20_000 }).toBeGreaterThan(1);
    const start = await scroll();
    expect(start.height).toBeGreaterThan(2000);
    // Nothing to push against any more: the chapter-edge pill is gone.
    await expect(page.locator(".over-ind")).toHaveCount(0);

    // Wheel down: the book just keeps going, deep into itself.
    for (let i = 0; i < 12; i++) {
      await page.mouse.move(700, 400);
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(120);
    }
    await expect.poll(async () => (await scroll()).top, { timeout: 20_000 }).toBeGreaterThan(10_000);
    const deep = await scroll();
    expect(deep.page).not.toBe(start.page);

    // And back up to the very top, with no edge to stop at.
    for (let i = 0; i < 20; i++) {
      await page.mouse.move(700, 400);
      await page.mouse.wheel(0, -3000);
      await page.waitForTimeout(100);
    }
    await expect.poll(async () => (await scroll()).top, { timeout: 20_000 }).toBe(0);

    // The contents still work: clicking a chapter puts that heading at the
    // top of the book, in one continuous scroll.
    await page.locator(".sidecar-head").getByTitle("Table of contents").click();
    const labels = await page.locator(".sidecar-body nav button").allTextContents();
    const wanted = labels.findIndex((l) => /CHAPTER 30\./i.test(l));
    expect(wanted).toBeGreaterThan(0);
    await page.locator(".sidecar-body nav button").nth(wanted).click();

    // The chapter's own anchor lands in view. A chapter document is as tall as
    // the chapter, so its own coordinates say nothing: add the iframe's
    // position (the same mapping the selection popup uses) to get viewport
    // coordinates, and require the heading to be on screen.
    await expect
      .poll(
        async () => {
          const frame = await frameWith(page, "CHAPTER 30.");
          const at = await frame
            ?.locator("text=CHAPTER 30.")
            .first()
            .evaluate((el) => {
              const rect = el.getBoundingClientRect();
              const frame = (window.frameElement as HTMLElement | null)?.getBoundingClientRect();
              return frame ? Math.round(rect.top + frame.top) : NaN;
            })
            .catch(() => NaN);
          return typeof at === "number" && at >= 0 && at < 700 ? at : NaN;
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThanOrEqual(0);
    // And the reader agrees it moved: the note in the bar is deep in the book.
    expect(Number((await scroll()).page.split("/")[0].trim())).toBeGreaterThan(100);
  } finally {
    await context.close();
  }
});

test("a bookmark is filed under the book, listed, and deleted with it", async () => {
  // The one thing Reader keeps that isn't a note to itself: an excerpt the
  // reader chose to keep. It has to be reachable from the sidebar, counted on
  // the start screen, and gone the moment the book is deleted from there.
  const { context, extensionId } = await withReader();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/reader.html`);
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect(page.locator(".reader-frame iframe").first()).toBeVisible({ timeout: 30_000 });

    // The book opens on its cover, which has no text to select: go to the
    // first chapter through the contents list.
    await page.locator(".sidecar-head").getByTitle("Table of contents").click();
    await page.locator(".sidecar-body nav button").first().click();
    const chapter = page.frameLocator(".reader-frame iframe").nth(1);
    await expect.poll(async () => chapter.locator("p").count(), { timeout: 20_000 }).toBeGreaterThan(0);

    // Tag a paragraph that is genuinely on screen. A chapter is one long
    // scrolled document inside a tall iframe, so "the first <p>" is usually
    // text scrolled out of view — and the selection menu, which is placed
    // from the selection's own coordinates, would land off screen with it.
    const view = await page.locator(".reader-frame").boundingBox();
    expect(view).not.toBeNull();
    await chapter.locator("body").evaluate((body, box) => {
      const doc = body.ownerDocument;
      const off = (doc.defaultView?.frameElement as HTMLElement).getBoundingClientRect().top;
      const best = [...body.querySelectorAll("p")]
        .map((p) => ({ p, r: p.getBoundingClientRect(), len: (p.textContent ?? "").trim().length }))
        .filter(
          ({ r, len }) =>
            len > 30 && r.height > 8 && r.top + off > box.y + 30 && r.bottom + off < box.y + box.height - 120,
        )
        .sort((a, b) => b.r.height - a.r.height)[0];
      if (!best) throw new Error("no on-screen paragraph to select");
      best.p.id = "e2e-passage";
    }, view!);
    const passage = chapter.locator("#e2e-passage");
    await passage.selectText();
    await passage.dispatchEvent("mouseup");

    // The selection menu is the only place a bookmark is made.
    await page.getByTitle("Bookmark this passage").click();
    await expect(page.locator(".book-note")).toHaveText("Bookmarked");

    // Stored as a sentence index and a short excerpt, filed under the
    // fingerprint of the file the bookmark was made in.
    await expect
      .poll(async () => (await page.evaluate(() => browser.storage.local.get(null))), {
        timeout: 15_000,
      })
      .toMatchObject({
        shelf: [{ id: expect.any(String) }],
        marks: [{ sent: expect.any(Number), text: expect.stringMatching(/\w/) }],
      });
    const stored = (await page.evaluate(() => browser.storage.local.get(null))) as {
      shelf: { id: string }[];
      marks: { book: string; text: string }[];
    };
    expect(stored.marks).toHaveLength(1);
    expect(stored.marks[0].book).toBe(stored.shelf[0].id);
    expect(stored.marks[0].text.length).toBeLessThanOrEqual(140);

    // The sidebar lists it while the book is open, and clicking it jumps to
    // the sentence and flashes it.
    await page.locator(".sidecar-head").getByTitle("Bookmarks").click();
    const row = page.locator(".sidecar-body nav > div");
    await expect(row).toHaveCount(1);
    await row.locator("button").first().click();
    const shown = async (): Promise<number> => {
      let n = 0;
      for (const frame of chapterFrames(page)) {
        n += await frame.locator(".tts-sent").count().catch(() => 0);
      }
      return n;
    };
    await expect.poll(shown, { timeout: 10_000 }).toBeGreaterThan(0);

    // Closing the book leaves a list, not a library: a note, a progress bar
    // and a bookmark count — with nothing on the card that opens a book.
    await page.getByTitle("Open a different book").click();
    const card = page.locator(".book-card").first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Recently read" })).toBeVisible();
    await expect(card).toContainText("🔖 1");
    await expect(card.locator(".btn-outline-secondary")).toHaveCount(0);

    // The one control on the card deletes every trace of the document.
    page.once("dialog", (d) => void d.accept());
    await card.locator("button").click();
    await expect(page.getByRole("heading", { name: "Recently read" })).toBeHidden();
    const left = await page.evaluate(() => browser.storage.local.get(null));
    expect(left.shelf).toEqual([]);
    expect(left.marks).toEqual([]);
  } finally {
    await context.close();
  }
});
