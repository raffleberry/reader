/**
 * Sentences inside one section document. Blocks are walked in document
 * order, each block's text is split with Intl.Segmenter (real Unicode
 * sentence boundaries, not a regex), and every sentence maps back to a DOM
 * Range in the same document — so the highlight is the sentence itself,
 * never a text search for it.
 *
 * The walk is deterministic for a given document: inventory built from an
 * unrendered section document and ranges resolved in the live rendered one
 * line up, because scripts and styles (the only things the renderer strips)
 * are skipped here too.
 */
import type { Sentence } from "../api/voice";

const BLOCKS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "div",
  "pre", "dt", "dd", "figcaption", "td", "th",
]);

const segmenter = new Intl.Segmenter(undefined, { granularity: "sentence" });

interface Block {
  el: Element;
  text: string;
}

/** Leaf blocks in document order (parent divs would double-count). */
function blocksOf(doc: Document): Block[] {
  const out: Block[] = [];
  const els = doc.body?.getElementsByTagName("*") ?? [];
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
    if (nested) continue;
    // Script/style text is not read aloud; drop it before segmenting so its
    // words never become sentences.
    const clone = el.cloneNode(true) as Element;
    for (const s of clone.querySelectorAll("script,style")) s.remove();
    const text = (clone.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length < 2) continue;
    out.push({ el, text });
  }
  return out;
}

interface Seg {
  text: string;
  /** Offset in the block's collapsed text. */
  index: number;
}

function blockSegs(text: string): Seg[] {
  const out: Seg[] = [];
  for (const { segment, index } of segmenter.segment(text)) {
    const s = segment.trim();
    // Segmenter reports the raw offset; the text is already collapsed, so
    // trimming only ever moves the start — re-anchor it exactly.
    const at = text.indexOf(s, Math.min(index, text.length));
    if (s && at >= 0) out.push({ text: s, index: at });
  }
  return out;
}

/** Sentence texts of one section document, in order. */
export function segmentDoc(doc: Document): string[] {
  const out: string[] = [];
  for (const { text } of blocksOf(doc)) {
    for (const { text: s } of blockSegs(text)) out.push(s);
  }
  return out;
}

/**
 * DOM Range of the i-th sentence in a live section document. Null when the
 * document changed shape under us — audio still plays, highlight skipped.
 */
export function rangeOfSentence(doc: Document, i: number): Range | null {
  if (i < 0) return null;
  let n = 0;
  for (const { el, text } of blocksOf(doc)) {
    const segs = blockSegs(text);
    if (i < n + segs.length) {
      const want = segs[i - n];
      const range = doc.createRange();
      try {
        range.selectNodeContents(el);
      } catch {
        return null;
      }
      // Narrow the block range to the sentence. Whitespace in the live DOM
      // can differ from the collapsed segmentation text, so search a
      // collapsed copy and map the hit back to node offsets.
      const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const nodes: Text[] = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const t = node as Text;
        if (!t.parentElement?.closest("script,style")) nodes.push(t);
      }
      let collapsed = "";
      const back: number[] = [];
      let ws = true;
      const joined = nodes.map((t) => t.data).join("");
      for (let k = 0; k < joined.length; k++) {
        if (/\s/.test(joined[k]!)) {
          if (!ws && collapsed) {
            collapsed += " ";
            back.push(k);
            ws = true;
          }
        } else {
          collapsed += joined[k];
          back.push(k);
          ws = false;
        }
      }
      collapsed = collapsed.trim();
      // The segmenter's own offset, mapped through the back-map. Repeats
      // inside one block resolve by position, not by first match.
      const at = want.index;
      // Unfound: fall back to the whole block rather than a wrong slice.
      if (at < 0 || collapsed.slice(at, at + want.text.length) !== want.text) return range;
      const rawAt = back[at] ?? 0;
      const rawEnd = (back[at + want.text.length - 1] ?? rawAt) + 1;
      // rawAt/rawEnd are offsets into `joined`; split them across nodes.
      let start: { node: Text; off: number } | null = null;
      let end: { node: Text; off: number } | null = null;
      let pos = 0;
      for (const t of nodes) {
        const next = pos + t.data.length;
        if (!start && rawAt < next) start = { node: t, off: rawAt - pos };
        if (rawEnd <= next) {
          end = { node: t, off: rawEnd - pos };
          break;
        }
        if (rawEnd > pos) end = { node: t, off: t.data.length };
        pos = next;
      }
      if (!start || !end) return range;
      try {
        range.setStart(start.node, Math.min(start.off, start.node.data.length));
        range.setEnd(end.node, Math.min(end.off, end.node.data.length));
      } catch {
        return range;
      }
      return range;
    }
    n += segs.length;
  }
  return null;
}

/**
 * Index of the sentence containing a selection point, or -1. The point's
 * own document tells us which occurrence is meant, so a repeated phrase
 * resolves to the one actually selected.
 */
export function sentenceAtPoint(doc: Document, node: Node, offset: number, count: number): number {
  for (let i = 0; i < count; i++) {
    const range = rangeOfSentence(doc, i);
    if (!range) continue;
    try {
      if (range.isPointInRange(node, offset)) return i;
    } catch {
      continue;
    }
  }
  return -1;
}

/** Global sentence inventory entry: which section, and where in it. */
export function sectionStart(sentences: Sentence[], global: number): number {
  const section = sentences[global]?.chapter ?? -1;
  let i = global;
  while (i > 0 && sentences[i - 1]?.chapter === section) i--;
  return i;
}
