/**
 * Range painting inside a section document: wrap a range in a span, and
 * paint spoken words by searching the live DOM on every call. Sentences
 * arrive as ranges from src/text/sentences.ts now — nothing here searches
 * for text anymore.
 */

interface FlatNode {
  node: Text;
  start: number;
  end: number;
}

interface FlatMap {
  spans: FlatNode[];
  /** Whitespace-collapsed copy of the text. */
  norm: string;
  /** back[i] is the raw offset of norm[i]. */
  back: number[];
}

/** Collapse whitespace. */
function flat(s: string): string {
  return s.replace(/\s+/g, " ").trim();
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

/** Range from norm offsets; null when out of bounds. */
function rangeFromNorm(
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
function sliceRaw(
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
