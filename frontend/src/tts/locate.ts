/**
 * Map backend sentences to DOM ranges inside an epub.js chapter document.
 * Raw text nodes are concatenated untouched (exact offsets); a normalized
 * copy with a back-map is used for searching, so whitespace differences
 * between the EPUB source and the rendered DOM cannot misalign us.
 *
 * Painting splits text nodes, so a map built before a paint goes stale.
 * Sentence lookup may use a one-shot map, but word highlights must always
 * go through the live-DOM helpers below (paintSentence/paintWord), which
 * re-walk the sentence element on every call and can never drift.
 */

export interface FlatNode {
  node: Text;
  start: number;
  end: number;
}

export interface FlatMap {
  spans: FlatNode[];
  /** Whitespace-collapsed copy of the text. */
  norm: string;
  /** back[i] is the raw offset of norm[i]. */
  back: number[];
}

export interface WordSpan {
  start: number;
  end: number;
}

/** Collapse whitespace like the backend does. */
export function flat(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

export function flatDoc(doc: Document): FlatMap {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const spans: FlatNode[] = [];
  let raw = "";
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    // Whitespace-only nodes still separate words (inline <span> </span>),
    // so they are kept; only script/style text and empty nodes are dropped.
    const bad = text.parentElement?.closest("script,style") || !text.data.length;
    if (!bad) {
      spans.push({ node: text, start: raw.length, end: raw.length + text.data.length });
      raw += text.data;
    }
    node = walker.nextNode();
  }
  return collapse(raw, spans);
}

/** Same whitespace collapse over a live element (fresh nodes each call). */
function liveMap(el: Element): FlatMap {
  const doc = el.ownerDocument;
  const walker = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const spans: FlatNode[] = [];
  let raw = "";
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    const bad = text.parentElement?.closest("script,style") || !text.data.length;
    if (!bad) {
      spans.push({ node: text, start: raw.length, end: raw.length + text.data.length });
      raw += text.data;
    }
    node = walker.nextNode();
  }
  return collapse(raw, spans);
}

function collapse(raw: string, spans: FlatNode[]): FlatMap {
  let norm = "";
  const back: number[] = [];
  let ws = true;
  for (let i = 0; i < raw.length; i++) {
    if (/\s/.test(raw[i])) {
      if (!ws) {
        norm += " ";
        back.push(i);
        ws = true;
      }
    } else {
      norm += raw[i];
      back.push(i);
      ws = false;
    }
  }
  if (norm.endsWith(" ")) {
    norm = norm.slice(0, -1);
    back.pop();
  }
  return { spans, norm, back };
}

export interface FoundSentence {
  range: Range;
  map: FlatMap;
  /** Norm offset where the sentence starts. */
  at: number;
}

/** Sentence position inside doc; null when the text is not on this page. */
export function findSentence(doc: Document, probe: string): FoundSentence | null {
  const map = flatDoc(doc);
  const want = flat(probe);
  if (!want) return null;
  let at = map.norm.indexOf(want);
  let len = want.length;
  if (at < 0) {
    // Chapter text differs past the head (quotes, tail edits): highlight
    // the matching prefix instead of nothing.
    const head = want.slice(0, 40);
    at = map.norm.indexOf(head);
    len = head.length;
  }
  if (at < 0) return null;
  const range = rangeFromNorm(doc, map, at, Math.min(at + len, map.back.length));
  if (!range) return null;
  return { range, map, at };
}

/** Range from norm offsets; null when out of bounds. */
export function rangeFromNorm(
  doc: Document,
  map: FlatMap,
  fromN: number,
  toN: number,
): Range | null {
  if (fromN >= map.back.length || fromN >= toN) return null;
  toN = Math.min(toN, map.back.length);
  const from = map.back[fromN];
  const to = map.back[toN - 1] + 1;
  return sliceRaw(doc, map.spans, from, to);
}

/** Range from raw offsets; null when out of bounds. */
export function sliceRaw(
  doc: Document,
  spans: FlatNode[],
  from: number,
  to: number,
): Range | null {
  let a: { node: Text; off: number } | null = null;
  let b: { node: Text; off: number } | null = null;
  for (const s of spans) {
    if (!a && from < s.end) a = { node: s.node, off: from - s.start };
    if (to <= s.end) {
      b = { node: s.node, off: to - s.start };
      break;
    }
    if (to > s.start) b = { node: s.node, off: s.node.data.length };
  }
  if (!a || !b) return null;
  const range = doc.createRange();
  // Painting splits text nodes, so a map built before a paint is stale;
  // clamp so a stale word offset can misplace a highlight but never throw.
  const aOff = Math.min(Math.max(0, a.off), a.node.data.length);
  const bOff = Math.min(Math.max(0, b.off), b.node.data.length);
  if (a.node === b.node && aOff > bOff) return null;
  range.setStart(a.node, aOff);
  range.setEnd(b.node, bOff);
  return range;
}

