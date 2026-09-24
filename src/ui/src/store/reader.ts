import { computed, markRaw, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { NavItem } from "epubjs";
import { deleteBook, deleteBookMarks, getBook, listBooks } from "../db";
import type { BookMeta, StoredBook } from "../db";
import type { Sentence } from "../api/voice";
import type { BookRendition } from "../types";

export type ThemeName = "light" | "sepia" | "dark" | "monokai";
export type WheelDir = "normal" | "inverted";

const THEME_KEY = "reader.theme";
const FONT_KEY = "reader.font";
const WHEEL_KEY = "reader.wheel";

function storedTheme(): ThemeName {
  const v = localStorage.getItem(THEME_KEY);
  return v === "sepia" || v === "dark" || v === "monokai" ? v : "light";
}

function storedWheel(): WheelDir {
  return localStorage.getItem(WHEEL_KEY) === "inverted" ? "inverted" : "normal";
}

/** Library (IndexedDB) + open book + raw epub.js handles for the player. */
export const useReader = defineStore("reader", () => {
  const books = ref<BookMeta[]>([]);
  const current = ref<StoredBook | null>(null);
  /** Raw EPUB bytes for the viewer (never reactive). */
  const data = shallowRef<ArrayBuffer | null>(null);
  const sentences = ref<Sentence[]>([]);
  /** Raw epub.js rendition (never reactive). */
  const rendition = shallowRef<BookRendition | null>(null);
  /** Book contents from vue-reader. */
  const toc = ref<NavItem[]>([]);
  /** Last reading position (CFI), restored on reopen. */
  const location = ref("");
  /** Current chapter href for the toolbar label. */
  const chapterHref = ref("");
  const theme = ref<ThemeName>(storedTheme());
  /** Wheel mapping over the book: normal (down = forward) or inverted. */
  const wheel = ref<WheelDir>(storedWheel());
  /** % of the publisher's font size. */
  const fontScale = ref(Number(localStorage.getItem(FONT_KEY) || 100));
  const loading = ref(false);
  const error = ref("");

  const title = computed(() => current.value?.title || "Reader");
  const chapterLabel = computed(() => {
    const href = (chapterHref.value || "").split("#")[0].split("/").pop();
    const hit = toc.value.find((t) => t.href.split("#")[0].endsWith(href || ""));
    return hit?.label || (href ? decodeURIComponent(href) : "");
  });

  async function loadAll(): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      books.value = await listBooks();
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
  }

  function close(): void {
    current.value = null;
    data.value = null;
    sentences.value = [];
    rendition.value = null;
    toc.value = [];
    location.value = "";
    chapterHref.value = "";
  }

  async function remove(id: string): Promise<void> {
    await deleteBook(id);
    await deleteBookMarks(id).catch(() => undefined);
    books.value = books.value.filter((b) => b.id !== id);
    if (current.value?.id === id) close();
  }

  async function open(id: string): Promise<void> {
    loading.value = true;
    error.value = "";
    try {
      const book = await getBook(id);
      if (!book) throw new Error("book not found");
      current.value = book;
      data.value = markRaw(await book.blob.arrayBuffer());
      sentences.value = book.sentences;
    } catch (err) {
      error.value = (err as Error).message;
    } finally {
      loading.value = false;
    }
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

  function setTheme(t: ThemeName): void {
    theme.value = t;
    localStorage.setItem(THEME_KEY, t);
  }

  function setWheel(w: WheelDir): void {
    wheel.value = w;
    localStorage.setItem(WHEEL_KEY, w);
  }

  function setFont(scale: number): void {
    fontScale.value = Math.min(200, Math.max(60, Math.round(scale)));
    localStorage.setItem(FONT_KEY, String(fontScale.value));
  }

  return {
    books,
    current,
    data,
    sentences,
    rendition,
    toc,
    location,
    chapterHref,
    theme,
    wheel,
    fontScale,
    loading,
    error,
    title,
    chapterLabel,
    loadAll,
    remove,
    open,
    close,
    setRendition,
    setToc,
    setLocation,
    setTheme,
    setWheel,
    setFont,
  };
});
