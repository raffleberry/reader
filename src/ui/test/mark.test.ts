import { afterEach, describe, expect, it } from "vitest";
import { clear, current, reapply, show } from "../src/tts/mark";

/**
 * The highlight has to survive epub.js re-rendering a chapter. That happens
 * on every resize — including the one hiding the sidebar causes, which is
 * how this was reported: toggle the sidebar, the whole highlight vanishes.
 *
 * Each test re-renders the chapter the way epub.js does: the same source
 * HTML parsed into a *new* document, with nothing we injected left in it.
 */

const CHAPTER = `<h1>One</h1><p>Hello brave new world. Second sentence here.</p>`;
const SENTENCE = "Hello brave new world.";

function render(html = CHAPTER): Document {
  const doc = document.implementation.createHTMLDocument("c");
  doc.body.innerHTML = html;
  return doc;
}

afterEach(() => clear());

describe("show", () => {
  it("highlights the sentence and remembers its text", () => {
    const doc = render();
    const mark = show(doc, SENTENCE);
    expect(mark).not.toBeNull();
    expect(current()?.text).toBe(SENTENCE);
    expect(doc.querySelector(".tts-sent")?.textContent).toBe(SENTENCE);
  });

  it("leaves nothing behind when the sentence is not on the page", () => {
    expect(show(render(), "A sentence from another chapter.")).toBeNull();
    expect(current()).toBeNull();
    expect(render().querySelector(".tts-sent")).toBeNull();
  });

  it("replaces a previous highlight rather than stacking one", () => {
    const doc = render();
    show(doc, SENTENCE);
    show(doc, "Second sentence here.");
    expect(doc.querySelectorAll(".tts-sent")).toHaveLength(1);
  });
});

describe("reapply", () => {
  it("puts the sentence back after the document is thrown away", () => {
    // The bug: the book re-renders, so the injected span no longer exists.
    const before = render();
    show(before, SENTENCE);
    expect(before.querySelector(".tts-sent")).not.toBeNull();

    const after = render();
    expect(after.querySelector(".tts-sent")).toBeNull();
    expect(reapply(after)).toBe(true);
    expect(after.querySelector(".tts-sent")?.textContent).toBe(SENTENCE);
    expect(current()?.ps.doc).toBe(after);
  });

  it("keeps painting words into the new document, from the start again", () => {
    show(render(), SENTENCE);
    current()!.paint("brave");
    expect(current()!.cursor).toBeGreaterThan(0);

    const after = render();
    expect(reapply(after)).toBe(true);
    // A word the clock has already passed still gets its pill, because the
    // next frame re-anchors from the beginning of the sentence.
    current()!.paint("brave");
    const pill = after.querySelector(".tts-word");
    expect(pill?.textContent).toBe("brave");
    expect(current()!.ps.el.contains(pill)).toBe(true);
  });

  it("does nothing when nothing is highlighted", () => {
    expect(reapply(render())).toBe(false);
  });

  it("leaves the mark alone on a page that isn't holding it", () => {
    // A page turn renders the next page: the sentence is not here, and the
    // mark still belongs to the page it was found on.
    const first = render();
    show(first, SENTENCE);
    const other = render("<p>A completely different page of the book.</p>");
    expect(reapply(other)).toBe(false);
    expect(current()?.ps.doc).toBe(first);
    expect(other.querySelector(".tts-sent")).toBeNull();
  });

  it("does not double up when the same document is re-announced", () => {
    const doc = render();
    show(doc, SENTENCE);
    expect(reapply(doc)).toBe(true);
    expect(reapply(doc)).toBe(true);
    expect(doc.querySelectorAll(".tts-sent")).toHaveLength(1);
  });
});

describe("clear", () => {
  it("removes the sentence and the word from the page", () => {
    const doc = render();
    show(doc, SENTENCE);
    current()!.paint("Hello");
    expect(doc.querySelector(".tts-word")).not.toBeNull();
    clear();
    expect(current()).toBeNull();
    expect(doc.querySelector(".tts-sent")).toBeNull();
    expect(doc.querySelector(".tts-word")).toBeNull();
    expect(doc.body.textContent).toBe(CHAPTER.replace(/<\/?(h1|p)>/g, ""));
  });
});
