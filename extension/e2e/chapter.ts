import type { Frame, Page } from "@playwright/test";

/**
 * The viewer keeps exactly one section document alive at a time (the
 * paginator unloads the old section on every move), so "the chapter" is
 * whichever non-main frame has prose in it — a cover section is a document
 * too, and it has no prose.
 */

/** Every live section frame. */
export function chapterFrames(page: Page): Frame[] {
  return page.frames().filter((f) => f !== page.mainFrame());
}

/** The first section frame that actually has prose in it. */
export async function proseFrame(page: Page): Promise<Frame | undefined> {
  const frames = chapterFrames(page);
  for (const frame of frames) {
    const paras = await frame.locator("p").count().catch(() => 0);
    if (paras > 0) return frame;
  }
  return frames[frames.length - 1];
}

/** The first section frame holding this text (falling back to any chapter). */
export async function frameWith(page: Page, text: string): Promise<Frame | undefined> {
  const frames = chapterFrames(page);
  for (const frame of frames) {
    const body = await frame.locator("body").textContent().catch(() => "");
    if (body?.includes(text)) return frame;
  }
  return proseFrame(page);
}
