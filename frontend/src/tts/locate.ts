/**
 * Map backend sentences to DOM ranges inside an epub.js chapter document.
 * Raw text nodes are concatenated untouched (exact offsets); a normalized
 * copy with a back-map is used for searching, so whitespace differences
 * between the EPUB source and the rendered DOM cannot misalign us.
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
    const bad =
      text.parentElement?.closest("script,style") || !text.data.trim();
    if (!bad) {
      spans.push({ node: text, start: raw.length, end: raw.length + text.data.length });
      raw += text.data;
    }
    node = walker.nextNode();
  }
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
  let at = map.norm.indexOf(want);
  let len = want.length;
  if (at < 0) {
    at = map.norm.indexOf(want.slice(0, 40));
    len = 40;
  }
  if (at < 0) return null;
  const range = rangeFromNorm(doc, map, at, at + len);
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
  if (fromN >= map.back.length || toN > map.back.length || fromN >= toN) {
    return null;
  }
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
  range.setStart(a.node, Math.max(0, a.off));
  range.setEnd(b.node, Math.max(0, b.off));
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

/** Wrap a range in a span; returns an unpaint function. */
export function paint(range: Range, cls: string): () => void {
  const doc = range.startContainer.ownerDocument;
  const span = doc!.createElement("span");
  span.className = cls;
  span.appendChild(range.extractContents());
  range.insertNode(span);
  return () => {
    span.replaceWith(...span.childNodes);
    doc!.normalize();
  };
}
