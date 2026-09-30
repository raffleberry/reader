/**
 * The read-aloud highlight: the sentence being spoken, and the word in it.
 *
 * The viewer keeps one section document alive and re-lays it out in place,
 * so spans we inject survive resizes and sidebar toggles. The highlight is
 * the sentence's own range (`showRange`), and word pills are painted inside
 * it from the audio clock.
 */
import { paintWord } from "./locate";
import type { PaintedSentence } from "./locate";

export const SENT_CLS = "tts-sent";
const WORD_CLS = "tts-word";

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

import { paint } from "./locate";

/** Highlight this sentence range in a document. Null when it cannot wrap. */
export function showRange(doc: Document, range: Range): Mark | null {
  clear();
  let ps;
  try {
    const { el, unpaint } = paint(range, SENT_CLS);
    ps = { doc, el, unpaint };
  } catch {
    return null;
  }
  cur = new Mark(range.toString(), ps);
  return cur;
}

/** Forget the highlight and take it back off the page. */
export function clear(): void {
  cur?.dispose();
  cur = null;
}
