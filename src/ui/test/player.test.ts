import { describe, expect, it, vi } from "vitest";
import { ensureSentenceDoc } from "../src/store/player";
import type { Sentence } from "../src/api/voice";
import type { BookRendition } from "../src/types";

/**
 * Read-aloud navigation (ensureSentenceDoc in src/store/player.ts): the
 * player must not redisplay when the sentence is already visible, must
 * display once on a chapter change, and must turn pages for sentences
 * further into a multi-page chapter. A fake rendition with real detached
 * chapter documents drives the real implementation.
 */

function docOf(html: string): Document {
  const d = document.implementation.createHTMLDocument("c");
  d.body.innerHTML = html;
  return d;
}

interface Nav {
  docText: string | null;
  displays: string[];
  nexts: number;
}

async function navigate(
  mode: "visible" | "chapter" | "multipage",
  probe: string,
): Promise<Nav> {
  const ch1 = docOf("<p>First chapter opens here. Still the first chapter.</p>");
  const ch2 = docOf("<p>Second chapter begins now. It continues a while.</p>");
  const pg1 = docOf("<p>Long chapter starts here. It goes on.</p>");
  const pg2 = docOf("<p>Long chapter ends here. That is all.</p>");

  const displays: string[] = [];
  let nexts = 0;
  // Visible docs; display() jumps to a chapter start, next() turns a page.
  let visible: Document[] = mode === "multipage" ? [pg1] : [ch1];
  const rendition = {
    display: async (href: string): Promise<void> => {
      displays.push(href);
      if (href === "ch2.xhtml") visible = [ch2];
      else if (href === "long.xhtml") visible = [pg1];
      else if (href === "ch1.xhtml") visible = [ch1];
    },
    next: async (): Promise<void> => {
      nexts++;
      if (visible[0] === pg1) visible = [pg2];
    },
    prev: async (): Promise<void> => undefined,
    resize: (): void => undefined,
    getContents: (): { document: Document }[] => visible.map((document) => ({ document })),
    hooks: { content: { register: (): void => undefined } },
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as BookRendition;

  const href =
    mode === "chapter" ? "ch2.xhtml" : mode === "multipage" ? "long.xhtml" : "ch1.xhtml";
  const sent: Sentence = { key: "k", chapter: 0, href, text: probe };
  const doc = await ensureSentenceDoc(rendition, sent, () => true);
  return { docText: doc ? (doc.body.textContent ?? "") : null, displays, nexts };
}

describe("ensureSentenceDoc", () => {
  it("does not redisplay when the sentence is already visible", async () => {
    const out = await navigate("visible", "First chapter opens here.");
    expect(out.docText).toContain("First chapter opens here.");
    expect(out.displays).toEqual([]);
    expect(out.nexts).toBe(0);
  });

  it("displays once on a chapter change", async () => {
    const out = await navigate("chapter", "Second chapter begins now.");
    expect(out.docText).toContain("Second chapter begins now.");
    expect(out.displays).toEqual(["ch2.xhtml"]);
    expect(out.nexts).toBe(0);
  });

  it("turns pages for a sentence later in the chapter", async () => {
    const out = await navigate("multipage", "Long chapter ends here.");
    expect(out.docText).toContain("Long chapter ends here.");
    expect(out.displays).toEqual(["long.xhtml"]);
    expect(out.nexts).toBe(1);
  });

  it("gives up without wandering when the sentence is nowhere", async () => {
    const out = await navigate("visible", "This sentence exists in no chapter at all, truly.");
    expect(out.docText).toBeNull();
    // One display attempt plus a bounded number of page turns, then stop.
    expect(out.displays).toEqual(["ch1.xhtml"]);
    expect(out.nexts).toBeLessThanOrEqual(10);
  });

  it("returns null with no rendition at all", async () => {
    const doc = await ensureSentenceDoc(null, { key: "k", chapter: 0, href: "a", text: "x" }, () => true);
    expect(doc).toBeNull();
  });
});
