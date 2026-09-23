/** Local library: books + parsed sentences in IndexedDB. */
import { openDB } from "idb";
import type { DBSchema } from "idb";
import type { Sentence } from "./api/voice";

export interface StoredBook {
  id: string;
  title: string;
  size: number;
  created: number;
  blob: Blob;
  sentences: Sentence[];
}

export interface BookMeta {
  id: string;
  title: string;
  size: number;
  created: number;
  sentences: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  key: string;
  text: string;
  created: number;
}

interface ReaderDB extends DBSchema {
  books: { key: string; value: StoredBook };
  marks: { key: string; value: Bookmark; indexes: { bookId: string } };
}

function db() {
  return openDB<ReaderDB>("reader", 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("books")) {
        db.createObjectStore("books", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("marks")) {
        const marks = db.createObjectStore("marks", { keyPath: "id" });
        marks.createIndex("bookId", "bookId");
      }
    },
  });
}

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

function meta(b: StoredBook): BookMeta {
  return {
    id: b.id,
    title: b.title,
    size: b.size,
    created: b.created,
    sentences: b.sentences.length,
  };
}

/** Newest first. */
export async function listBooks(): Promise<BookMeta[]> {
  const all = await (await db()).getAll("books");
  return all.map(meta).sort((a, b) => b.created - a.created);
}

export async function putBook(book: StoredBook): Promise<void> {
  await (await db()).put("books", book);
}

export async function getBook(id: string): Promise<StoredBook | undefined> {
  return (await db()).get("books", id);
}

export async function deleteBook(id: string): Promise<void> {
  await (await db()).delete("books", id);
}

/** Newest first. */
export async function listMarks(bookId: string): Promise<Bookmark[]> {
  const all = await (await db()).getAllFromIndex("marks", "bookId", bookId);
  return all.sort((a, b) => b.created - a.created);
}

export async function putMark(mark: Bookmark): Promise<void> {
  await (await db()).put("marks", mark);
}

export async function deleteMark(id: string): Promise<void> {
  await (await db()).delete("marks", id);
}

export async function deleteBookMarks(bookId: string): Promise<void> {
  const dbi = await db();
  const tx = dbi.transaction("marks", "readwrite");
  const keys = await tx.store.index("bookId").getAllKeys(bookId);
  await Promise.all(keys.map((k) => tx.store.delete(k)));
  await tx.done;
}
