import { test, expect } from "@playwright/test";

/**
 * Read-aloud navigation (ensureSentenceDoc in src/store/player.ts): the
 * player must not redisplay when the sentence is already visible, must
 * display once on a chapter change, and must turn pages for sentences
 * further into a multi-page chapter. A fake rendition with real detached
 * chapter documents drives the real implementation in Chromium.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

interface NavResult {
  docText: string | null;
  displays: string[];
  nexts: number;
}

async function navigate(
  page: import("@playwright/test").Page,
  mode: "visible" | "chapter" | "multipage",
  probe: string,
): Promise<NavResult> {
  return page.evaluate(async ({ mode, probe }: { mode: string; probe: string }) => {
    const mod = await import("/src/store/player.ts");
    const docOf = (html: string): Document => {
      const d = document.implementation.createHTMLDocument("c");
      d.body.innerHTML = html;
      return d;
    };
    const ch1 = docOf("<p>First chapter opens here. Still the first chapter.</p>");
    const ch2 = docOf("<p>Second chapter begins now. It continues a while.</p>");
    const pg1 = docOf("<p>Long chapter starts here. It goes on.</p>");
    const pg2 = docOf("<p>Long chapter ends here. That is all.</p>");

    const displays: string[] = [];
    let nexts = 0;
    // Visible docs; display() jumps to a chapter start, next() turns a page.
    let visible: Document[] =
      mode === "multipage" ? [pg1] : mode === "chapter" ? [ch1] : [ch1];
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
      on: (): void => undefined,
      off: (): void => undefined,
    };
    const href = mode === "chapter" ? "ch2.xhtml" : mode === "multipage" ? "long.xhtml" : "ch1.xhtml";
    const doc = await mod.ensureSentenceDoc(rendition, { key: "k", chapter: 0, href, text: probe }, () => true);
    return {
      docText: doc ? (doc.body.textContent ?? "") : null,
      displays,
      nexts,
    };
  }, { mode, probe });
}

test("no redisplay when the sentence is already visible", async ({ page }) => {
  const out = await navigate(page, "visible", "First chapter opens here.");
  expect(out.docText).toContain("First chapter opens here.");
  expect(out.displays).toEqual([]);
  expect(out.nexts).toBe(0);
});

test("displays once on a chapter change", async ({ page }) => {
  const out = await navigate(page, "chapter", "Second chapter begins now.");
  expect(out.docText).toContain("Second chapter begins now.");
  expect(out.displays).toEqual(["ch2.xhtml"]);
  expect(out.nexts).toBe(0);
});

test("turns pages for a sentence later in the chapter", async ({ page }) => {
  const out = await navigate(page, "multipage", "Long chapter ends here.");
  expect(out.docText).toContain("Long chapter ends here.");
  expect(out.displays).toEqual(["long.xhtml"]);
  expect(out.nexts).toBe(1);
});

test("gives up without wandering when the sentence is nowhere", async ({
  page,
}) => {
  const out = await navigate(page, "visible", "This sentence exists in no chapter at all, truly.");
  expect(out.docText).toBeNull();
  // One display attempt plus a bounded number of page turns, then stop.
  expect(out.displays).toEqual(["ch1.xhtml"]);
  expect(out.nexts).toBeLessThanOrEqual(10);
});
