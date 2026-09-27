/**
 * The read-aloud highlight: the sentence being spoken, and the word in it.
 *
 * epub.js throws a chapter's document away and re-renders it whenever the
 * page is re-laid out — and hiding the sidebar does exactly that, because
 * the frame resizes. Anything we injected into that DOM dies with it. So
 * the highlight is kept here as *text*, and `reapply()` finds it again in
 * whatever document epub.js hands us next: the highlight follows the book,
 * not the DOM node, and it survives any re-render for any reason.
 */
import { paintSentence, paintWord } from "./locate";
import type { PaintedSentence } from "./locate";

export const SENT_CLS = "tts-sent";
export const WORD_CLS = "tts-word";

/** One highlighted sentence, and how far through it the words have gone. */
export class Mark {
  /** The sentence as plain text — what we look for in a fresh document. */
  readonly text: string;
  /** The live wrapper; word highlights are painted inside it. */
  ps: PaintedSentence;
  /** Collapsed-text offset past the last painted word. */
  cursor = 0;
  unpaintWord: (() => void) | null = null;

  constructor(text: string, ps: PaintedSentence) {
    this.text = text;
    this.ps = ps;
  }

  /** Highlight one word, searching on from the last. Misses are skipped. */
  paint(word: string): void {
    try {
      const hit = paintWord(this.ps, word, this.cursor, WORD_CLS);
      if (!hit) return;
      this.cursor = hit.end;
      this.clearWord();
      this.unpaintWord = hit.unpaint;
    } catch {
      // A live-DOM paint failed: skip this word, keep the audio playing.
    }
  }

  /** Start the word search over from the beginning of the sentence. */
  rewind(): void {
    this.cursor = 0;
  }

  clearWord(): void {
    this.unpaintWord?.();
    this.unpaintWord = null;
  }

  dispose(): void {
    this.clearWord();
    this.ps.unpaint();
  }
}

let cur: Mark | null = null;

/** The highlight currently on screen, if any. */
export function current(): Mark | null {
  return cur;
}

/** Highlight this sentence in a document. Null when it isn't on the page. */
export function show(doc: Document, text: string): Mark | null {
  clear();
  const ps = paintSentence(doc, text, SENT_CLS);
  if (!ps) return null;
  cur = new Mark(text, ps);
  return cur;
}

/**
 * Put the highlight back after epub.js re-rendered the chapter. True when it
 * was found again; false when nothing is highlighted or this document simply
 * isn't the one holding it (a page turn), in which case the existing mark is
 * left alone.
 */
export function reapply(doc: Document): boolean {
  const mark = cur;
  if (!mark) return false;
  if (mark.ps.doc === doc) {
    // Same document, restyled: keep the spans, restart the word search.
    mark.rewind();
    return true;
  }
  const ps = paintSentence(doc, mark.text, SENT_CLS);
  if (!ps) return false;
  const next = new Mark(mark.text, ps);
  cur = next;
  mark.dispose();
  return true;
}

/** Forget the highlight and take it back off the page. */
export function clear(): void {
  cur?.dispose();
  cur = null;
}
