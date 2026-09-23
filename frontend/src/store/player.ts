import { defineStore } from "pinia";
import { createPinia, setActivePinia } from "pinia";
import type { Contents } from "epubjs";
import { getWords, speakAudio } from "../api/voice";
import type { Sentence, Word } from "../api/voice";
import { paintSentence, paintWord } from "../tts/locate";
import type { PaintedSentence } from "../tts/locate";
import { useReader } from "./reader";
import type { BookRendition } from "../types";

const SENT_CLS = "tts-sent";
const WORD_CLS = "tts-word";

export type Phase = "idle" | "loading" | "playing" | "paused" | "error";

export interface ReadyAudio {
  url: string;
  words: Word[];
}

/** epub.js types getContents() as one Contents; at runtime it is an array. */
function contentsOf(rendition: BookRendition): Contents[] {
  return rendition.getContents() as unknown as Contents[];
}

/** Module-scope playback bits (never reactive). */
const sound = new Audio();
sound.preload = "auto";
sound.preservesPitch = true;
/** Drops stale runs (stop / new start). */
let run = 0;
/** Drops stale play() calls (pause / stop / new start). */
let playToken = 0;
let raf = 0;
let wordIdx = -1;
let words: Word[] = [];
/** Object URL currently assigned to the element (revoked on swap). */
let blobUrl = "";
/** Decoded-ahead sentence audio, keyed by sentence index. */
const ahead = new Map<number, ReadyAudio>();
let painted: {
  unpaintSent: () => void;
  unpaintWord: (() => void) | null;
  ps: PaintedSentence;
  /** Collapsed-text offset past the last painted word. */
  cursor: number;
} | null = null;

/** Playback speed; sidecar Settings value, local only. */
const RATE_KEY = "reader.rate";

/** Offered speeds (client-side element rate, pitch preserved). */
export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function storedRate(): number {
  const raw = localStorage.getItem(RATE_KEY);
  if (raw === null) return 1;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0.5, n));
}

/** Push the stored speed onto the element (client-side, pitch preserved). */
function applyRate(): void {
  sound.preservesPitch = true;
  sound.playbackRate = storedRate();
}

/** Fresh player store on its own pinia; used by browser tests. */
export function isolatedPlayer(): ReturnType<typeof usePlayer> {
  setActivePinia(createPinia());
  return usePlayer();
}

/** Element rate for tests (the store itself is reactive state + actions). */
export function audioRate(): number {
  return sound.playbackRate;
}

applyRate();

/** Read-ahead window (sentences); Settings page value, local only. */
const AHEAD_KEY = "reader.readahead";

/** Auto-scroll with the spoken sentence; sidecar Settings value, local only. */
const SCROLL_KEY = "reader.autoscroll";

function storedScroll(): boolean {
  return localStorage.getItem(SCROLL_KEY) === "1";
}

function readAhead(): number {
  const n = Number(localStorage.getItem(AHEAD_KEY) || 3);
  return Number.isFinite(n) && n >= 0 ? Math.min(10, Math.floor(n)) : 3;
}

/**
 * Read-aloud engine: one audio element fed from a lookahead queue.
 * The next sentences' audio is fetched while the current one plays, so
 * chapter boundaries don't stall; word highlights follow the element's
 * own clock instead of chained timers, so pause/resume can't drift.
 */
