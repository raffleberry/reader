import { chromium, test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { BrowserContext } from "@playwright/test";
import { chapterFrames, frameWith, proseFrame } from "./chapter";

/**
 * The extension as a user meets it: a toolbar button that opens a reader tab,
 * a start screen that opens a real EPUB, and an honest answer when the
 * speech server isn't running. Chromium loads the built MV3 output, so the
 * manifest and the content-security policy are the shipped ones.
 *
 * The viewer (foliate-js paginator) renders one section document at a time
 * inside a closed shadow root, so tests find the book through the frame
 * objects (page.frames) rather than CSS selectors, which stop at the shadow
 * boundary.
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
  // Storage for settings, nativeMessaging for the speech helper the browser
  // starts on demand. No ports, no addresses, no website can reach it.
  expect(manifest.permissions).toEqual(["storage", "nativeMessaging"]);
  expect(manifest.host_permissions).toBeUndefined();
  // No content scripts, no web-accessible resources, no broad host access.
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.web_accessible_resources).toBeUndefined();
});

test("the toolbar button opens the reader", async () => {
  const { context, extensionId } = await withReader();
  try {
    // What background.ts does on action.onClicked.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/reader.html`);
    await expect(page.getByRole("heading", { name: "EPUB Reader", exact: true })).toBeVisible();
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
    // No helper installed in CI, so the badge must say so and
    // offer the download rather than failing quietly.
    const badge = page.locator(".server-badge");
    await expect(badge).toHaveClass(/down/, { timeout: 15_000 });
    await expect(badge).toContainText("no speech helper");
    await expect(page.getByRole("link", { name: /Download the speech helper/i })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("hiding the sidebar keeps the highlight on the page", async () => {
  // Reported bug under the old viewer: collapsing the sidebar resized the
  // frame, the chapter document was thrown away and re-rendered, taking
  // every highlight with it. The foliate viewer re-lays out the same
  // document instead, so a highlight must survive the toggle.
  const { context, extensionId } = await withReader();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/reader.html`);
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect.poll(async () => (await proseFrame(page)) !== undefined, { timeout: 30_000 }).toBe(true);

    // The book opens on its cover, which has no text to select: go to the
    // first chapter through the contents list.
    await page.locator(".sidecar-head").getByTitle("Table of contents").click();
    await page.locator(".sidecar-body nav button", { hasText: /CHAPTER 1\./i }).click();
    let frame = await frameWith(page, "Call me Ishmael");
    await expect
      .poll(
        async () => {
          frame = await frameWith(page, "Call me Ishmael");
          return frame?.locator("p").count().catch(() => 0) ?? 0;
        },
        { timeout: 20_000 },
      )
      .toBeGreaterThan(0);

    // Paint a highlight the way a bookmark jump does, then toggle.
    const text = await frame!.evaluate(() => {
      const p = [...document.querySelectorAll("p")].find((el) =>
        (el.textContent ?? "").includes("Call me Ishmael"),
      );
      if (!p || !p.firstChild) throw new Error("no passage to highlight");
      const range = document.createRange();
      range.selectNodeContents(p);
      const span = document.createElement("span");
      span.className = "tts-sent";
      span.id = "e2e-flash";
      span.appendChild(range.extractContents());
      range.insertNode(span);
      return span.textContent ?? "";
    });
    expect(text).toContain("Call me Ishmael");

    await page.getByTitle("Hide sidebar").click();
    await expect(page.locator(".sidecar.collapsed")).toBeVisible();

    // Same document, same highlight: nothing was thrown away.
    const kept = await frame!.evaluate(
      () => document.getElementById("e2e-flash")?.textContent ?? "",
    );
    expect(kept).toContain("Call me Ishmael");
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

    // The book renders inside the viewer section document, and the bar
    // learns its page count from the first relocation.
    await expect.poll(async () => (await proseFrame(page)) !== undefined, { timeout: 30_000 }).toBe(true);
    await expect(page.locator(".page-count")).not.toHaveText("–", { timeout: 30_000 });

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

    // No speech helper in CI, so play must be disabled rather than offering
    // a press that can only fail.
    const play = page.locator(".play-group .btn-success");
    await expect(play).toBeDisabled({ timeout: 15_000 });
    await expect(play).toHaveAttribute("title", /needs the speech helper/);
  } finally {
    await context.close();
  }
});

test("one section scrolls, and the contents jump to a chapter", async () => {
  // The reader shows one scrolling section at a time; moving between
  // sections is explicit (TOC, scrubber, bookmarks, narration).
  const { context, extensionId } = await withReader();
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/reader.html`);
    await page.setInputFiles('input[type="file"]', FIXTURE);
    await expect.poll(async () => (await proseFrame(page)) !== undefined, { timeout: 30_000 }).toBe(true);

    // Exactly one section document is alive — the old stack is gone.
    await expect.poll(async () => chapterFrames(page).length, { timeout: 20_000 }).toBe(1);
    const start = await page.locator(".page-count").textContent();

    // The contents still work: clicking a chapter shows its heading.
    await page.locator(".sidecar-head").getByTitle("Table of contents").click();
    const labels = await page.locator(".sidecar-body nav button").allTextContents();
    const wanted = labels.findIndex((l) => /CHAPTER 30\./i.test(l));
    expect(wanted).toBeGreaterThan(0);
    await page.locator(".sidecar-body nav button").nth(wanted).click();

    // The chapter's own heading lands on screen. Its document coordinates
    // say nothing about the viewport, so add the iframe's offset.
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
    const pageNow = await page.locator(".page-count").textContent();
    expect(pageNow).not.toBe(start);
    expect(Number(pageNow!.split("/")[0].trim())).toBeGreaterThan(1);
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
    await expect.poll(async () => (await proseFrame(page)) !== undefined, { timeout: 30_000 }).toBe(true);

    // The book opens on its cover, which has no text to select: go to the
    // first chapter through the contents list.
    await page.locator(".sidecar-head").getByTitle("Table of contents").click();
    await page.locator(".sidecar-body nav button", { hasText: /CHAPTER 1\./i }).click();
    const frame = await frameWith(page, "Call me Ishmael");
    expect(frame).toBeDefined();
    await expect
      .poll(async () => (await frameWith(page, "Call me Ishmael"))?.locator("p").count().catch(() => 0) ?? 0, { timeout: 20_000 })
      .toBeGreaterThan(0);
    const live = await frameWith(page, "Call me Ishmael");

    // Tag a paragraph that is genuinely on screen. A section is one long
    // scrolled document inside a tall iframe, so "the first <p>" is usually
    // text scrolled out of view — and the selection menu, which is placed
    // from the selection's own coordinates, would land off screen with it.
    const view = await page.locator(".reader-frame").boundingBox();
    expect(view).not.toBeNull();
    await live!.locator("body").evaluate((body, box) => {
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
    const passage = live!.locator("#e2e-passage");
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
