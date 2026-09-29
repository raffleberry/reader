import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";
import type { Contents } from "epubjs";
import { getWords, speakAudio } from "../api/voice";
import type { Sentence, Word } from "../api/voice";
import { speakable } from "../text/speak";
import { downMessage } from "../ext/serve";
import { applyRate, reload, setSource, sound } from "../tts/sound";
import { clear as clearMark, current, reapply, show as showMark } from "../tts/mark";
import { usePrefs } from "./prefs";
import { useReader } from "./reader";
import type { BookRendition } from "../types";

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
/** Drops stale runs (stop / new start). */
let run = 0;
/** Drops stale play() calls (pause / stop / new start). */
let playToken = 0;
let raf = 0;
let wordIdx = -1;
let words: Word[] = [];
/** Decoded-ahead sentence audio, keyed by sentence index. */
const ahead = new Map<number, ReadyAudio>();

/**
 * Read-aloud engine: one audio element fed from a lookahead queue.
 * The next sentences' audio is fetched while the current one plays, so
 * chapter boundaries don't stall; word highlights follow the element's
 * own clock instead of chained timers, so pause/resume can't drift.
 */
export const usePlayer = defineStore("player", () => {
  const phase = ref<Phase>("idle");
  const pos = ref(0);
  const error = ref("");

  const busy = computed(() => phase.value === "playing" || phase.value === "loading" || phase.value === "paused");

  // Speed lives in prefs (so the options page and the sidebar agree); the
  // element is told about every change, wherever it came from.
  watch(
    () => usePrefs().rate,
    (r) => applyRate(r),
    { immediate: true },
  );

  function hardStop(): void {
    run++;
    playToken++;
    sound().pause();
    setSource("");
    stopWords();
    clearMark();
    clearAhead();
  }

  /**
   * Play one sentence, then the next. `myRun` drops stale runs.
   */
  async function playAt(i: number, myRun: number): Promise<void> {
    const reader = useReader();
    // Scene breaks and other punctuation-only lines ("***", "❦") make the
    // speech service return no audio at all; skip them instead of failing.
    while (i < reader.sentences.length && !speakable(reader.sentences[i].text)) i++;
    if (i >= reader.sentences.length) {
      stop();
      return;
    }
    pos.value = i;
    phase.value = "loading";
    const sent = reader.sentences[i];
    try {
      await showSentence(reader.rendition, sent, usePrefs().autoScroll, () => myRun === run);
      if (myRun !== run) return;
      const item = await ensureAudio(i, myRun);
      if (!item || myRun !== run) return;
      words = item.words;
      void lookahead(i, myRun);
      setSource(item.url);
      phase.value = "playing";
      sound().onended = () => {
        if (myRun === run) void playAt(i + 1, myRun);
      };
      sound().onerror = () => {
        if (myRun === run) void playAt(i + 1, myRun);
      };
      beginWords();
      await playCurrent(myRun);
    } catch (err) {
      if (myRun !== run) return;
      stopWords();
      // Paused mid-load: the pending play() rejects with AbortError, but
      // that is an intentional pause, not a playback failure.
      if ((phase.value as Phase) === "paused") return;
      phase.value = "error";
      error.value = (err as Error).message;
      console.error(`[player] playback failed at sentence ${pos.value}:`, err);
    }
  }

  async function start(from = 0): Promise<void> {
    const prefs = usePrefs();
    // Nothing to speak to: say so plainly instead of failing on a request.
    if (!(await prefs.ensureServer())) {
      hardStop();
      phase.value = "error";
      error.value = downMessage();
      return;
    }
    hardStop();
    error.value = "";
    const at = Number.isFinite(from) ? Math.max(0, Math.floor(from)) : 0;
    await playAt(at, ++run);
  }

  function stop(): void {
    hardStop();
    phase.value = "idle";
    pos.value = 0;
  }

  function pause(): void {
    if (phase.value !== "playing") return;
    playToken++;
    sound().pause();
    stopWords();
    phase.value = "paused";
  }

  async function resume(): Promise<void> {
    if (phase.value !== "paused") return;
    phase.value = "playing";
    beginWords();
    try {
      await playCurrent(run);
    } catch (err) {
      stopWords();
      phase.value = "error";
      error.value = (err as Error).message;
      console.error(`[player] resume failed at sentence ${pos.value}:`, err);
    }
  }

  return { phase, pos, error, busy, start, stop, pause, resume };
});

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
  applyRate(usePrefs().rate);
  try {
    await sound().play();
    return;
  } catch (err) {
    if (tok !== playToken || myRun !== run) return;
    if (currentPhase(usePlayer()) === "paused") return;
    if ((err as DOMException)?.name !== "AbortError") throw err;
  }
  if (tok !== playToken || myRun !== run) return;
  if (currentPhase(usePlayer()) === "paused") return;
  const tok2 = ++playToken;
  reload();
  try {
    await sound().play();
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
  const k = Math.max(0, usePrefs().readahead);
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
    if (!speakable(sent.text)) continue;
    jobs.push(
      Promise.all([getWords(sent.text), speakAudio(sent.text)])
        .then(([w, u]) => {
          if (myRun !== run) {
            URL.revokeObjectURL(u);
            return;
          }
          const pos = usePlayer().pos;
          if (j <= pos || j > pos + Math.max(0, usePrefs().readahead) || ahead.has(j)) {
            URL.revokeObjectURL(u);
            return;
          }
          ahead.set(j, { url: u, words: w });
        })
        .catch((err: unknown) => {
          console.warn(`[player] lookahead failed for sentence ${j}:`, err);
        }),
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
  if (!current() || !words.length) return;
  const step = (): void => {
    raf = 0;
    // Read the mark every frame: a re-render swaps it underneath us.
    const mark = current();
    if (!mark) return;
    const t = sound().currentTime * 1000;
    let n = wordIdx;
    while (n + 1 < words.length && words[n + 1].start_ms <= t) n++;
    if (n !== wordIdx) {
      wordIdx = n;
      const w = words[wordIdx];
      if (w) mark.paint(w.text);
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
  clearMark();
  if (!rendition) return;
  const doc = await ensureSentenceDoc(rendition, sent, alive);
  if (!doc || !alive()) return;
  const mark = showMark(doc, sent.text);
  if (!mark) return; // audio still plays; highlight skipped
  if (scroll) {
    // The chapter's iframe first, then the sentence inside it: in the book's
    // one continuous scroll, centring the iframe would only land us in the
    // middle of the chapter, and the sentence is what should be centred.
    doc.defaultView?.frameElement?.scrollIntoView?.({ block: "center" });
    mark.ps.el.scrollIntoView({ block: "center" });
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

// --- surviving a re-render --------------------------------------------

/**
 * epub.js re-rendered the chapter — a resize re-lays out the page, and
 * hiding the sidebar resizes it. The old document (and everything we
 * painted in it) is gone, so put the highlight back in the new one and let
 * the audio clock re-anchor the word on its next frame.
 */
export function rerender(doc: Document): void {
  if (reapply(doc)) wordIdx = -1;
}