export const usePlayer = defineStore("player", {
  state: () => ({
    phase: "idle" as Phase,
    pos: 0 as number,
    error: "" as string,
    autoScroll: storedScroll() as boolean,
    rate: storedRate() as number,
  }),
  getters: {
    busy(state): boolean {
      return state.phase === "playing" || state.phase === "loading";
    },
  },
  actions: {
    async start(from = 0): Promise<void> {
      this.hardStop();
      this.error = "";
      const at = Number.isFinite(from) ? Math.max(0, Math.floor(from)) : 0;
      await this.playAt(at, ++run);
    },
    stop(): void {
      this.hardStop();
      this.phase = "idle";
      this.pos = 0;
    },
    pause(): void {
      if (this.phase !== "playing") return;
      playToken++;
      sound.pause();
      stopWords();
      this.phase = "paused";
    },
    async resume(): Promise<void> {
      if (this.phase !== "paused") return;
      this.phase = "playing";
      beginWords();
      try {
        await playCurrent(run);
      } catch (err) {
        stopWords();
        this.phase = "error";
        this.error = (err as Error).message;
      }
    },
    toggleScroll(): void {
      this.autoScroll = !this.autoScroll;
      localStorage.setItem(SCROLL_KEY, this.autoScroll ? "1" : "0");
    },
    setRate(rate: number): void {
      const r = Number.isFinite(rate) ? Math.min(2, Math.max(0.5, rate)) : 1;
      this.rate = r;
      localStorage.setItem(RATE_KEY, String(r));
      applyRate();
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
        await showSentence(reader.rendition, sent, this.autoScroll, () => myRun === run);
        if (myRun !== run) return;
        const item = await ensureAudio(i, myRun);
        if (!item || myRun !== run) return;
        words = item.words;
        void lookahead(i, myRun);
        setActive(item.url);
        this.phase = "playing";
        sound.onended = () => {
          if (myRun === run) void this.playAt(i + 1, myRun);
        };
        sound.onerror = () => {
          if (myRun === run) void this.playAt(i + 1, myRun);
        };
        beginWords();
        await playCurrent(myRun);
      } catch (err) {
        if (myRun !== run) return;
        stopWords();
        // Paused mid-load: the pending play() rejects with AbortError, but
        // that is an intentional pause, not a playback failure.
        if (currentPhase(this) === "paused") return;
        this.phase = "error";
        this.error = (err as Error).message;
      }
    },

    hardStop(): void {
      run++;
      playToken++;
      sound.pause();
      sound.removeAttribute("src");
      setActive("");
      stopWords();
      clearPaint();
      clearAhead();
    },
  },
});

/** Assign audio to the element, revoking whatever it replaces. */
function setActive(url: string): void {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = url;
  if (url) sound.src = url;
}

/** Phase read that narrowing can't second-guess (pause/stop interleave). */
function currentPhase(player: { phase: Phase }): Phase {
  return player.phase;
}

/**
 * play() guarded by a token: pause/stop/new-start invalidate the pending
 * call, so its AbortError dies silently. A transient abort with playback
 * still wanted reloads once; anything else surfaces to the caller.
 */
async function playCurrent(myRun: number): Promise<void> {
  const tok = ++playToken;
  applyRate();
  try {
    await sound.play();
    return;
  } catch (err) {
    if (tok !== playToken || myRun !== run) return;
    if (currentPhase(usePlayer()) === "paused") return;
    if ((err as DOMException)?.name !== "AbortError") throw err;
  }
  if (tok !== playToken || myRun !== run) return;
  if (currentPhase(usePlayer()) === "paused") return;
  const tok2 = ++playToken;
  if (blobUrl) sound.src = blobUrl;
  try {
    await sound.play();
  } catch (err) {
    if (tok2 !== playToken || myRun !== run) return;
    if (currentPhase(usePlayer()) === "paused") return;
    throw err;
  }
}

/** Sentence audio, from the lookahead cache or freshly fetched. */
async function ensureAudio(i: number, myRun: number): Promise<ReadyAudio | null> {
  const hit = ahead.get(i);
  if (hit) {
    ahead.delete(i);
    return hit;
  }
  const sent = useReader().sentences[i];
  if (!sent) return null;
  const [fetchedWords, url] = await Promise.all([
    getWords(sent.text),
    speakAudio(sent.text),
  ]);
  if (myRun !== run) {
    URL.revokeObjectURL(url);
    return null;
  }
  return { url, words: fetchedWords };
}

/** Fetch the next sentences' audio while the current one plays. */
async function lookahead(from: number, myRun: number): Promise<void> {
  const reader = useReader();
  const k = Math.max(0, readAhead());
  for (const key of [...ahead.keys()]) {
    if (key <= from || key > from + k) {
      URL.revokeObjectURL(ahead.get(key)!.url);
      ahead.delete(key);
    }
  }
  const last = Math.min(from + k, reader.sentences.length - 1);
  const jobs: Promise<void>[] = [];
  for (let j = from + 1; j <= last; j++) {
    if (ahead.has(j)) continue;
    const sent = reader.sentences[j];
    jobs.push(
      Promise.all([getWords(sent.text), speakAudio(sent.text)])
        .then(([w, u]) => {
          if (myRun !== run) {
            URL.revokeObjectURL(u);
            return;
          }
          const pos = usePlayer().pos;
          if (j <= pos || j > pos + Math.max(0, readAhead()) || ahead.has(j)) {
            URL.revokeObjectURL(u);
            return;
          }
          ahead.set(j, { url: u, words: w });
        })
        .catch(() => undefined),
    );
  }
  await Promise.all(jobs);
}

