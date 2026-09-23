import { defineStore } from "pinia";
import type { Contents } from "epubjs";
import { audioUrl, getWords } from "../api/voice";
import type { Sentence, Word } from "../api/voice";
import {
  findSentence,
  paint,
  rangeFromNorm,
  wordSpans,
} from "../tts/locate";
import type { FlatMap, WordSpan } from "../tts/locate";
import { useReader } from "./reader";
import type { BookRendition } from "../types";

const SENT_CLS = "tts-sent";
const WORD_CLS = "tts-word";

export type Phase = "idle" | "loading" | "playing" | "paused" | "error";

/** epub.js types getContents() as one Contents; at runtime it is an array. */
function contentsOf(rendition: BookRendition): Contents[] {
  return rendition.getContents() as unknown as Contents[];
}

/** Module-scope playback bits (never reactive). */
const sound = new Audio();
let run = 0;
let timers: number[] = [];
let spans: WordSpan[] = [];
let words: Word[] = [];
let blobUrl = "";
let painted: {
  unpaintSent: () => void;
  unpaintWord: (() => void) | null;
  doc: Document;
  map: FlatMap;
  at: number;
} | null = null;

/** Read-aloud engine: sentence audio, word highlight, auto-scroll. */
export const usePlayer = defineStore("player", {
  state: () => ({
    phase: "idle" as Phase,
    pos: 0 as number,
    error: "" as string,
    autoScroll: true as boolean,
    bookId: "" as string,
  }),
  getters: {
    busy(state): boolean {
      return state.phase === "playing" || state.phase === "loading";
    },
  },
  actions: {
    async start(bookId: string): Promise<void> {
      this.hardStop();
      this.bookId = bookId;
      this.error = "";
      await this.playAt(0, ++run);
    },
    stop(): void {
      this.hardStop();
      this.phase = "idle";
      this.pos = 0;
    },
    pause(): void {
      if (this.phase !== "playing") return;
      sound.pause();
      clearTimers();
      this.phase = "paused";
    },
    async resume(): Promise<void> {
      if (this.phase !== "paused") return;
      this.phase = "playing";
      armWords(sound.currentTime * 1000);
      await sound.play();
    },
    toggleScroll(): void {
      this.autoScroll = !this.autoScroll;
    },

    /**
     * Play one sentence, then the next. `myRun` drops stale runs.
     */
    async playAt(i: number, myRun: number): Promise<void> {
      const reader = useReader();
      if (i >= reader.sentences.length) {
        this.stop();
        return;
      }
      this.pos = i;
      this.phase = "loading";
      const sent = reader.sentences[i];
      try {
        await showSentence(reader.rendition, sent, this.autoScroll);
        const [fetchedWords, url] = await Promise.all([
          getWords(this.bookId, sent.key),
          audioBlobUrl(this.bookId, sent.key),
        ]);
        if (myRun !== run) return; // superseded
        words = fetchedWords;
        spans = wordSpans(sent.text, words);
        setBlob(url);
        this.phase = "playing";
        armWords(0);
        sound.onended = () => void this.playAt(i + 1, myRun);
        await sound.play();
      } catch (err) {
        if (myRun !== run) return;
        this.phase = "error";
        this.error = (err as Error).message;
      }
    },

    hardStop(): void {
      run++;
      sound.pause();
      sound.removeAttribute("src");
      setBlob("");
      clearTimers();
      clearPaint();
    },
  },
});

async function audioBlobUrl(bookId: string, key: string): Promise<string> {
  const res = await fetch(audioUrl(bookId, key));
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `audio failed (${res.status})`);
  }
  return URL.createObjectURL(await res.blob());
}

function setBlob(url: string): void {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = url;
  if (url) sound.src = url;
}

/** Schedule word highlights from `fromMs` into the current audio. */
function armWords(fromMs: number): void {
  clearTimers();
  if (!painted) return;
  const { doc, map, at } = painted;
  words.forEach((w, wi) => {
    const span = spans[wi];
    if (!span || w.start_ms < fromMs) return;
    timers.push(
      window.setTimeout(() => {
        clearWord();
        const range = rangeFromNorm(doc, map, at + span.start, at + span.end);
        if (range && painted) painted.unpaintWord = paint(range, WORD_CLS);
      }, w.start_ms - fromMs),
    );
  });
}

function clearTimers(): void {
  timers.forEach(clearTimeout);
  timers = [];
}

/** Display + highlight one sentence. */
async function showSentence(
  rendition: BookRendition | null,
  sent: Sentence,
  scroll: boolean,
): Promise<void> {
  clearPaint();
  if (rendition) {
    try {
      await rendition.display(sent.href);
    } catch {
      // Keep the current page; audio still plays, highlight is skipped.
    }
  }
  const doc = chapterDoc(rendition, sent.text);
  if (!doc) throw new Error("chapter not showing yet, try again");
  const found = findSentence(doc, sent.text);
  if (!found) return; // audio still plays; highlight skipped
  painted = {
    unpaintSent: paint(found.range, SENT_CLS),
    unpaintWord: null,
    doc,
    map: found.map,
    at: found.at,
  };
  if (scroll) {
    const el = parentEl(found.range);
    el?.scrollIntoView({ block: "center" });
    doc.defaultView?.frameElement?.scrollIntoView?.({ block: "center" });
  }
}

function chapterDoc(
  rendition: BookRendition | null,
  probe: string,
): Document | null {
  if (!rendition) return null;
  const head = probe.slice(0, 40).replace(/\s+/g, " ").trim();
  const docs = contentsOf(rendition)
    .map((c) => c.document)
    .filter((d): d is Document => !!d?.body);
  for (const doc of docs) {
    if (doc.body.textContent?.replace(/\s+/g, " ").includes(head)) return doc;
  }
  return docs[0] || null;
}

function parentEl(range: Range): Element | null {
  const n = range.startContainer;
  return n.nodeType === 1 ? (n as Element) : n.parentElement;
}

function clearWord(): void {
  if (painted?.unpaintWord) {
    painted.unpaintWord();
    painted.unpaintWord = null;
  }
}

function clearPaint(): void {
  clearWord();
  if (painted?.unpaintSent) painted.unpaintSent();
  painted = null;
}
