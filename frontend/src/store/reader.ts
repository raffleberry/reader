import { markRaw } from "vue";
import { defineStore } from "pinia";
import type { NavItem } from "epubjs";
import { deleteBook, getBook, listBooks, uploadBook } from "../api/books";
import type { Book } from "../api/books";
import { getSentences } from "../api/voice";
import type { Sentence } from "../api/voice";
import type { BookRendition } from "../types";

export type ThemeName = "light" | "sepia" | "dark";
export type Flow = "paginated" | "scrolled";

const THEME_KEY = "reader.theme";
const FONT_KEY = "reader.font";

function storedTheme(): ThemeName {
  const v = localStorage.getItem(THEME_KEY);
  return v === "sepia" || v === "dark" ? v : "light";
}

/** Library + open book + raw epub.js handles for the player. */
export const useReader = defineStore("reader", {
  state: () => ({
    books: [] as Book[],
    current: null as Book | null,
    sentences: [] as Sentence[],
    /** Raw epub.js rendition (never reactive). */
    rendition: null as BookRendition | null,
    /** Book contents from vue-reader. */
    toc: [] as NavItem[],
    /** Last reading position (CFI), kept across flow switches. */
    location: "" as string,
    /** Current chapter href for the toolbar label. */
    chapterHref: "" as string,
    flow: "paginated" as Flow,
    theme: storedTheme() as ThemeName,
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
      const href = state.chapterHref.split("#")[0].split("/").pop();
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
    async add(file: File): Promise<Book | null> {
      this.loading = true;
      this.error = "";
      try {
        const book = await uploadBook(file);
        this.books = [book, ...this.books];
        return book;
      } catch (err) {
        this.error = (err as Error).message;
        return null;
      } finally {
        this.loading = false;
      }
    },
    async remove(id: string): Promise<void> {
      await deleteBook(id);
      this.books = this.books.filter((b) => b.id !== id);
      if (this.current?.id === id) this.close();
    },
    async open(id: string): Promise<void> {
      this.loading = true;
      this.error = "";
      try {
        this.current = this.books.find((b) => b.id === id) || (await getBook(id));
        this.sentences = await getSentences(id);
      } catch (err) {
        this.error = (err as Error).message;
      } finally {
        this.loading = false;
      }
    },
    close(): void {
      this.current = null;
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
      this.location = cfi;
      this.chapterHref = href;
    },
    setFlow(flow: Flow): void {
      this.flow = flow;
    },
    setTheme(theme: ThemeName): void {
      this.theme = theme;
      localStorage.setItem(THEME_KEY, theme);
    },
    setFont(scale: number): void {
      this.fontScale = Math.min(200, Math.max(60, Math.round(scale)));
      localStorage.setItem(FONT_KEY, String(this.fontScale));
    },
  },
});
