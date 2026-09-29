/**
 * Where you stopped reading, so the next open picks up without keeping the
 * book.
 *
 * This is the only note Reader keeps about an EPUB: ~150 bytes per book (CFI,
 * page, chapter, the sentence being read) plus a fingerprint to recognise the
 * same file next time. No text, no cover, no bytes — close the tab and the
 * book itself is gone. (The only text it ever holds is the excerpt in a
 * bookmark you made yourself; see `marks.ts`.)
 */
import { storage } from "wxt/utils/storage";
import { forgetBook } from "./marks";

/** Enough of the head of a file to tell one EPUB from another. */
const HEAD_BYTES = 256 * 1024;
/** Books remembered on the start screen. */
const KEEP = 8;

export interface Place {
  /** epub.js CFI: the exact spot in the book. */
  cfi: string;
  /** 1-based page, as the scrub row counts them. */
  page: number;
  pages: number;
  /** 0..1 through the book. */
  pct: number;
  chapter: string;
  /** Sentence being read aloud, so play picks up mid-chapter. */
  sent: number;
}

export interface Recent {
  /** Fingerprint of the file this note belongs to. */
  id: string;
  /** File name, for display only. */
  name: string;
  title: string;
  at: number;
  place: Place;
}

const shelf = storage.defineItem<Recent[]>("local:shelf", { fallback: [], version: 1 });

/**
 * Identify a file without reading all of it: size, mtime, and the first
 * 256 KB. Renaming or moving the book keeps the note; a different book
 * can't match by accident.
 */
export async function fingerprint(file: File): Promise<string> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const meta = new TextEncoder().encode(`${file.size}:${file.lastModified}:`);
  const buf = new Uint8Array(meta.length + head.length);
  buf.set(meta, 0);
  buf.set(head, meta.length);
  return digest(buf);
}

async function digest(bytes: Uint8Array): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
    return hex(new Uint8Array(hash)).slice(0, 24);
  }
  // FNV-1a, only for a context without WebCrypto (never in the extension).
  let h = 0x811c9dc5;
  for (const b of bytes) {
    h = Math.imul(h ^ b, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Newest first. */
export async function listRecent(): Promise<Recent[]> {
  const all = await shelf.getValue().catch(() => [] as Recent[]);
  return [...all].sort((a, b) => b.at - a.at);
}

export async function placeFor(id: string): Promise<Place | undefined> {
  const all = await shelf.getValue().catch(() => [] as Recent[]);
  return all.find((r) => r.id === id)?.place;
}

/** Add or update one note, then drop the oldest beyond the cap. */
export async function remember(rec: Recent): Promise<void> {
  const all = await shelf.getValue().catch(() => [] as Recent[]);
  const next = [rec, ...all.filter((r) => r.id !== rec.id)]
    .sort((a, b) => b.at - a.at)
    .slice(0, KEEP);
  await shelf.setValue(next);
  // Bookmarks are only reachable through a shelf entry, so a book pushed off
  // the end of the shelf takes its bookmarks with it — otherwise they would
  // sit in storage forever with nothing left to name them.
  const kept = new Set(next.map((r) => r.id));
  for (const gone of all.filter((r) => !kept.has(r.id))) {
    await forgetBook(gone.id);
  }
}

export async function forget(id: string): Promise<void> {
  const all = await shelf.getValue().catch(() => [] as Recent[]);
  await shelf.setValue(all.filter((r) => r.id !== id));
}

export async function forgetAll(): Promise<void> {
  await shelf.setValue([]);
}
