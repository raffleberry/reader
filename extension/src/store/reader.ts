/**
 * The open book, the epub.js handles, and the one note we keep about it.
 *
 * A book exists only in this tab: bytes and sentences live in memory and
 * are dropped when the book is closed or the tab goes away. What survives
 * is `place` — a CFI, a page number, a chapter name and the sentence being
 * read — filed in the shelf under a fingerprint of the file.
 */
import { computed, markRaw, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { NavItem } from "epubjs";
import { parseEpub } from "../text/epub";
import type { Sentence } from "../api/voice";
import { sameChapter } from "../tts/cfi";
import * as shelf from "../ext/shelf";
import type { Place } from "../ext/shelf";
import type { BookRendition } from "../types";

export interface OpenBook {
  /** Fingerprint of the file, so "continue" recognises it next time. */
  id: string;
  /** File name, for display only. */
  name: string;
  title: string;
  size: number;
  sentences: Sentence[];
}

/** How long to wait after a page turn before writing the note down. */
const SAVE_DEBOUNCE = 1200;

export const useReader = defineStore("reader", () => {
  const book = ref<OpenBook | null>(null);
  /** Raw EPUB bytes for the viewer (never reactive). */
  const data = shallowRef<ArrayBuffer | null>(null);
  const sentences = ref<Sentence[]>([]);
  /** Raw epub.js rendition (never reactive). */
  const rendition = shallowRef<BookRendition | null>(null);
  /** Book contents from vue-reader. */
  const toc = ref<NavItem[]>([]);
  /** Current location (CFI) and chapter href, as epub.js reports them. */
  const location = ref("");
  const chapterHref = ref("");
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
    const href = (chapterHref.value || "").split("#")[0].split("/").pop();
    const hit = toc.value.find((t) => t.href.split("#")[0].endsWith(href || ""));
    return hit?.label || (href ? decodeURIComponent(href) : "");
  });

  /** Last path segment, decoded: manifest and viewer hrefs often differ. */
  function baseName(h: string): string {
    const last = h.split("/").pop() || "";
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }

  /**
   * Open a file the user picked. Parsed in memory; the only thing kept
   * afterwards is the place we were last at, if we have been here before.
   */
  async function open(file: File): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      if (!file.name.toLowerCase().endsWith(".epub")) {
        throw new Error("only .epub files are supported");
      }
      const id = await shelf.fingerprint(file);
      const [parsed, place] = await Promise.all([parseEpub(file), shelf.placeFor(id)]);
      book.value = {
        id,
        name: file.name,
        title: parsed.title,
        size: file.size,
        sentences: parsed.sentences,
      };
      data.value = markRaw(await file.arrayBuffer());
      sentences.value = parsed.sentences;
      resumed.value = place ?? null;
      // The viewer seeks to this CFI as soon as the book opens.
      location.value = place?.cfi ?? "";
      totalPages.value = 0;
      curPage.value = 0;
    } catch (err) {
      book.value = null;
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
  }

  function close(): void {
    book.value = null;
    data.value = null;
    sentences.value = [];
    rendition.value = null;
    toc.value = [];
    location.value = "";
    chapterHref.value = "";
    totalPages.value = 0;
    curPage.value = 0;
    resumed.value = null;
  }

  function setRendition(r: BookRendition): void {
    rendition.value = markRaw(r);
  }

  function setToc(items: NavItem[]): void {
    toc.value = items;
  }

  /** Location reported by the viewer (CFI + href). */
  function setLocation(cfi: string, href: string): void {
    if (cfi) location.value = cfi;
    if (href) chapterHref.value = href;
  }

  function setPages(page: number, pages: number): void {
    if (pages > 0) totalPages.value = pages;
    if (page > 0) curPage.value = page;
  }

  /** Sentence indices of the current chapter (empty when unknown). */
  function chapterIndices(): number[] {
    const href = (chapterHref.value || "").split("#")[0];
    if (!sentences.value.length || !href) return [];
    const out: number[] = [];
    sentences.value.forEach((s, i) => {
      const h = s.href.split("#")[0];
      if (!h) return;
      if (href.endsWith(h) || h.endsWith(href) || baseName(h) === baseName(href)) out.push(i);
    });
    return out;
  }

  /** First sentence of the current chapter. */
  function firstAudible(): number {
    const inChapter = chapterIndices();
    return inChapter.length ? inChapter[0] : 0;
  }

  /**
   * Where play should start: the sentence we were last reading aloud, as
   * long as we're still in the chapter it was in, else this chapter's top.
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
    data,
    sentences,
    rendition,
    toc,
    location,
    chapterHref,
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
    setRendition,
    setToc,
    setLocation,
    setPages,
    open,
    close,
    scheduleSave,
    flushPlace,
  };
});
