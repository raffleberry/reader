/**
 * Bookmarks: a passage you asked to keep, filed under the fingerprint of the
 * book it came from.
 *
 * This is the one thing about a book that isn't a note to yourself — it holds
 * an excerpt of the text you selected, so the list means something with the
 * book closed. Still no book, no sentences, no whole passage: an id, a
 * sentence index, a chapter label and at most `TEXT_MAX` characters.
 *
 * Bookmarks are useless without their book, so they are pruned with it: a
 * book pushed off the shelf (or deleted from the start screen) takes its
 * bookmarks with it — see `shelf.remember` and `shelf.forget`.
 */
import { storage } from "wxt/utils/storage";

/** Bookmarks kept per book — plenty, and bounded so storage can't run away. */
const KEEP = 200;
/** How much of the selected text is kept for the list. */
export const TEXT_MAX = 140;

export interface Mark {
  /** Short id, so one can be dropped without knowing where it sits. */
  id: string;
  /** Fingerprint of the book this belongs to. */
  book: string;
  /** Sentence the selection started in (stable for the same file). */
  sent: number;
  /** Chapter label at the time, for display. */
  chapter: string;
  /** Excerpt of the selection, for display. */
  text: string;
  /** Date.now() when the bookmark was made. */
  at: number;
}

const marks = storage.defineItem<Mark[]>("local:marks", { fallback: [], version: 1 });

/** Short id: the clock plus a little entropy. Never derived from the book. */
export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Newest first. */
export async function listMarks(book: string): Promise<Mark[]> {
  const all = await marks.getValue().catch(() => [] as Mark[]);
  return newest(all.filter((m) => m.book === book));
}

/** How many bookmarks each book has — the start screen's only count. */
export async function markCounts(): Promise<Record<string, number>> {
  const all = await marks.getValue().catch(() => [] as Mark[]);
  const out: Record<string, number> = {};
  for (const m of all) out[m.book] = (out[m.book] ?? 0) + 1;
  return out;
}

/** Add one, then drop that book's oldest beyond the cap. */
export async function addMark(mark: Mark): Promise<void> {
  const all = await marks.getValue().catch(() => [] as Mark[]);
  const mine = newest([mark, ...all.filter((m) => m.book === mark.book && m.id !== mark.id)]).slice(
    0,
    KEEP,
  );
  await marks.setValue([...mine, ...all.filter((m) => m.book !== mark.book)]);
}

export async function dropMark(id: string): Promise<void> {
  const all = await marks.getValue().catch(() => [] as Mark[]);
  await marks.setValue(all.filter((m) => m.id !== id));
}

/** Every bookmark of one book — what deleting the book on the start screen wipes. */
export async function forgetBook(book: string): Promise<void> {
  const all = await marks.getValue().catch(() => [] as Mark[]);
  const next = all.filter((m) => m.book !== book);
  // Nothing to lose means nothing to write, so the key stays absent until
  // somebody actually makes a bookmark.
  if (next.length !== all.length) await marks.setValue(next);
}

export async function forgetAll(): Promise<void> {
  await marks.setValue([]);
}

/**
 * Follow bookmarks made or dropped anywhere else (the selection popup, the
 * start screen) so an open panel is never stale. Returns a stop function.
 */
export function watchBook(book: string, fn: (list: Mark[]) => void): () => void {
  return marks.watch((all) => fn(newest(all.filter((m) => m.book === book))));
}

function newest(list: Mark[]): Mark[] {
  return [...list].sort((a, b) => b.at - a.at);
}
