import type { Frame, Page } from "@playwright/test";

/**
 * The book is one continuous scroll, so epub.js keeps several chapter
 * documents alive at once (the one being read, plus the ones either side of
 * it). Tests that need "the chapter" have to pick it out of that stack rather
 * than grabbing the first frame — a cover page is a document too, and it has
 * no prose in it.
 */

/** Every live chapter frame, in stack order. */
export function chapterFrames(page: Page): Frame[] {
  return page.frames().filter((f) => f !== page.mainFrame());
}

/** The first chapter frame that actually has prose in it. */
export async function proseFrame(page: Page): Promise<Frame | undefined> {
  const frames = chapterFrames(page);
  for (const frame of frames) {
    const paras = await frame.locator("p").count().catch(() => 0);
    if (paras > 0) return frame;
  }
  return frames[frames.length - 1];
}

/** The first chapter frame holding this text (falling back to any chapter). */
export async function frameWith(page: Page, text: string): Promise<Frame | undefined> {
  const frames = chapterFrames(page);
  for (const frame of frames) {
    const body = await frame.locator("body").textContent().catch(() => "");
    if (body?.includes(text)) return frame;
  }
  return proseFrame(page);
}

/**
 * The frame that took the place of `before` after epub.js re-rendered a
 * chapter. A re-render is a brand new frame object holding the same text, so
 * "not the old one" alone is not enough — the stack has other chapters in it.
 */
export async function replacedFrame(
  page: Page,
  before: Frame,
  text: string,
): Promise<Frame | undefined> {
  for (const frame of chapterFrames(page)) {
    if (frame === before) continue;
    const body = await frame.locator("body").textContent().catch(() => "");
    if (body?.includes(text)) return frame;
  }
  return undefined;
}
