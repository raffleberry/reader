import { describe, expect, it } from "vitest";
import { placeSentences, sentenceIndexAtSelection, flatDoc } from "../src/tts/locate";

/**
 * Read-from-here resolution (sentenceIndexAtSelection in src/tts/locate.ts).
 * The sentence must come from the selection's DOM position, so a repeated
 * phrase maps to the occurrence actually selected — never the first match
 * above it. Ranges are built in detached chapter documents.
 */

const PROBES = ["The king arrived.", "The court cheered.", "The king departed."];

/** Resolve `probes` against a position at `marker` inside `html`. */
function resolve(html: string, probes: string[], marker: string, markerOccurrence = 0): number {
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
  return sentenceIndexAtSelection(doc, probes, target, rest);
}

describe("sentenceIndexAtSelection", () => {
  it("resolves a repeated phrase to the selected occurrence", () => {
    // Reported bug: selecting "The king" in the third sentence played the
    // first sentence above it (text search returned the first match).
    expect(
      resolve(
        "<p>The king arrived. The court cheered. The king departed.</p>",
        PROBES,
        "The king",
        1,
      ),
    ).toBe(2);
  });

  it("resolves a first-occurrence selection to the first sentence", () => {
    expect(
      resolve(
        "<p>The king arrived. The court cheered. The king departed.</p>",
        PROBES,
        "The king",
        0,
      ),
    ).toBe(0);
  });

  it("maps positions across inline elements", () => {
    expect(
      resolve(
        "<p>The <b>king</b> arrived. The <i>king</i> departed.</p>",
        ["The king arrived.", "The king departed."],
        "departed",
      ),
    ).toBe(1);
  });

  it("resolves a selection before every sentence to the first", () => {
    expect(
      resolve("<h1>Title</h1><p>Alpha beta. Gamma delta.</p>", ["Alpha beta.", "Gamma delta."], "Title"),
    ).toBe(0);
  });

  it("returns -1 when no probe is in the document", () => {
    expect(resolve("<p>Something else entirely.</p>", PROBES, "Something")).toBe(-1);
  });

  it("returns -1 for a range outside the document", () => {
    const doc = document.implementation.createHTMLDocument("c");
    doc.body.innerHTML = "<p>Alpha beta. Gamma delta.</p>";
    const other = document.implementation.createHTMLDocument("other");
    other.body.innerHTML = "<p>Gamma delta.</p>";
    const foreign = other.body.firstChild?.firstChild as Text;
    expect(
      sentenceIndexAtSelection(doc, ["Alpha beta.", "Gamma delta."], foreign, 0),
    ).toBe(-1);
  });
});

it("placeSentences skips unfound probes and keeps order", () => {
  const doc = document.implementation.createHTMLDocument("c");
  doc.body.innerHTML = "<p>Alpha beta. Gamma delta.</p>";
  const placed = placeSentences(flatDoc(doc), [
    "Alpha beta.",
    "Missing sentence here.",
    "Gamma delta.",
  ]);
  expect(placed.map((p) => p.index)).toEqual([0, 2]);
  expect(placed[0].at).toBeLessThan(placed[1].at);
});
