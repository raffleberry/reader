/**
 * EPUB text extraction in the browser: zip + spine chapters -> sentences.
 * Same key scheme as the old backend ("00-0003" = chapter-sentence) so
 * the player and highlighter work unchanged.
 */
import JSZip from "jszip";
import type { Sentence } from "../api/voice";

const BLOCKS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "div",
]);

export interface ParsedBook {
  title: string;
  sentences: Sentence[];
}

/** Split one paragraph. Dumb on purpose; matches the old backend. */
export function splitSentences(block: string): string[] {
  return block
    .split(/(?<=[.!?…])\s+(?=[A-Z0-9“"(\[])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function xml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("bad epub xml");
  return doc;
}

/** Parse an EPUB blob. Throws Error("...") on anything unreadable. */
export async function parseEpub(blob: Blob): Promise<ParsedBook> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(blob);
  } catch {
    throw new Error("not a valid .epub file");
  }
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("not an epub (no container.xml)");
  const container = xml(await containerFile.async("text"));
  const rootfile = container.getElementsByTagName("rootfile")[0];
  const opfPath = rootfile?.getAttribute("full-path");
  if (!opfPath) throw new Error("not an epub (no rootfile)");
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error("not an epub (broken manifest)");
  const opf = xml(await opfFile.async("text"));
  const title =
    opf.getElementsByTagName("dc:title")[0]?.textContent?.trim() || "Untitled";
  const manifest = new Map<string, string>();
  for (const item of opf.getElementsByTagName("item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifest.set(id, href);
  }
  const spine: string[] = [];
  for (const ref of opf.getElementsByTagName("itemref")) {
    const idref = ref.getAttribute("idref");
    if (idref) spine.push(idref);
  }

  const sentences: Sentence[] = [];
  let chapter = 0;
  for (const idref of spine) {
    const href = manifest.get(idref);
    if (!href) continue;
    const file = zip.file(base + href);
    if (!file) continue;
    const chapterSents = chapterSentences(await file.async("text"), chapter, href);
    if (chapterSents.length) {
      sentences.push(...chapterSents);
      chapter++;
    }
  }
  if (!sentences.length) throw new Error("no readable text found");
  return { title, sentences };
}

function chapterSentences(html: string, chapter: number, href: string): Sentence[] {
  // Lenient HTML parsing: real chapters are often not well-formed XML.
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out: Sentence[] = [];
  const els = doc.getElementsByTagName("*");
  for (const el of els) {
    const tag = el.localName.toLowerCase();
    if (!BLOCKS.has(tag)) continue;
    let nested = false;
    for (const child of el.children) {
      if (BLOCKS.has(child.localName.toLowerCase())) {
        nested = true;
        break;
      }
    }
    if (nested) continue; // parent divs would double-count their paragraphs
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length < 2) continue;
    for (const sent of splitSentences(text)) {
      const n = out.length;
      out.push({
        key: `${String(chapter).padStart(2, "0")}-${String(n).padStart(4, "0")}`,
        chapter,
        href,
        text: sent,
      });
    }
  }
  return out;
}
