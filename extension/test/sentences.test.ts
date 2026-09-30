import { describe, expect, it } from "vitest";
import { rangeOfSentence, segmentDoc, sentenceAtPoint, sectionStart } from "../src/text/sentences";
import type { Sentence } from "../src/api/voice";

/**
 * Section sentences (src/text/sentences.ts): blocks split with
 * Intl.Segmenter, ranges resolved back into the live document, and
 * selection points mapped to the occurrence actually selected.
 */

const CHAPTER = `<h1>One</h1><p>Hello brave new world. Second sentence here.</p><p>He said nothing. He said nothing.</p>`;

function chapter(html = CHAPTER): Document {
  const doc = document.implementation.createHTMLDocument("c");
  doc.body.innerHTML = html;
  return doc;
}

describe("segmentDoc", () => {
  it("splits blocks into sentences in order", () => {
    expect(segmentDoc(chapter())).toEqual([
      "One",
      "Hello brave new world.",
      "Second sentence here.",
      "He said nothing.",
      "He said nothing.",
    ]);
  });

  it("skips scripts, styles and short fragments", () => {
    const doc = chapter(`<p>Real sentence here.<script>var x = 1;</script></p><p>x</p>`);
    expect(segmentDoc(doc)).toEqual(["Real sentence here."]);
  });
});

describe("rangeOfSentence", () => {
  it("resolves each sentence to its own range", () => {
    const doc = chapter();
    expect(rangeOfSentence(doc, 1)?.toString()).toBe("Hello brave new world.");
    expect(rangeOfSentence(doc, 2)?.toString()).toBe("Second sentence here.");
  });

  it("tells repeated sentences apart by position", () => {
    const doc = chapter();
    const first = rangeOfSentence(doc, 3);
    const second = rangeOfSentence(doc, 4);
    expect(first?.toString()).toBe("He said nothing.");
    expect(second?.toString()).toBe("He said nothing.");
    // Same text node, later offsets: the second occurrence, not the first.
    expect(second!.compareBoundaryPoints(Range.START_TO_START, first!)).toBeGreaterThan(0);
  });

  it("returns null past the end", () => {
    expect(rangeOfSentence(chapter(), 99)).toBeNull();
  });
});

describe("sentenceAtPoint", () => {
  it("maps a selection point to the occurrence actually selected", () => {
    const doc = chapter();
    const paras = doc.querySelectorAll("p");
    // Second "He said nothing." — the first must not win.
    const target = paras[1].firstChild!;
    const at = sentenceAtPoint(doc, target, "He said nothing. ".length + 4, 5);
    expect(at).toBe(4);
  });

  it("returns -1 outside every sentence", () => {
    const doc = chapter();
    expect(sentenceAtPoint(doc, doc.body, 0, 5)).toBe(-1);
  });
});

describe("sectionStart", () => {
  const sents = (chapters: number[]): Sentence[] =>
    chapters.map((chapter, i) => ({ key: `${i}`, chapter, href: "s", text: `s${i}` }));

  it("finds the first global index of the sentence's section", () => {
    const s = sents([0, 0, 1, 1, 1, 2]);
    expect(sectionStart(s, 4)).toBe(2);
    expect(sectionStart(s, 0)).toBe(0);
    expect(sectionStart(s, 5)).toBe(5);
  });
});
