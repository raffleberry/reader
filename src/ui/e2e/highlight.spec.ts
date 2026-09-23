import { test, expect } from "@playwright/test";

/**
 * Sentence/word highlighting (src/tts/locate.ts) in a real Chromium DOM.
 * Each test imports the actual source module through the vite dev server
 * and works on a detached chapter document, isolated from the app itself.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

const CHAPTER = `<h1>Chapter One</h1><p id="p1">Hello brave new world. Second sentence here.</p><p id="p2">A final line.</p>`;

test("finds a sentence split across inline elements", async ({ page }) => {
  const text = await page.evaluate(async () => {
    const mod = await import("/src/tts/locate.ts");
    const doc = document.implementation.createHTMLDocument("c");
    doc.body.innerHTML = "<p>Hello <b>brave</b> <i>new</i> world. Done.</p>";
    return mod.findSentence(doc, "Hello brave new world.")?.range.toString() ?? null;
  });
  expect(text).toBe("Hello brave new world.");
});

test("finds a sentence across whitespace-only nodes", async ({ page }) => {
  // Regression: flatDoc used to drop whitespace-only text nodes, merging
  // "Hello" + " " + "world" into "Helloworld" so the sentence never matched.
  const text = await page.evaluate(async () => {
    const mod = await import("/src/tts/locate.ts");
    const doc = document.implementation.createHTMLDocument("c");
    doc.body.innerHTML = "<p>Hello<span> </span>world. Done.</p>";
    return mod.findSentence(doc, "Hello world.")?.range.toString() ?? null;
  });
  expect(text).toBe("Hello world.");
});

test("sentence paint then sequential word paints stay inside the sentence", async ({
  page,
}) => {
  const out = await page.evaluate(async (html: string) => {
    const mod = await import("/src/tts/locate.ts");
    const log: string[] = [];
    const doc = document.implementation.createHTMLDocument("c");
    doc.body.innerHTML = html;
    const before = doc.body.textContent;
    const ps = mod.paintSentence(doc, "Hello brave new world.", "tts-sent");
    if (!ps) return ["SENT_NOT_FOUND"];
    log.push("sent=" + JSON.stringify(ps.el.textContent));
    let cursor = 0;
    for (const word of ["Hello", "brave", "new", "world"]) {
      const pw = mod.paintWord(ps, word, cursor, "tts-word");
      const w = ps.el.querySelector(".tts-word");
      log.push(
        `${word}: painted=${pw !== null} text=${JSON.stringify(w?.textContent)} inside=${String(!!w && ps.el.contains(w))} sent-intact=${String(ps.el.textContent === "Hello brave new world.")}`,
      );
      if (pw) {
        cursor = pw.end;
        pw.unpaint();
      }
    }
    log.push("cursor-end=" + String(cursor));
    ps.unpaint();
    log.push("restored=" + String(doc.body.textContent === before));
    return log;
  }, CHAPTER);
  // "world" (no period) ends at 16 + 5 = 21.
  expect(out).toEqual([
    'sent="Hello brave new world."',
    "Hello: painted=true text=\"Hello\" inside=true sent-intact=true",
    "brave: painted=true text=\"brave\" inside=true sent-intact=true",
    "new: painted=true text=\"new\" inside=true sent-intact=true",
    "world: painted=true text=\"world\" inside=true sent-intact=true",
    "cursor-end=21",
    "restored=true",
  ]);
});

test("unfound words are skipped without moving the cursor", async ({ page }) => {
  const out = await page.evaluate(async () => {
    const mod = await import("/src/tts/locate.ts");
    const doc = document.implementation.createHTMLDocument("c");
    doc.body.innerHTML = "<p>Alpha beta gamma.</p>";
    const ps = mod.paintSentence(doc, "Alpha beta gamma.", "tts-sent");
    if (!ps) return ["SENT_NOT_FOUND"];
    // TTS boundary tokens (punctuation, em-dashes) have no DOM match.
    const missed = mod.paintWord(ps, "—", 0, "tts-word");
    const hit = mod.paintWord(ps, "beta", 0, "tts-word");
    const w = ps.el.querySelector(".tts-word");
    return [
      "missed=" + String(missed === null),
      "hit=" + String(hit !== null),
      "hit-end=" + String(hit?.end),
      "hit-text=" + JSON.stringify(w?.textContent),
    ];
  });
  // "Alpha beta gamma." -> "beta" starts at 6, ends at 10.
  expect(out).toEqual(["missed=true", "hit=true", "hit-end=10", 'hit-text="beta"']);
});

test("prefix fallback highlights the matching head when the tail differs", async ({
  page,
}) => {
  const out = await page.evaluate(async () => {
    const mod = await import("/src/tts/locate.ts");
    const doc = document.implementation.createHTMLDocument("c");
    doc.body.innerHTML = "<p>The quick brown fox jumps over the lazy cat. Next.</p>";
    const ps = mod.paintSentence(doc, "The quick brown fox jumps over the lazy dog.", "tts-sent");
    return ps ? ps.el.textContent?.trim() ?? null : null;
  });
  // Full probe absent ("dog" vs "cat"); the 40-char head matches, so it highlights.
  expect(out).toBe("The quick brown fox jumps over the lazy");
});

test("unpaint restores the original DOM text", async ({ page }) => {
  const restored = await page.evaluate(async (html: string) => {
    const mod = await import("/src/tts/locate.ts");
    const doc = document.implementation.createHTMLDocument("c");
    doc.body.innerHTML = html;
    const before = doc.body.textContent;
    const ps = mod.paintSentence(doc, "Second sentence here.", "tts-sent");
    if (!ps) return false;
    const pw = mod.paintWord(ps, "sentence", 0, "tts-word");
    pw?.unpaint();
    ps.unpaint();
    return doc.body.textContent === before;
  }, CHAPTER);
  expect(restored).toBe(true);
});

test("wordSpans skips unfound words without misaligning the rest", async ({
  page,
}) => {
  const spans = await page.evaluate(async () => {
    const mod = await import("/src/tts/locate.ts");
    return mod.wordSpans("Hello brave new world.", [
      { text: "Hello" },
      { text: "—" },
      { text: "brave" },
      { text: "new" },
      { text: "world." },
    ]);
  });
  expect(spans).toEqual([
    { start: 0, end: 5 },
    { start: 6, end: 11 },
    { start: 12, end: 15 },
    { start: 16, end: 22 },
  ]);
});
