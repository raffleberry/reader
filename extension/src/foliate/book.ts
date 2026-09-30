/**
 * Open an EPUB file with the vendored foliate-js parser. The book stays in
 * memory: sections are read straight out of the file the user picked, and
 * nothing is stored anywhere.
 *
 * Two things happen on the way in. Book JavaScript is stripped: section
 * documents render same-origin in the reader page, so <script> elements,
 * inline handlers and javascript: links are removed as each resource loads.
 * And every resource keeps flowing through foliate's loader (blob URLs with
 * ref-counting), so images, fonts and stylesheets resolve exactly as the
 * renderer expects.
 */
import { EPUB } from "../../vendor/foliate-js/epub.js";
import { configure, ZipReader, BlobReader, TextWriter, BlobWriter } from "../../vendor/foliate-js/vendor/zip.js";

export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[];
}

/** One spine section: how to load it, name it, and jump to it. */
export interface FoliateSection {
  /** Manifest href, stable for the file. */
  id: string;
  /** Section CFI (the part before the `!`), stable for the file. */
  cfi: string;
  linear: string;
  size: number;
  load(): Promise<string>;
  unload(): void;
  createDocument(): Promise<Document>;
  resolveHref(href: string): { index: number; anchor: (doc: Document) => unknown } | null;
}

export interface NavTarget {
  index: number;
  anchor?: unknown;
}

export interface FoliateBook {
  title: string;
  dir: string;
  sections: FoliateSection[];
  toc: TocItem[];
  resolveHref(href: string): NavTarget | null;
  resolveCFI(cfi: string): NavTarget | null;
  /** Fired per resource as it loads ({ data, type, name }); mutate to transform. */
  transformTarget: EventTarget;
}

interface ZipEntry {
  filename: string;
  getData(writer: unknown): Promise<unknown>;
  uncompressedSize?: number;
}

function stripScripts(doc: Document): void {
  for (const el of doc.querySelectorAll("script")) el.remove();
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node as Element;
    for (const name of el.getAttributeNames()) {
      if (name.toLowerCase().startsWith("on")) el.removeAttribute(name);
    }
    for (const attr of ["href", "src", "xlink:href"]) {
      const v = el.getAttribute(attr);
      if (v && v.trim().toLowerCase().startsWith("javascript:")) el.removeAttribute(attr);
    }
  }
}

/** Remove executable content from one resource; text and layout survive. */
function sanitize(data: unknown, type: string): Promise<unknown> {
  if (typeof data === "string" && /xhtml|html/.test(type)) {
    const doc = new DOMParser().parseFromString(data, "application/xhtml+xml");
    if (!doc.querySelector("parsererror")) {
      stripScripts(doc);
      return Promise.resolve(new XMLSerializer().serializeToString(doc));
    }
    const html = new DOMParser().parseFromString(data, "text/html");
    stripScripts(html);
    return Promise.resolve(`<!DOCTYPE html>${html.documentElement.outerHTML}`);
  }
  return Promise.resolve(data);
}

async function openZip(file: File): Promise<{
  loadText(name: string): Promise<string | null>;
  loadBlob(name: string): Promise<Blob | null>;
  getSize(name: string): number;
}> {
  // No web workers: extension pages have no worker script URL to hand
  // out, so zip.js would hang waiting for one that never answers.
  configure({ useWebWorkers: false });
  const reader = new ZipReader(new BlobReader(file));
  const entries = (await reader.getEntries()) as ZipEntry[];
  const map = new Map(entries.map((e) => [e.filename, e]));
  return {
    loadText: async (name: string) => {
      const entry = map.get(name);
      if (!entry) return null;
      return (await entry.getData(new TextWriter())) as string;
    },
    loadBlob: async (name: string) => {
      const entry = map.get(name);
      if (!entry) return null;
      return (await entry.getData(new BlobWriter())) as Blob;
    },
    getSize: (name: string) => map.get(name)?.uncompressedSize ?? 0,
  };
}

/** Parse an EPUB file into a foliate book. Throws Error("...") when unreadable. */
export async function openEPUB(file: File): Promise<FoliateBook> {
  if (!file.name.toLowerCase().endsWith(".epub")) {
    throw new Error("only .epub files are supported");
  }
  let book;
  try {
    const loader = await openZip(file);
    book = await new EPUB(loader).init();
  } catch {
    throw new Error("not a valid .epub file");
  }
  if (!book.sections?.length) throw new Error("no readable text found");
  book.transformTarget.addEventListener("data", (ev: Event) => {
    const detail = (ev as CustomEvent).detail as { data: unknown; type: string };
    detail.data = Promise.resolve(detail.data).then((data) => sanitize(data, detail.type));
  });
  const title =
    typeof book.metadata?.title === "string"
      ? book.metadata.title
      : (book.metadata?.title?.en ?? book.metadata?.title?.[Object.keys(book.metadata.title)[0]] ?? "Untitled");
  const sections: FoliateSection[] = book.sections.map((s: FoliateSection) => s);
  return {
    title: String(title || "Untitled"),
    dir: book.dir === "rtl" ? "rtl" : "ltr",
    sections,
    toc: (book.toc ?? []) as TocItem[],
    resolveHref: (href: string) => (book.resolveHref(href) as NavTarget | null) ?? null,
    resolveCFI: (cfi: string) => {
      try {
        return (book.resolveCFI(cfi) as NavTarget | null) ?? null;
      } catch {
        return null;
      }
    },
    transformTarget: book.transformTarget as EventTarget,
  };
}
