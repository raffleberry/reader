import { describe, expect, it } from "vitest";
import { findSentence, flatDoc, paintSentence, paintWord, wordSpans } from "../src/tts/locate";

/**
 * Sentence/word highlighting (src/tts/locate.ts) against a real DOM. Each
 * test works on a detached chapter document, isolated from the app itself.
 */

const CHAPTER = `<h1>Chapter One</h1><p id="p1">Hello brave new world. Second sentence here.</p><p id="p2">A final line.</p>`;

function chapter(html: string): Document {
  const doc = document.implementation.createHTMLDocument("c");
  doc.body.innerHTML = html;
  return doc;
}

describe("findSentence", () => {
  it("finds a sentence split across inline elements", () => {
    const doc = chapter("<p>Hello <b>brave</b> <i>new</i> world. Done.</p>");
    expect(findSentence(doc, "Hello brave new world.")?.range.toString()).toBe(
      "Hello brave new world.",
    );
  });

  it("finds a sentence across whitespace-only nodes", () => {
    // Regression: flatDoc used to drop whitespace-only text nodes, merging
    // "Hello" + " " + "world" into "Helloworld" so the sentence never matched.
    const doc = chapter("<p>Hello<span> </span>world. Done.</p>");
    expect(findSentence(doc, "Hello world.")?.range.toString()).toBe("Hello world.");
  });
});

describe("flatDoc", () => {
  it("keeps whitespace-only nodes so words never merge", () => {
    expect(flatDoc(chapter("<p>Hello<span> </span>world.</p>")).norm).toBe("Hello world.");
  });
});

describe("paintSentence / paintWord", () => {
  it("paints the sentence then each word in turn, staying inside it", () => {
    const doc = chapter(CHAPTER);
    const before = doc.body.textContent;
    const ps = paintSentence(doc, "Hello brave new world.", "tts-sent");
    expect(ps).not.toBeNull();
    const log: string[] = [`sent=${JSON.stringify(ps!.el.textContent)}`];
    let cursor = 0;
    for (const word of ["Hello", "brave", "new", "world"]) {
      const pw = paintWord(ps!, word, cursor, "tts-word");
      const w = ps!.el.querySelector(".tts-word");
      log.push(
        `${word}: painted=${pw !== null} text=${JSON.stringify(w?.textContent)} inside=${String(!!w && ps!.el.contains(w))} sent-intact=${String(ps!.el.textContent === "Hello brave new world.")}`,
      );
      if (pw) {
        cursor = pw.end;
        pw.unpaint();
      }
    }
    log.push(`cursor-end=${String(cursor)}`);
    ps!.unpaint();
    log.push(`restored=${String(doc.body.textContent === before)}`);
    expect(log).toEqual([
      'sent="Hello brave new world."',
      'Hello: painted=true text="Hello" inside=true sent-intact=true',
      'brave: painted=true text="brave" inside=true sent-intact=true',
      'new: painted=true text="new" inside=true sent-intact=true',
      'world: painted=true text="world" inside=true sent-intact=true',
      "cursor-end=21",
      "restored=true",
    ]);
  });

  it("skips words it cannot find without moving the cursor", () => {
    const ps = paintSentence(chapter("<p>Alpha beta gamma.</p>"), "Alpha beta gamma.", "tts-sent");
    // TTS boundary tokens (punctuation, em-dashes) have no DOM match.
    const missed = paintWord(ps!, "—", 0, "tts-word");
    const hit = paintWord(ps!, "beta", 0, "tts-word");
    const w = ps!.el.querySelector(".tts-word");
    expect([
      `missed=${String(missed === null)}`,
      `hit=${String(hit !== null)}`,
      `hit-end=${String(hit?.end)}`,
      `hit-text=${JSON.stringify(w?.textContent)}`,
    ]).toEqual(["missed=true", "hit=true", "hit-end=10", 'hit-text="beta"']);
  });

  it("highlights the matching head when the tail differs", () => {
    const ps = paintSentence(
      chapter("<p>The quick brown fox jumps over the lazy cat. Next.</p>"),
      "The quick brown fox jumps over the lazy dog.",
      "tts-sent",
    );
    // Full probe absent ("dog" vs "cat"); the 40-char head matches.
    expect(ps?.el.textContent?.trim()).toBe("The quick brown fox jumps over the lazy");
  });

  it("unpaint restores the original DOM text", () => {
    const doc = chapter(CHAPTER);
    const before = doc.body.textContent;
    const ps = paintSentence(doc, "Second sentence here.", "tts-sent");
    paintWord(ps!, "sentence", 0, "tts-word")?.unpaint();
    ps!.unpaint();
    expect(doc.body.textContent).toBe(before);
  });
});

it("wordSpans skips unfound words without misaligning the rest", () => {
  expect(
    wordSpans("Hello brave new world.", [
      { text: "Hello" },
      { text: "—" },
      { text: "brave" },
      { text: "new" },
      { text: "world." },
    ]),
  ).toEqual([
    { start: 0, end: 5 },
    { start: 6, end: 11 },
    { start: 12, end: 15 },
    { start: 16, end: 22 },
  ]);
});
