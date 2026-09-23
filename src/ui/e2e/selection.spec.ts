import { test, expect } from "@playwright/test";

/**
 * Read-from-here resolution (sentenceIndexAtSelection in src/tts/locate.ts).
 * The sentence must come from the selection's DOM position, so a repeated
 * phrase maps to the occurrence actually selected — never the first match
 * above it. Tests build real Ranges in detached chapter documents.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

/** Resolve `probes` against a range starting at `marker` in `html`. */
async function resolve(
  page: import("@playwright/test").Page,
  html: string,
  probes: string[],
  marker: string,
  markerOccurrence = 0,
): Promise<number> {
  return page.evaluate(
    async ({ html, probes, marker, markerOccurrence }: {
      html: string;
      probes: string[];
      marker: string;
      markerOccurrence: number;
    }) => {
      const mod = await import("/src/tts/locate.ts");
      const doc = document.implementation.createHTMLDocument("c");
      doc.body.innerHTML = html;
      const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      let node = walker.nextNode();
      while (node) {
        texts.push(node as Text);
        node = walker.nextNode();
      }
      const full = texts.map((t) => t.data).join("");
      let seen = -1;
      let from = 0;
      for (let k = 0; k <= markerOccurrence; k++) {
        seen = full.indexOf(marker, from);
        if (seen < 0) throw new Error("marker not found");
        from = seen + 1;
      }
      // Map the concatenated offset back to a text node + offset.
      let rest = seen;
      let target: Text = texts[0];
      for (const t of texts) {
        if (rest <= t.data.length) {
          target = t;
          break;
        }
        rest -= t.data.length;
      }
      return mod.sentenceIndexAtSelection(doc, probes, target, rest);
    },
    { html, probes, marker, markerOccurrence },
  );
}

const PROBES = ["The king arrived.", "The court cheered.", "The king departed."];

test("a repeated phrase resolves to the selected occurrence", async ({ page }) => {
  // Reported bug: selecting "The king" in the third sentence played the
  // first sentence above it (text search returned the first match).
  const idx = await resolve(
    page,
    "<p>The king arrived. The court cheered. The king departed.</p>",
    PROBES,
    "The king",
    1,
  );
  expect(idx).toBe(2);
});

test("a first-occurrence selection resolves to the first sentence", async ({
  page,
}) => {
  const idx = await resolve(
    page,
    "<p>The king arrived. The court cheered. The king departed.</p>",
    PROBES,
    "The king",
    0,
  );
  expect(idx).toBe(0);
});

test("positions map across inline elements", async ({ page }) => {
  const idx = await resolve(
    page,
    "<p>The <b>king</b> arrived. The <i>king</i> departed.</p>",
    ["The king arrived.", "The king departed."],
    "departed",
  );
  expect(idx).toBe(1);
});

test("a selection before every sentence resolves to the first", async ({
  page,
}) => {
  const idx = await resolve(page, "<h1>Title</h1><p>Alpha beta. Gamma delta.</p>", ["Alpha beta.", "Gamma delta."], "Title");
  expect(idx).toBe(0);
});

test("returns -1 when no probe is in the document", async ({ page }) => {
  const idx = await resolve(page, "<p>Something else entirely.</p>", PROBES, "Something");
  expect(idx).toBe(-1);
});

test("returns -1 for a range outside the document", async ({ page }) => {
  const idx = await page.evaluate(async () => {
    const mod = await import("/src/tts/locate.ts");
    const doc = document.implementation.createHTMLDocument("c");
    doc.body.innerHTML = "<p>Alpha beta. Gamma delta.</p>";
    const other = document.implementation.createHTMLDocument("other");
    other.body.innerHTML = "<p>Gamma delta.</p>";
    const foreign = other.body.firstChild?.firstChild as Text;
    return mod.sentenceIndexAtSelection(doc, ["Alpha beta.", "Gamma delta."], foreign, 0);
  });
  expect(idx).toBe(-1);
});

test("placeSentences skips unfound probes and keeps order", async ({ page }) => {
  const placed = await page.evaluate(async () => {
    const mod = await import("/src/tts/locate.ts");
    const doc = document.implementation.createHTMLDocument("c");
    doc.body.innerHTML = "<p>Alpha beta. Gamma delta.</p>";
    return mod.placeSentences(mod.flatDoc(doc), ["Alpha beta.", "Missing sentence here.", "Gamma delta."]);
  });
  expect(placed.map((p: { index: number }) => p.index)).toEqual([0, 2]);
  expect(placed[0].at).toBeLessThan(placed[1].at);
});
