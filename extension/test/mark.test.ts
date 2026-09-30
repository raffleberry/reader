import { afterEach, describe, expect, it } from "vitest";
import { clear, current, showRange } from "../src/tts/mark";
import { rangeOfSentence } from "../src/text/sentences";

/**
 * The highlight wraps the sentence range the player resolved — one span,
 * word pills inside it, and everything back to plain text on clear. Ranges
 * come from src/text/sentences.ts; this suite pins the wrapping.
 */

const CHAPTER = `<h1>One</h1><p>Hello brave new world. Second sentence here.</p>`;

function render(html = CHAPTER): Document {
  const doc = document.implementation.createHTMLDocument("c");
  doc.body.innerHTML = html;
  return doc;
}

function showFirst(doc: Document) {
  const range = rangeOfSentence(doc, 1);
  expect(range).not.toBeNull();
  return showRange(doc, range!);
}

afterEach(() => clear());

describe("showRange", () => {
  it("highlights the sentence and remembers its text", () => {
    const doc = render();
    const mark = showFirst(doc);
    expect(mark).not.toBeNull();
    expect(current()?.text).toBe("Hello brave new world.");
    expect(doc.querySelector(".tts-sent")?.textContent).toBe("Hello brave new world.");
  });

  it("replaces a previous highlight rather than stacking one", () => {
    const doc = render();
    showFirst(doc);
    const second = rangeOfSentence(doc, 1);
    expect(second).not.toBeNull();
    showRange(doc, second!);
    expect(doc.querySelectorAll(".tts-sent")).toHaveLength(1);
  });

  it("keeps painting words from the live wrapper", () => {
    const doc = render();
    showFirst(doc);
    current()!.paint("brave");
    const pill = doc.querySelector(".tts-word");
    expect(pill?.textContent).toBe("brave");
    expect(current()!.cursor).toBeGreaterThan(0);
  });
});

describe("clear", () => {
  it("removes the sentence and the word from the page", () => {
    const doc = render();
    showFirst(doc);
    current()!.paint("Hello");
    expect(doc.querySelector(".tts-word")).not.toBeNull();
    clear();
    expect(current()).toBeNull();
    expect(doc.querySelector(".tts-sent")).toBeNull();
    expect(doc.querySelector(".tts-word")).toBeNull();
    expect(doc.body.textContent).toBe(CHAPTER.replace(/<\/?(h1|p)>/g, ""));
  });
});
