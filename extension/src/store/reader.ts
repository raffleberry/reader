/**
 * The open book, the foliate viewer handles, and the one note we keep.
 *
 * A book exists only in this tab: the parsed book and its sentences live in
 * memory and are dropped when the book is closed or the tab goes away. What
 * survives is `place` — a section CFI, a page number, a chapter name and the
 * sentence being read — filed in the shelf under a fingerprint of the file.
 */
import { computed, markRaw, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import { openEPUB } from "../foliate/book";
import type { FoliateBook, TocItem } from "../foliate/book";
import type { ReaderView } from "../foliate/render";
import { segmentDoc } from "../text/sentences";
import type { Sentence } from "../api/voice";
import { sameChapter } from "../tts/cfi";
import * as shelf from "../ext/shelf";
import type { Place } from "../ext/shelf";

export interface OpenBook {
  /** Fingerprint of the file, so "continue" recognises it next time. */
  id: string;
  /** File name, for display only. */
  name: string;
  title: string;
  size: number;
}

/** How long to wait after a page turn before writing the note down. */
const SAVE_DEBOUNCE = 1200;

export const useReader = defineStore("reader", () => {
  const book = ref<OpenBook | null>(null);
  /** The parsed foliate book (never reactive). */
  const folio = shallowRef<FoliateBook | null>(null);
  /** The mounted renderer (never reactive; Reader.vue owns its element). */
  const view = shallowRef<ReaderView | null>(null);
  const sentences = ref<Sentence[]>([]);
  const toc = ref<TocItem[]>([]);
  /** Current section CFI + id, as the renderer reports them. */
  const location = ref("");
  const chapterHref = ref("");
  /** Live section index (relocate events keep this current). */
  const section = ref(0);
  /** Generated-location page count, for the scrub row and the note. */
  const totalPages = ref(0);
  const curPage = ref(0);
  /** The note we opened at, if this book was read before. */
  const resumed = ref<Place | null>(null);
  const loading = ref(false);
  const error = ref("");

  const title = computed(() => book.value?.title || "EPUB Reader");
  const pct = computed(() => {
    const n = totalPages.value;
    return n > 1 ? Math.min(1, Math.max(0, (curPage.value - 1) / (n - 1))) : 0;
  });
  const chapterLabel = computed(() => {
    const id = (chapterHref.value || "").split("#")[0];
    const flat: TocItem[] = [];
    const walk = (list: TocItem[]): void => {
      for (const t of list) {
        flat.push(t);
        if (t.subitems?.length) walk(t.subitems);
      }
    };
    walk(toc.value);
    const hit = flat.find((t) => {
      const h = (t.href || "").split("#")[0];
      return h && id && (h.endsWith(id) || id.endsWith(h));
    });
    return hit?.label || (id ? decodeURIComponent(id.split("/").pop() || id) : "");
  });

  /**
   * Open a file the user picked. Parsed in memory; the only thing kept
   * afterwards is the place we were last at, if we have been here before.
   */
  async function open(file: File): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      const id = await shelf.fingerprint(file);
      const [folioBook, place] = await Promise.all([openEPUB(file), shelf.placeFor(id)]);
      const sents: Sentence[] = [];
      for (let s = 0; s < folioBook.sections.length; s++) {
        const sec = folioBook.sections[s];
        let doc: Document | null = null;
        try {
          doc = await sec.createDocument();
        } catch {
          continue;
        }
        if (!doc) continue;
        for (const text of segmentDoc(doc)) {
          const n = sents.length;
          sents.push({
            key: `${String(s).padStart(2, "0")}-${String(n).padStart(4, "0")}`,
            chapter: s,
            href: sec.id,
            text,
          });
        }
      }
      if (!sents.length) throw new Error("no readable text found");
      folio.value = markRaw(folioBook);
      book.value = { id, name: file.name, title: folioBook.title, size: file.size };
      sentences.value = sents;
      toc.value = folioBook.toc;
      resumed.value = place ?? null;
      // The viewer seeks to this section as soon as the book opens.
      const at = sectionIndexOf(place?.cfi ?? "");
      section.value = at;
      location.value = folioBook.sections[at]?.cfi ?? "";
      chapterHref.value = folioBook.sections[at]?.id ?? "";
      totalPages.value = 0;
      curPage.value = 0;
    } catch (err) {
      folio.value = null;
      book.value = null;
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
  }

  function close(): void {
    try {
      view.value?.destroy();
    } catch {
      // Already torn down.
    }
    view.value = null;
    folio.value = null;
    book.value = null;
    sentences.value = [];
    toc.value = [];
    location.value = "";
    chapterHref.value = "";
    section.value = 0;
    totalPages.value = 0;
    curPage.value = 0;
    resumed.value = null;
  }

  function setView(v: ReaderView): void {
    view.value = markRaw(v);
  }

  function setToc(items: TocItem[]): void {
    toc.value = items;
  }

  /** Section index for a section CFI; first linear section when unknown. */
  function sectionIndexOf(cfi: string): number {
    const secs = folio.value?.sections ?? [];
    if (cfi) {
      const hit = secs.findIndex((s) => s.cfi === cfi);
      if (hit >= 0) return hit;
    }
    const linear = secs.findIndex((s) => s.linear !== "no");
    return linear >= 0 ? linear : 0;
  }

  /** Location reported by the viewer (section CFI + id). */
  function setSection(i: number): void {
    const sec = folio.value?.sections[i];
    if (!sec) return;
    section.value = i;
    location.value = sec.cfi;
    chapterHref.value = sec.id;
  }

  function setPages(page: number, pages: number): void {
    if (pages > 0) totalPages.value = pages;
    if (page > 0) curPage.value = page;
  }

  /** Sentence indices of the current section (empty when unknown). */
  function chapterIndices(): number[] {
    const out: number[] = [];
    sentences.value.forEach((s, i) => {
      if (s.chapter === section.value) out.push(i);
    });
    return out;
  }

  /** First sentence of the current section. */
  function firstAudible(): number {
    const inChapter = chapterIndices();
    return inChapter.length ? inChapter[0] : 0;
  }

  /**
   * Where play should start: the sentence we were last reading aloud, as
   * long as we're still in the section it was in, else this section's top.
   * This is what makes "continue" mean continue, not restart.
   */
  function playFrom(fallback: number): number {
    const place = resumed.value;
    if (place && place.sent > 0 && sameChapter(place.cfi, location.value)) {
      return Math.min(place.sent, Math.max(0, sentences.value.length - 1));
    }
    return fallback;
  }

  /** Remember where we are. Called on every settled page turn. */
  async function savePlace(sent = 0): Promise<void> {
    const b = book.value;
    if (!b || !location.value) return;
    const place: Place = {
      cfi: location.value,
      page: curPage.value,
      pages: totalPages.value,
      pct: pct.value,
      chapter: chapterLabel.value,
      sent: Math.max(sent, resumed.value?.sent ?? 0),
    };
    await shelf
      .remember({ id: b.id, name: b.name, title: b.title, at: Date.now(), place })
      .catch(() => undefined);
  }

  let saveTimer = 0;

  /** Coalesce the flood of page turns a scroll produces. */
  function scheduleSave(sent = 0): void {
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = 0;
      void savePlace(sent);
    }, SAVE_DEBOUNCE);
  }

  /** Write the note right now (tab closing, book closing). */
  async function flushPlace(sent = 0): Promise<void> {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = 0;
    }
    await savePlace(sent);
  }

  return {
    book,
    folio,
    view,
    sentences,
    toc,
    location,
    chapterHref,
    section,
    totalPages,
    curPage,
    resumed,
    loading,
    error,
    title,
    chapterLabel,
    chapterIndices,
    firstAudible,
    playFrom,
    setView,
    setToc,
    setSection,
    setPages,
    open,
    close,
    scheduleSave,
    flushPlace,
  };
});
