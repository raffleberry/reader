/**
 * The foliate-js paginator, owned by us. One section renders at a time in a
 * scrolled view; navigation between sections is explicit (TOC, scrubber,
 * bookmarks, narration), never an infinite stack.
 *
 * Only the EPUB modules enter the bundle through here: importing view.js
 * would drag the MOBI/PDF/comic parsers into the shipped extension.
 */
import type { FoliateBook, NavTarget } from "./book";
import "../../vendor/foliate-js/paginator.js";

export interface SectionContents {
  index: number;
  doc: Document;
}

export interface Relocated {
  index: number;
  /** 0..1 reading progress within the section. */
  fraction: number;
  range: Range | null;
}

export interface ReaderView {
  el: HTMLElement;
  open(book: FoliateBook): void;
  goTo(target: NavTarget): Promise<void>;
  nextPage(): Promise<void>;
  prevPage(): Promise<void>;
  nextSection(): Promise<void>;
  prevSection(): Promise<void>;
  firstSection(): Promise<void>;
  contents(): SectionContents | null;
  /** Theme + highlight CSS, repainted into the live section document. */
  setTheme(css: string): void;
  onRelocate(fn: (loc: Relocated) => void): () => void;
  onLoad(fn: (c: SectionContents) => void): () => void;
  destroy(): void;
}

interface PaginatorEl extends HTMLElement {
  open(book: unknown): void;
  goTo(target: unknown): Promise<void>;
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  nextSection(): Promise<void>;
  prevSection(): Promise<void>;
  firstSection(): Promise<void>;
  getContents(): { index: number; doc: Document }[];
  setStyles(styles: string): void;
  destroy(): void;
  addEventListener(type: "load" | "relocate", fn: (ev: Event) => void): void;
  removeEventListener(type: "load" | "relocate", fn: (ev: Event) => void): void;
}

/** Mount a scrolled foliate paginator into a container element. */
export function mountView(container: HTMLElement): ReaderView {
  const el = document.createElement("foliate-paginator") as PaginatorEl;
  el.setAttribute("flow", "scrolled");
  container.replaceChildren(el);
  return {
    el,
    open: (book) => el.open(book),
    goTo: (target) => el.goTo(target),
    nextPage: () => el.next(),
    prevPage: () => el.prev(),
    nextSection: () => el.nextSection(),
    prevSection: () => el.prevSection(),
    firstSection: () => el.firstSection(),
    contents: () => el.getContents()[0] ?? null,
    setTheme: (css) => el.setStyles(css),
    onRelocate: (fn) => {
      const listener = (ev: Event): void => {
        const d = (ev as CustomEvent).detail as { index: number; fraction?: number; range?: Range };
        fn({ index: d.index, fraction: typeof d.fraction === "number" ? d.fraction : 0, range: d.range ?? null });
      };
      el.addEventListener("relocate", listener);
      return () => el.removeEventListener("relocate", listener);
    },
    onLoad: (fn) => {
      const listener = (ev: Event): void => {
        const d = (ev as CustomEvent).detail as { index: number; doc: Document };
        fn({ index: d.index, doc: d.doc });
      };
      el.addEventListener("load", listener);
      return () => el.removeEventListener("load", listener);
    },
    destroy: () => {
      try {
        el.destroy();
      } catch {
        // Tearing down; nothing to destroy.
      }
      el.remove();
    },
  };
}