function clearAhead(): void {
  for (const item of ahead.values()) URL.revokeObjectURL(item.url);
  ahead.clear();
}

/** Follow the element clock, painting the word under it. */
function beginWords(): void {
  stopWords();
  wordIdx = -1;
  if (!painted || !words.length) return;
  const step = (): void => {
    raf = 0;
    if (!painted) return;
    const t = sound.currentTime * 1000;
    let n = wordIdx;
    while (n + 1 < words.length && words[n + 1].start_ms <= t) n++;
    if (n !== wordIdx) {
      wordIdx = n;
      clearWord();
      const w = words[wordIdx];
      if (w && painted) {
        try {
          const paintedWord = paintWord(painted.ps, w.text, painted.cursor, WORD_CLS);
          if (paintedWord) {
            painted.cursor = paintedWord.end;
            painted.unpaintWord = paintedWord.unpaint;
          }
        } catch {
          // Live-DOM paint failed: skip this word, keep the audio playing.
        }
      }
    }
    const last = words[wordIdx];
    if (wordIdx >= words.length - 1 && last && t > last.end_ms) return;
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

function stopWords(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

/** Display + highlight one sentence. Never throws for a missing highlight. */
async function showSentence(
  rendition: BookRendition | null,
  sent: Sentence,
  scroll: boolean,
  alive: () => boolean,
): Promise<void> {
  clearPaint();
  if (!rendition) return;
  const doc = await ensureSentenceDoc(rendition, sent, alive);
  if (!doc || !alive()) return;
  const ps = paintSentence(doc, sent.text, SENT_CLS);
  if (!ps) return; // audio still plays; highlight skipped
  painted = { unpaintSent: ps.unpaint, unpaintWord: null, ps, cursor: 0 };
  if (scroll) {
    ps.el.scrollIntoView({ block: "center" });
    doc.defaultView?.frameElement?.scrollIntoView?.({ block: "center" });
  }
}

/** Docs currently loaded in the rendition (the visible pages). */
function loadedDocs(rendition: BookRendition): Document[] {
  return contentsOf(rendition)
    .map((c) => c.document)
    .filter((d): d is Document => !!d?.body);
}

/**
 * First loaded doc containing the sentence head (full 40 chars, then a
 * 20-char backoff for chapters whose text drifts). Null when the sentence
 * is not on screen — the caller decides whether to display/page.
 */
function chapterDoc(rendition: BookRendition | null, probe: string): Document | null {
  if (!rendition) return null;
  const collapsed = probe.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  const docs = loadedDocs(rendition);
  for (const head of [collapsed.slice(0, 40), collapsed.slice(0, 20)]) {
    if (!head) continue;
    for (const doc of docs) {
      if (doc.body.textContent?.replace(/\s+/g, " ").includes(head)) return doc;
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => window.setTimeout(done, ms));
}

/**
 * The doc showing this sentence, displaying/paging as needed. Sentences on
 * the visible page return without touching the rendition (no flicker); a
 * chapter change displays once, then pages forward until the sentence is
 * visible (multi-page chapters). Null when it never appears.
 */
export async function ensureSentenceDoc(
  rendition: BookRendition | null,
  sent: Sentence,
  alive: () => boolean,
): Promise<Document | null> {
  if (!rendition) return null;
  if (chapterDoc(rendition, sent.text)) {
    return chapterDoc(rendition, sent.text);
  }
  try {
    await rendition.display(sent.href);
  } catch {
    return null;
  }
  // Let the fresh chapter render before turning any pages.
  for (let i = 0; i < 20 && alive(); i++) {
    if (chapterDoc(rendition, sent.text)) {
      return chapterDoc(rendition, sent.text);
    }
    await sleep(50);
  }
  // Sentence further into a multi-page chapter: turn pages until visible.
  for (let p = 0; p < 10 && alive(); p++) {
    try {
      await rendition.next();
    } catch {
      break;
    }
    if (chapterDoc(rendition, sent.text)) {
      return chapterDoc(rendition, sent.text);
    }
  }
  return null;
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
