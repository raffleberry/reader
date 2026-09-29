import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { addMark, dropMark, forgetAll, forgetBook, listMarks, markCounts, newId } from "../src/ext/marks";
import type { Mark } from "../src/ext/marks";
import { remember } from "../src/ext/shelf";
import type { Recent } from "../src/ext/shelf";

/**
 * Bookmarks are the only text Reader ever keeps, so these tests are the
 * promise in AGENTS.md: a sentence index and a short excerpt, filed under
 * the fingerprint of the book it came from, and gone the moment the book is.
 */

beforeEach(() => {
  fakeBrowser.reset();
});

function mark(book: string, at: number, sent = 1, text = "a passage worth keeping"): Mark {
  return { id: newId(), book, sent, chapter: "One", text, at };
}

function note(id: string, at: number): Recent {
  return {
    id,
    name: `${id}.epub`,
    title: id,
    at,
    place: { cfi: "epubcfi(/6/4!/4/2)", page: 3, pages: 8, pct: 0.5, chapter: "One", sent: 12 },
  };
}

describe("marks", () => {
  it("keeps nothing until a bookmark is made", async () => {
    expect(await listMarks("abc")).toEqual([]);
    expect(await markCounts()).toEqual({});
  });

  it("files bookmarks under the book's fingerprint, newest first", async () => {
    await addMark(mark("abc", 1));
    await addMark(mark("abc", 2));
    await addMark(mark("other", 3));
    expect((await listMarks("abc")).map((m) => m.at)).toEqual([2, 1]);
    expect((await listMarks("other")).map((m) => m.at)).toEqual([3]);
    expect(await listMarks("nobody")).toEqual([]);
  });

  it("counts per book, for the start screen", async () => {
    await addMark(mark("abc", 1));
    await addMark(mark("abc", 2));
    await addMark(mark("other", 3));
    expect(await markCounts()).toEqual({ abc: 2, other: 1 });
  });

  it("drops one bookmark, or every one of a book", async () => {
    await addMark(mark("abc", 1));
    const second = mark("abc", 2);
    await addMark(second);
    await addMark(mark("other", 3));

    await dropMark(second.id);
    expect(await listMarks("abc")).toHaveLength(1);

    await forgetBook("abc");
    expect(await listMarks("abc")).toEqual([]);
    expect(await listMarks("other")).toHaveLength(1);

    await forgetAll();
    expect(await markCounts()).toEqual({});
  });

  it("keeps only the last 200 bookmarks of one book", async () => {
    for (let i = 0; i < 205; i++) await addMark(mark("abc", i));
    const all = await listMarks("abc");
    expect(all).toHaveLength(200);
    expect(all[0].at).toBe(204);
  });

  it("takes a dropped book's bookmarks with it", async () => {
    // Eight books fill the shelf; the ninth pushes the first one out.
    for (let i = 0; i < 8; i++) await remember(note(`b${i}`, i));
    await addMark(mark("b0", 1));
    expect(await markCounts()).toEqual({ b0: 1 });

    // A bookmark is only reachable through a shelf entry, so b0's goes too.
    await remember(note("b8", 8));
    expect(await markCounts()).toEqual({});
  });

  it("stores a sentence index and a short excerpt, never the book", async () => {
    const long = "x".repeat(4000);
    await addMark({ ...mark("abc", 1, 42, long.slice(0, 140)), sent: 42 });
    const [one] = await listMarks("abc");
    expect(Object.keys(one).sort()).toEqual(["at", "book", "chapter", "id", "sent", "text"]);
    expect(one.sent).toBe(42);
    expect(one.text).toHaveLength(140);
    expect(JSON.stringify(one).length).toBeLessThan(500);
  });

  it("never mints the same id twice", () => {
    expect(newId()).not.toBe(newId());
  });
});
