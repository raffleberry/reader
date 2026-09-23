import { markRaw } from "vue";
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
export const useReader = defineStore("reader", {
  state: () => ({
    books: [] as BookMeta[],
    current: null as StoredBook | null,
    /** Raw EPUB bytes for the viewer (never reactive). */
    data: null as ArrayBuffer | null,
    sentences: [] as Sentence[],
    /** Raw epub.js rendition (never reactive). */
    rendition: null as BookRendition | null,
    /** Book contents from vue-reader. */
    toc: [] as NavItem[],
    /** Last reading position (CFI), restored on reopen. */
    location: "" as string,
    /** Current chapter href for the toolbar label. */
    chapterHref: "" as string,
    theme: storedTheme() as ThemeName,
    /** Wheel mapping over the book: normal (down = forward) or inverted. */
    wheel: storedWheel() as WheelDir,
    /** % of the publisher's font size. */
    fontScale: Number(localStorage.getItem(FONT_KEY) || 100),
    loading: false as boolean,
    error: "" as string,
  }),
  getters: {
    title(state): string {
      return state.current?.title || "Reader";
    },
    chapterLabel(state): string {
      const href = (state.chapterHref || "").split("#")[0].split("/").pop();
      const hit = state.toc.find((t) => t.href.split("#")[0].endsWith(href || ""));
      return hit?.label || (href ? decodeURIComponent(href) : "");
    },
  },
  actions: {
    async loadAll(): Promise<void> {
      this.loading = true;
      this.error = "";
      try {
        this.books = await listBooks();
      } catch (err) {
        this.error = (err as Error).message;
      } finally {
        this.loading = false;
      }
    },
    async remove(id: string): Promise<void> {
      await deleteBook(id);
      await deleteBookMarks(id).catch(() => undefined);
      this.books = this.books.filter((b) => b.id !== id);
      if (this.current?.id === id) this.close();
    },
    async open(id: string): Promise<void> {
      this.loading = true;
      this.error = "";
      try {
        const book = await getBook(id);
        if (!book) throw new Error("book not found");
        this.current = book;
        this.data = markRaw(await book.blob.arrayBuffer());
        this.sentences = book.sentences;
      } catch (err) {
        this.error = (err as Error).message;
      } finally {
        this.loading = false;
      }
    },
    close(): void {
      this.current = null;
      this.data = null;
      this.sentences = [];
      this.rendition = null;
      this.toc = [];
      this.location = "";
      this.chapterHref = "";
    },
    setRendition(rendition: BookRendition): void {
      this.rendition = markRaw(rendition);
    },
    setToc(toc: NavItem[]): void {
      this.toc = toc;
    },
    /** Location reported by the viewer (CFI + href). */
    setLocation(cfi: string, href: string): void {
      if (cfi) this.location = cfi;
      if (href) this.chapterHref = href;
    },
    setTheme(theme: ThemeName): void {
      this.theme = theme;
      localStorage.setItem(THEME_KEY, theme);
    },
    setWheel(wheel: WheelDir): void {
      this.wheel = wheel;
      localStorage.setItem(WHEEL_KEY, wheel);
    },
    setFont(scale: number): void {
      this.fontScale = Math.min(200, Math.max(60, Math.round(scale)));
      localStorage.setItem(FONT_KEY, String(this.fontScale));
    },
  },
});
