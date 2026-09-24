/** Demo-only starter library: bundled epubs copied into IndexedDB on first run.
 *
 * The files live in `public/books/` (shipped verbatim in dist / dist-demo)
 * and are seeded through the same `parseEpub` + `putBook` path as uploads,
 * so afterwards they behave like any user book (readable, deletible).
 * Stable IDs make seeding idempotent; a localStorage flag keeps it one-shot.
 */
import { IS_DEMO } from "../demo";
import { getBook, putBook } from "../db";
import { parseEpub } from "../text/epub";

const FLAG = "reader.seed.v1";

interface SeedBook {
  /** Stable IndexedDB id (never random: re-seeds must find existing books). */
  id: string;
  file: string;
}

const BOOKS: SeedBook[] = [
  { id: "bundled-pg84", file: "pg84-images-3.epub" },
  { id: "bundled-pg1661", file: "pg1661-images-3.epub" },
  { id: "bundled-pg2701", file: "pg2701-images-3.epub" },
];

export async function ensureSeedBooks(): Promise<void> {
  if (!IS_DEMO) return;
  if (typeof localStorage !== "undefined" && localStorage.getItem(FLAG)) return;
  for (const b of BOOKS) {
    try {
      if (await getBook(b.id)) continue;
      const res = await fetch(`./books/${b.file}`);
      if (!res.ok) continue;
      const blob = await res.blob();
      const parsed = await parseEpub(blob);
      await putBook({
        id: b.id,
        title: parsed.title,
        size: blob.size,
        created: Date.now(),
        blob,
        sentences: parsed.sentences,
      });
    } catch {
      // A missing/unparseable bundle must never block the app; the user
      // can always upload their own books.
    }
  }
  try {
    localStorage.setItem(FLAG, "1");
  } catch {
    // Private mode: seeding just retries next visit.
  }
}
