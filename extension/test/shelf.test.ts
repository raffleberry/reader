import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import "../test/blob";
import { forget, forgetAll, fingerprint, listRecent, placeFor, remember } from "../src/ext/shelf";
import type { Recent } from "../src/ext/shelf";

/**
 * The only thing Reader remembers about a book. These tests are the promise
 * in AGENTS.md: no book bytes, no text, just a note of where you stopped —
 * and a fingerprint good enough to recognise the same file again.
 */

beforeEach(() => {
  fakeBrowser.reset();
});

/** A File without touching the disk. */
function fakeFile(name: string, body: string, lastModified = 1): File {
  return new File([body], name, { type: "application/epub+zip", lastModified });
}

function note(id: string, at: number, pct = 0.5): Recent {
  return {
    id,
    name: `${id}.epub`,
    title: id,
    at,
    place: { cfi: "epubcfi(/6/4!/4/2)", page: 3, pages: 8, pct, chapter: "One", sent: 12 },
  };
}

describe("fingerprint", () => {
  it("is stable for the same file", async () => {
    const a = await fingerprint(fakeFile("book.epub", "epub bytes here"));
    const b = await fingerprint(fakeFile("book.epub", "epub bytes here"));
    expect(a).toBe(b);
  });

  it("survives a rename or a move (size, mtime and content decide)", async () => {
    const a = await fingerprint(fakeFile("book.epub", "epub bytes here"));
    const b = await fingerprint(fakeFile("copy of book.epub", "epub bytes here"));
    expect(a).toBe(b);
  });

  it("tells two different books apart", async () => {
    const a = await fingerprint(fakeFile("a.epub", "one book"));
    const b = await fingerprint(fakeFile("b.epub", "another book entirely"));
    expect(a).not.toBe(b);
  });

  it("tells a re-saved file apart (size and mtime move)", async () => {
    const a = await fingerprint(fakeFile("a.epub", "same text", 1000));
    const b = await fingerprint(fakeFile("a.epub", "same text", 2000));
    expect(a).not.toBe(b);
  });

  it("is short enough to be a storage key", async () => {
    expect(await fingerprint(fakeFile("a.epub", "x"))).toMatch(/^[0-9a-f]{8,24}$/);
  });
});

describe("shelf", () => {
  it("keeps nothing until a book is read", async () => {
    expect(await listRecent()).toEqual([]);
  });

  it("remembers a place and finds it again by fingerprint", async () => {
    await remember(note("abc", Date.now()));
    expect((await placeFor("abc"))?.cfi).toBe("epubcfi(/6/4!/4/2)");
    expect((await placeFor("other"))).toBeUndefined();
  });

  it("updates in place instead of piling up duplicates", async () => {
    await remember(note("abc", 1));
    await remember({ ...note("abc", 2), place: { ...note("abc", 2).place, page: 9 } });
    const all = await listRecent();
    expect(all).toHaveLength(1);
    expect(all[0].place.page).toBe(9);
  });

  it("lists newest first", async () => {
    await remember(note("old", 1));
    await remember(note("new", 2));
    expect((await listRecent()).map((r) => r.id)).toEqual(["new", "old"]);
  });

  it("keeps only the last eight books", async () => {
    for (let i = 0; i < 12; i++) await remember(note(`b${i}`, i));
    const all = await listRecent();
    expect(all).toHaveLength(8);
    expect(all.map((r) => r.id)).toEqual(["b11", "b10", "b9", "b8", "b7", "b6", "b5", "b4"]);
  });

  it("forgets one book, or all of them", async () => {
    await remember(note("a", 1));
    await remember(note("b", 2));
    await forget("a");
    expect((await listRecent()).map((r) => r.id)).toEqual(["b"]);
    await forgetAll();
    expect(await listRecent()).toEqual([]);
  });

  it("never stores anything book-shaped", async () => {
    await remember(note("a", 1));
    const [rec] = await listRecent();
    // A note is metadata: a handful of short fields, no text and no bytes.
    expect(Object.keys(rec).sort()).toEqual(["at", "id", "name", "place", "title"]);
    expect(Object.keys(rec.place).sort()).toEqual([
      "cfi",
      "chapter",
      "page",
      "pages",
      "pct",
      "sent",
    ]);
    expect(JSON.stringify(rec).length).toBeLessThan(400);
  });
});