/**
 * Char spans of spoken words inside a sentence (in order).
 * Words that cannot be found are skipped, never misaligned.
 */
export function wordSpans(
  sentence: string,
  words: { text: string }[],
): WordSpan[] {
  const out: WordSpan[] = [];
  let cursor = 0;
  for (const w of words) {
    const bare = w.text.trim();
    if (!bare) continue;
    const at = sentence.indexOf(bare, cursor);
    if (at < 0) continue;
    out.push({ start: at, end: at + bare.length });
    cursor = at + bare.length;
  }
  return out;
}

export interface Painted {
  el: HTMLSpanElement;
  unpaint: () => void;
}

/** Wrap a range in a span. */
export function paint(range: Range, cls: string): Painted {
  const doc = range.startContainer.ownerDocument;
  const span = doc!.createElement("span");
  span.className = cls;
  span.appendChild(range.extractContents());
  range.insertNode(span);
  const unpaint = (): void => {
    span.replaceWith(...span.childNodes);
    doc!.normalize();
  };
  return { el: span, unpaint };
}

export interface PaintedSentence {
  doc: Document;
  /** The live sentence wrapper; word paints happen inside it. */
  el: HTMLSpanElement;
  unpaint: () => void;
}

/** Find one sentence and wrap it; null when the text is not in this doc. */
export function paintSentence(doc: Document, probe: string, cls: string): PaintedSentence | null {
  const found = findSentence(doc, probe);
  if (!found) return null;
  const { el, unpaint } = paint(found.range, cls);
  return { doc, el, unpaint };
}

export interface PaintedWord {
  /** Collapsed-text offset just past the painted word; pass back as `from`. */
  end: number;
  unpaint: () => void;
}

/**
 * Paint one spoken word inside a painted sentence, searching the live DOM
 * from `from`. Unfound words return null and leave the cursor alone, so the
 * caller keeps the old `from` and the next word still aligns. Never throws
 * for stale state: worst case the word is skipped and audio keeps playing.
 */
export function paintWord(
  ps: PaintedSentence,
  word: string,
  from: number,
  cls: string,
): PaintedWord | null {
  const want = flat(word);
  if (!want) return null;
  const text = flat(ps.el.textContent || "");
  const at = text.indexOf(want, Math.max(0, from));
  if (at < 0) return null;
  let range: Range | null = null;
  try {
    range = rangeFromNorm(ps.doc, liveMap(ps.el), at, at + want.length);
  } catch {
    return null;
  }
  if (!range) return null;
  try {
    const { unpaint } = paint(range, cls);
    return { end: at + want.length, unpaint };
  } catch {
    return null;
  }
}

export interface PlacedSentence {
  /** Index into the probes array. */
  index: number;
  /** Norm offset where the sentence starts. */
  at: number;
  /** Norm offset just past the sentence. */
  end: number;
}

/**
 * Lay ordered sentence probes out over one chapter map in a single pass.
 * Probes that cannot be found are skipped. Repeats resolve in order: each
 * search starts where the previous match ended.
 */
export function placeSentences(map: FlatMap, probes: string[]): PlacedSentence[] {
  const out: PlacedSentence[] = [];
  let cursor = 0;
  for (let i = 0; i < probes.length; i++) {
    const want = flat(probes[i]);
    if (!want) continue;
    let at = map.norm.indexOf(want, cursor);
    let len = want.length;
    if (at < 0) {
      const head = want.slice(0, 40);
      at = map.norm.indexOf(head, cursor);
      len = head.length;
    }
    if (at < 0) continue;
    const end = Math.min(at + len, map.norm.length);
    out.push({ index: i, at, end });
    cursor = end;
  }
  return out;
}

/**
 * Which probe the selection starts in, by DOM position — never text search,
 * so a repeated phrase resolves to the occurrence actually selected instead
 * of the first match above it. Returns the probe index, or -1 when the
 * position cannot be placed.
 */
export function sentenceIndexAtSelection(
  doc: Document,
  probes: string[],
  startNode: Node,
  startOffset: number,
): number {
  if (startNode.ownerDocument !== doc) return -1;
  const placed = placeSentences(flatDoc(doc), probes);
  if (!placed.length) return -1;
  let pre: Range;
  try {
    pre = doc.createRange();
    pre.selectNodeContents(doc.body);
    pre.setEnd(startNode, startOffset);
  } catch {
    return -1;
  }
  const selAt = collapsePrefix(pre.toString());
  let best = placed[0];
  for (const p of placed) {
    if (p.at <= selAt) best = p;
    else break;
  }
  return best.index;
}

/**
 * Collapse like flat(), but keep one trailing space: a selection starting a
 * sentence sits right after the gap, and trimming it would map the position
 * one char short — into the previous sentence.
 */
function collapsePrefix(s: string): number {
  return s.replace(/\s+/g, " ").replace(/^ /, "").length;
}
