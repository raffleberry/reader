<template>
  <div class="reader-root" @mousedown="hideSel">
    <div class="edge edge-top">
      <ReaderBar
        :title="reader.title"
        :chapter="reader.chapterLabel"
        :page="pageLabel"
        @toc="car.show('toc')"
        @settings="car.show('settings')"
      />
    </div>

    <div ref="frameEl" class="reader-frame">
      <div v-if="IS_DEMO" class="alert alert-info m-3">
        You're trying the online demo — reading works fully, but read-aloud is disabled.
        <a :href="RELEASE_URL" target="_blank" rel="noopener">Download the free app</a>
        to listen to your books.
      </div>
      <div v-if="reader.loading" class="alert alert-info m-3">Loading book…</div>
      <div v-else-if="reader.error" class="alert alert-danger m-3">{{ reader.error }}</div>
      <EpubView
        v-else-if="reader.data"
        ref="view"
        :url="reader.data"
        :location="reader.location || undefined"
        :epub-init-options="{ openAs: 'binary' }"
        :epub-options="epubOptions"
        :enable-key="false"
        :enable-wheel="false"
        :toc-changed="onToc"
        :get-rendition="onRendition"
        @update:location="onLocation"
      >
        <template #loadingView><p class="text-center text-body-secondary mt-5">Opening book…</p></template>
        <template #errorView>
          <p class="text-center text-danger mt-5">This book could not be opened.</p>
        </template>
      </EpubView>
      <div v-if="overSide !== 0" class="over-ind" aria-hidden="true">
        <span class="over-arrow">{{ overArrow }}</span>
        <div class="over-track"><div class="over-fill" :style="{ width: overPct + '%' }"></div></div>
        <span class="over-num">{{ overLabel }} · {{ overDone }}/{{ OVER_TICKS }}</span>
      </div>
    </div>

    <div class="edge edge-bottom">
      <div v-if="player.phase === 'error'" class="player-error" role="alert">
        {{ player.error }}
        <a v-if="IS_DEMO" :href="RELEASE_URL" target="_blank" rel="noopener">Download the free app</a>
      </div>
      <div class="scrub-row">
        <div class="page-group">
          <button class="btn btn-outline-secondary btn-sm" title="Previous page" @click="prev">‹</button>
          <button class="btn btn-outline-secondary btn-sm" title="Next page" @click="next">›</button>
        </div>
        <div class="scrub-slider" @click.stop @pointerdown.stop>
          <input
            ref="sliderEl"
            type="range"
            class="form-range"
            aria-label="Browse pages"
            :min="1"
            :max="sliderMax"
            :value="sliderValue"
            :disabled="!totalPages"
            @pointerdown="scrubStart"
            @input="scrubInput"
            @change="scrubEnd"
            @pointercancel="scrubCancel"
          />
          <div v-if="scrubbing && totalPages" ref="popEl" class="scrub-pop">
            {{ scrubPage }} / {{ totalPages }}
          </div>
          <div class="toc-marks">
            <button
              v-for="m in tocMarks"
              :key="m.page"
              type="button"
              class="toc-mark"
              :style="{ left: `calc(8px + ${m.frac.toFixed(4)} * (100% - 16px))` }"
              :aria-label="`${m.page} | ${m.title}`"
              @mouseenter="markHover(m, $event)"
              @mouseleave="markLeave"
              @click="goPage(m.page)"
            ></button>
          </div>
          <div v-if="markTip" ref="markTipEl" class="mark-tip">{{ markTip.page }} | {{ markTip.title }}</div>
        </div>
        <div class="play-group">
          <button
            v-if="!player.busy"
            class="btn btn-success btn-sm"
            :title="IS_DEMO ? 'Read-aloud needs the downloaded app' : 'Read aloud'"
            :disabled="!canPlay"
            @click="play"
          >
            ▶
          </button>
          <button
            v-else-if="player.phase === 'playing'"
            class="btn btn-warning btn-sm"
            title="Pause"
            @click="player.pause()"
          >
            ⏸
          </button>
          <button
            v-else-if="player.phase === 'paused'"
            class="btn btn-success btn-sm"
            title="Resume"
            @click="resume"
          >
            ▶
          </button>
          <button v-else class="btn btn-secondary btn-sm" disabled title="Loading audio">
            <span class="spinner-border spinner-border-sm"></span>
          </button>
          <button
            v-if="player.busy"
            class="btn btn-outline-danger btn-sm"
            title="Stop"
            @click="player.stop()"
          >
            ⏹
          </button>
          <span v-if="player.busy" class="tts-pos">{{ player.pos + 1 }}/{{ sentTotal }}</span>
        </div>
        <span class="page-count">
          {{ pageLabel }}
        </span>
      </div>
    </div>

    <div
      v-if="selPop"
      ref="selPopEl"
      class="sel-pop"
      @mousedown.stop
    >
      <button class="btn btn-sm btn-outline-secondary" title="Bookmark this passage" @click="markSel">
        🔖
      </button>
      <button v-if="!IS_DEMO" class="btn btn-sm btn-success" title="Read aloud from here" @click="readFromHere">
        ▶
      </button>
      <button class="btn btn-sm btn-outline-secondary" title="Copy" @click="copySel">
        ⧉
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { EpubView } from "vue-reader";
import "vue-reader/lib/index.css";
import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { VirtualElement } from "@floating-ui/dom";
import type { Contents, NavItem } from "epubjs";
import { useReader } from "../store/reader";
import type { ThemeName } from "../store/reader";
import { usePlayer } from "../store/player";
import { newId, putMark } from "../db";
import { sentenceIndexAtSelection } from "../tts/locate";
import { HIGHLIGHT_CSS } from "../theme";
import { contentHook } from "../types";
import type { BookRendition, RelocatedLocation } from "../types";
import ReaderBar from "../components/ReaderBar.vue";
import { useSidecar } from "../store/sidecar";
import { IS_DEMO, RELEASE_URL } from "../demo";

interface EpubViewApi {
  nextPage(): void;
  prevPage(): void;
  setLocation(href: string | number): void;
}

interface LocStart {
  cfi: string;
  href: string;
}

interface TocMark {
  page: number;
  title: string;
  /** 0..1 across the slider's thumb travel. */
  frac: number;
}

const PAGE_STYLE_ID = "reader-page-style";
/** Chars per generated location (~one page). */
const LOC_CHARS = 1000;
/** Wheel ticks (notches) at a chapter edge to change chapter. */
const OVER_TICKS = 9;
/** …plus at least this much overscroll px (keeps dense low-delta streams honest). */
const OVER_PX = 120;
/** Min ms between edge chapter advances (no chain-skipping). */
const OVER_COOL = 800;

const PALETTES: Record<ThemeName, { bg: string; fg: string }> = {
  light: { bg: "#ffffff", fg: "#212529" },
  sepia: { bg: "#f6f0e4", fg: "#433422" },
  dark: { bg: "#1b1b1b", fg: "#e8e8e8" },
  monokai: { bg: "#272822", fg: "#f8f8f2" },
};

/** Docs already given our key handler (one WeakSet for the book). */
const keyedDocs = new WeakSet<Document>();

const props = defineProps<{ id: string }>();
const reader = useReader();
const player = usePlayer();
const car = useSidecar();
const view = ref<unknown>(null);
const frameEl = ref<HTMLDivElement | null>(null);
let frameRO: ResizeObserver | null = null;

/** Book-wide page progress (from generated locations). */
const totalPages = ref(0);
const curPage = ref(0);
/** Current spine index (from relocated events); -1 while unknown. */
const curSpine = ref(-1);
const locating = ref(false);
const scrubbing = ref(false);
const scrubPage = ref(1);
/** Drops stale location runs (book switches) and old listeners. */
let progressRun = 0;
let subRendition: BookRendition | null = null;
let subHandler: ((loc: RelocatedLocation) => void) | null = null;

/** The book always renders as one continuous scroll. */
const epubOptions = { flow: "scrolled-doc" };

const sliderMax = computed(() => Math.max(1, totalPages.value));
const sliderValue = computed(() => (scrubbing.value ? scrubPage.value : curPage.value || 1));
const sentTotal = computed(() => reader.sentences.length);
const canPlay = computed(() => !!reader.current && !!reader.rendition && sentTotal.value > 0);
/** Persistent bars always show the count; live preview while scrubbing. */
const pageLabel = computed(() => {
  if (!totalPages.value) return locating.value ? "…" : "–";
  return scrubbing.value ? `${scrubPage.value} / ${totalPages.value}` : `${curPage.value || "–"} / ${totalPages.value}`;
});
const sliderEl = ref<HTMLInputElement | null>(null);
const popEl = ref<HTMLDivElement | null>(null);
let stopPopTrack: (() => void) | null = null;
const markTip = ref<{ page: number; title: string } | null>(null);
const markTipEl = ref<HTMLDivElement | null>(null);

/** Edge overscroll: 0 hidden, 1 next chapter, -1 previous. */
const overSide = ref<0 | 1 | -1>(0);
const overMag = ref(0);
const overTicks = ref(0);
/** Opposite-direction px before the count drops (wheel jitter tolerance). */
const overNeg = ref(0);
const OVER_UNDO_NEED = 40;
let lastAdvance = 0;
const overPct = computed(
  () => Math.min(overTicks.value / OVER_TICKS, overMag.value / OVER_PX) * 100,
);
const overDone = computed(() => Math.min(OVER_TICKS, overTicks.value));
const overLabel = computed(() => (overSide.value < 0 ? "Previous chapter" : "Next chapter"));
/** Physical push direction: inverted swaps which way is "forward". */
const overArrow = computed(() => {
  const downIsFwd = reader.wheel !== "inverted";
  const toNext = overSide.value > 0;
  return toNext === downIsFwd ? "↓" : "↑";
});

function resetOver(): void {
  overSide.value = 0;
  overMag.value = 0;
  overTicks.value = 0;
  overNeg.value = 0;
}

/**
 * True chapter edges. Rather than inferring the position
 * from scroll offsets (fragile: body margins, rounding, wrapper quirks),
 * measure visibility directly: the chapter's end is reached when the
 * iframe's bottom edge is visible inside epubjs's `.epub-container` —
 * the same geometry `scrolledLocation()` itself uses. A chapter that fits
 * on screen is therefore always "at the edge", and no outer wrapper can
 * veto it. Falls back to inner-document offsets if the container is gone
 * (or the iframe is cross-origin and unreadable).
 */
function chapterEdge(doc: Document): { atEnd: boolean; atStart: boolean } {
  try {
    const frame = doc.defaultView?.frameElement as HTMLElement | null;
    let el = frame?.parentElement ?? null;
    let guard = 0;
    while (el && guard++ < 20) {
      if (el.classList.contains("epub-container")) {
        const f = frame?.getBoundingClientRect();
        const c = el.getBoundingClientRect();
        if (!f) break;
        if (el.scrollHeight - el.clientHeight > 2) {
          return { atEnd: f.bottom <= c.bottom + 2, atStart: f.top >= c.top - 2 };
        }
        if (el.scrollWidth - el.clientWidth > 2) {
          return { atEnd: f.right <= c.right + 2, atStart: f.left >= c.left - 2 };
        }
        return { atEnd: true, atStart: true };
      }
      el = el.parentElement;
    }
  } catch {
    // Cross-origin iframe: fall back to the inner document below.
  }
  const inner = doc.scrollingElement ?? doc.documentElement;
  const scrollable = inner.scrollHeight - inner.clientHeight > 2;
  return {
    atEnd: !scrollable || inner.scrollHeight - inner.scrollTop - inner.clientHeight <= 2,
    atStart: !scrollable || inner.scrollTop <= 2,
  };
}

/** Is there a linear chapter beyond the current spine position? */
function canAdvance(side: 1 | -1): boolean {
  try {
    const spine = reader.rendition?.book?.spine;
    const cur = curSpine.value;
    if (!spine || cur < 0) return true; // unknown: stay permissive
    if (side > 0) {
      for (let i = cur + 1; i < spine.length; i++) {
        if (spine.get(i)?.linear) return true;
      }
      return false;
    }
    for (let i = cur - 1; i >= 0; i--) {
      if (spine.get(i)?.linear) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function bumpOver(side: 1 | -1, amt: number, book: BookRendition): void {
  if (overSide.value !== 0 && overSide.value !== side) {
    // Pushed back the other way: only drop the count after a real
    // reversal, so wheel jitter doesn't wipe a nearly-full count.
    overNeg.value += amt;
    if (overNeg.value >= OVER_UNDO_NEED) resetOver();
    return;
  }
  overSide.value = side;
  overNeg.value = 0;
  overTicks.value += 1;
  overMag.value += amt;
  const now = Date.now();
  if (
    overTicks.value >= OVER_TICKS &&
    overMag.value >= OVER_PX &&
    now - lastAdvance > OVER_COOL
  ) {
    lastAdvance = now;
    resetOver();
    void (side > 0 ? book.next() : book.prev());
  }
}

/**
 * TOC markers on the scrub track. Each TOC href resolves to a spine
 * section (same lookup as rendition.display); the section's first
 * generated location is the marker's page. One marker per page —
 * depth-first order lets a parent title win a shared page.
 */
const tocMarks = computed<TocMark[]>(() => {
  const book = reader.rendition?.book;
  const n = totalPages.value;
  if (!book || n < 2 || !reader.toc.length) return [];
  const firstLoc = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const cfi = book.locations.cfiFromLocation(i);
    if (typeof cfi !== "string") continue;
    const si = spinePosOf(cfi);
    if (si >= 0 && !firstLoc.has(si)) firstLoc.set(si, i);
  }
  const seen = new Set<number>();
  const marks: TocMark[] = [];
  for (const item of flattenToc(reader.toc)) {
    let sec: { index: number } | null = null;
    try {
      sec = book.spine.get(item.href);
    } catch {
      continue;
    }
    if (!sec) continue;
    const loc = firstLoc.get(sec.index);
    if (loc === undefined || seen.has(loc)) continue;
    seen.add(loc);
    marks.push({ page: loc + 1, title: item.label, frac: loc / (n - 1) });
  }
  return marks.sort((a, b) => a.page - b.page);
});

/** Spine index from a location CFI (`epubcfi(/6/<(index+1)*2>...)`). */
function spinePosOf(cfi: string): number {
  const m = /^epubcfi\(\/6\/(\d+)/.exec(cfi);
  if (!m) return -1;
  const num = parseInt(m[1], 10);
  if (!Number.isFinite(num) || num % 2 !== 0) return -1;
  return num / 2 - 1;
}

function flattenToc(items: NavItem[]): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  const walk = (list: NavItem[]): void => {
    for (const it of list) {
      out.push({ href: it.href, label: (it.label || "").trim() || it.href });
      if (it.subitems?.length) walk(it.subitems);
    }
  };
  walk(items);
  return out;
}

function markHover(m: TocMark, ev: MouseEvent): void {
  markTip.value = { page: m.page, title: m.title };
  const anchor = ev.currentTarget as HTMLElement;
  void nextTick(() => {
    const tip = markTipEl.value;
    if (!tip || !markTip.value) return;
    void computePosition(anchor, tip, {
      placement: "top",
      middleware: [offset(8), shift({ padding: 6 })],
    }).then(({ x, y }) => {
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    });
  });
}

function markLeave(): void {
  markTip.value = null;
}

/** Virtual anchor on the slider thumb: the popup tracks the drag point. */
const thumbAnchor: VirtualElement = {
  getBoundingClientRect: () => {
    const el = sliderEl.value;
    if (!el) return new DOMRect();
    const r = el.getBoundingClientRect();
    const n = Math.max(1, totalPages.value);
    const f = n < 2 ? 0.5 : (scrubPage.value - 1) / (n - 1);
    const thumb = 16;
    return new DOMRect(r.left + thumb / 2 + f * Math.max(0, r.width - thumb), r.top, 0, 0);
  },
};

function updatePop(): void {
  const pop = popEl.value;
  if (!pop || !scrubbing.value) return;
  void computePosition(thumbAnchor, pop, {
    placement: "top",
    middleware: [offset(10), shift({ padding: 6 })],
  }).then(({ x, y }) => {
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
  });
}

function trackPop(): void {
  stopPopTrack?.();
  stopPopTrack = null;
  void nextTick(() => {
    if (!popEl.value || !scrubbing.value) return;
    updatePop();
    stopPopTrack = autoUpdate(thumbAnchor, popEl.value, updatePop);
  });
}

function api(): EpubViewApi | null {
  return view.value as EpubViewApi | null;
}

function prev(): void {
  api()?.prevPage();
}

function next(): void {
  api()?.nextPage();
}

function play(): void {
  void player.start(firstAudible());
}

/** Sentence indices of the current chapter (empty when unknown). */
function chapterIndices(): number[] {
  const total = reader.sentences.length;
  const href = (reader.chapterHref || "").split("#")[0];
  if (!total || !href) return [];
  const out: number[] = [];
  reader.sentences.forEach((s, i) => {
    const h = s.href.split("#")[0];
    if (!h) return;
    if (href.endsWith(h) || h.endsWith(href) || baseName(h) === baseName(href)) out.push(i);
  });
  return out;
}

/** Last path segment, decoded: manifest and viewer hrefs often differ above it. */
function baseName(h: string): string {
  const last = h.split("/").pop() || "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/** First sentence of the current chapter. */
function firstAudible(): number {
  const inChapter = chapterIndices();
  return inChapter.length ? inChapter[0] : 0;
}

/** Selection popup anchor (parent-viewport coords) + resolved sentence. */
const selPop = ref<{ x: number; y: number; width: number; height: number; text: string; idx: number } | null>(null);
const selPopEl = ref<HTMLDivElement | null>(null);

function hideSel(): void {
  selPop.value = null;
}

/**
 * Sentence index under the selection's start. Resolved by DOM position, so
 * a repeated phrase maps to the occurrence actually selected instead of the
 * first match above it. Falls back to text search when the DOM is unusable.
 */
function sentenceAtSelection(doc: Document, text: string): number {
  const pool = chapterIndices();
  if (pool.length) {
    const sel = doc.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      const at = sentenceIndexAtSelection(
        doc,
        pool.map((i) => reader.sentences[i].text),
        r.startContainer,
        r.startOffset,
      );
      if (at >= 0) return pool[at];
    }
  }
  return fuzzySentenceAtSelection(text);
}

/** Text-match fallback for when the selection's DOM position is unavailable. */
function fuzzySentenceAtSelection(text: string): number {
  const want = text.replace(/\s+/g, " ").trim();
  if (!want) return firstAudible();
  const pool = chapterIndices();
  const all = pool.length ? pool : reader.sentences.map((_, i) => i);
  for (const i of all) {
    const flat = reader.sentences[i].text.replace(/\s+/g, " ").trim();
    if (!flat) continue;
    if (flat.includes(want.slice(0, 80)) || want.includes(flat.slice(0, 40))) return i;
  }
  return firstAudible();
}

function onBookMouseUp(doc: Document): void {
  const sel = doc.getSelection();
  const text = (sel?.toString() || "").replace(/\s+/g, " ").trim();
  if (!sel || sel.isCollapsed || text.length < 2) {
    selPop.value = null;
    return;
  }
  let r: DOMRect;
  try {
    r = sel.getRangeAt(0).getBoundingClientRect();
  } catch {
    selPop.value = null;
    return;
  }
  const f = (doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect();
  if (!f || (!r.width && !r.height)) {
    selPop.value = null;
    return;
  }
  selPop.value = {
    x: r.left + f.left,
    y: r.top + f.top,
    width: r.width || 2,
    height: r.height || 2,
    text,
    idx: sentenceAtSelection(doc, text),
  };
  void nextTick(placeSelPop);
}

function placeSelPop(): void {
  const pop = selPopEl.value;
  const s = selPop.value;
  if (!pop || !s) return;
  const anchor: VirtualElement = {
    getBoundingClientRect: () => new DOMRect(s.x, s.y, s.width, s.height),
  };
  void computePosition(anchor, pop, {
    placement: "top",
    middleware: [offset(8), shift({ padding: 6 }), flip()],
  }).then(({ x, y }) => {
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
  });
}

async function copySel(): Promise<void> {
  const s = selPop.value;
  selPop.value = null;
  if (!s) return;
  try {
    await navigator.clipboard.writeText(s.text);
  } catch {
    // Clipboard unavailable (permissions); selection stays for manual copy.
  }
}

function readFromHere(): void {
  const s = selPop.value;
  selPop.value = null;
  if (!s) return;
  void player.start(s.idx);
}

async function markSel(): Promise<void> {
  const s = selPop.value;
  const bookId = reader.current?.id;
  selPop.value = null;
  if (!s || !bookId) return;
  const sent = reader.sentences[s.idx];
  await putMark({
    id: newId(),
    bookId,
    key: sent?.key ?? "",
    text: s.text.slice(0, 140),
    created: Date.now(),
  }).catch(() => undefined);
}

function resume(): void {
  void player.resume();
}

function onLocation(loc: LocStart): void {
  reader.setLocation(loc.cfi, loc.href);
  hideSel();
}

function onToc(toc: NavItem[]): void {
  reader.setToc(toc);
}

function detachProgress(): void {
  progressRun++;
  if (subRendition && subHandler) {
    try {
      subRendition.off("relocated", subHandler);
    } catch {
      // Already torn down.
    }
  }
  subRendition = null;
  subHandler = null;
}

/** Track current/total pages via generated locations + relocated events. */
function trackProgress(rendition: BookRendition): void {
  detachProgress();
  const run = progressRun;
  totalPages.value = 0;
  curPage.value = 0;
  curSpine.value = -1;
  scrubbing.value = false;
  locating.value = true;
  const book = rendition.book;
  if (!book) {
    locating.value = false;
    return;
  }
  const onRelocated = (loc: RelocatedLocation): void => {
    if (run !== progressRun) return;
    curSpine.value = loc.start.index;
    // vue-reader's update:location only carries the CFI string; the full
    // relocated payload is what actually has cfi + href + spine index.
    reader.setLocation(loc.start.cfi, loc.start.href);
    if (typeof loc.start.location === "number" && book.locations.length() > 0) {
      totalPages.value = book.locations.length();
      curPage.value = loc.start.location + 1;
    }
  };
  subRendition = rendition;
  subHandler = onRelocated;
  rendition.on("relocated", onRelocated);
  void book.locations
    .generate(LOC_CHARS)
    .then(() => {
      if (run !== progressRun) return;
      locating.value = false;
      totalPages.value = book.locations.length();
      const cfi = reader.location;
      if (cfi) {
        const idx = book.locations.locationFromCfi(cfi);
        if (idx >= 0) curPage.value = idx + 1;
      }
    })
    .catch(() => {
      if (run === progressRun) locating.value = false;
    });
}

/** Jump to a 1-based page. */
function goPage(p: number): void {
  const rendition = reader.rendition;
  const book = rendition?.book;
  const n = totalPages.value;
  if (!rendition || !book || !n) return;
  const clamped = Math.min(n, Math.max(1, Math.round(p)));
  const cfi = book.locations.cfiFromLocation(clamped - 1);
  if (typeof cfi !== "string" || !cfi) return;
  void rendition.display(cfi).catch(() => undefined);
}

function scrubStart(): void {
  if (!totalPages.value) return;
  scrubbing.value = true;
  scrubPage.value = curPage.value || 1;
  trackPop();
}

function scrubInput(ev: Event): void {
  const v = Number((ev.target as HTMLInputElement).value);
  if (scrubbing.value) {
    scrubPage.value = v;
    updatePop();
  } else {
    // Keyboard nudge: commit each step, the count follows live.
    goPage(v);
  }
}

function scrubEnd(): void {
  if (!scrubbing.value) return;
  scrubbing.value = false;
  stopPopTrack?.();
  stopPopTrack = null;
  goPage(scrubPage.value);
}

function scrubCancel(): void {
  scrubbing.value = false;
  stopPopTrack?.();
  stopPopTrack = null;
}

/** Paint one chapter page: theme + font size + highlight rules. */
function applyPage(doc: Document): void {
  const pal = PALETTES[reader.theme];
  doc.documentElement.style.background = pal.bg;
  if (doc.body) {
    doc.body.style.background = pal.bg;
    doc.body.style.color = pal.fg;
  }
  doc.documentElement.style.fontSize = `${reader.fontScale}%`;
  let style = doc.getElementById(PAGE_STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = PAGE_STYLE_ID;
    doc.head.appendChild(style);
  }
  style.textContent = HIGHLIGHT_CSS[reader.theme];
}

/** Re-paint every loaded page (theme / font change). */
function repaintAll(): void {
  const rendition = reader.rendition;
  if (!rendition) return;
  const contents = rendition.getContents() as unknown as Contents[];
  for (const c of contents) {
    if (c.document) applyPage(c.document);
  }
}

function onRendition(rendition: unknown): void {
  if (!rendition || typeof rendition !== "object") return;
  const book = rendition as BookRendition;
  reader.setRendition(book);
  contentHook(book).register((contents) => {
    if (!contents.document) return;
    applyPage(contents.document);
    watchKeys(book, contents.document);
  });
  trackProgress(book);
}

/**
 * Keys + wheel inside the book. The top-window listener cannot hear them:
 * events in the chapter iframe never reach the parent document, and the
 * library's own keyup/wheel listeners are disabled — so we own this.
 */
function watchKeys(book: BookRendition, doc: Document): void {
  if (keyedDocs.has(doc)) return;
  keyedDocs.add(doc);
  doc.addEventListener("keydown", (ev: KeyboardEvent) => onPageKey(book, ev));
  doc.addEventListener("mousedown", () => hideSel());
  doc.addEventListener("mouseup", () => onBookMouseUp(doc));
  doc.addEventListener(
    "wheel",
    (ev: WheelEvent) => {
      if (ev.ctrlKey || ev.metaKey) return; // pinch-zoom stays native
      let dy = ev.deltaY;
      if (ev.deltaMode === 1) dy *= 16;
      else if (ev.deltaMode === 2) dy *= 400;
      if (!dy || !Number.isFinite(dy)) return;
      const d = reader.wheel === "inverted" ? -1 : 1;
      const { atEnd, atStart } = chapterEdge(doc);
      const fwd = dy * d;
      if ((fwd > 0 && atEnd) || (fwd < 0 && atStart)) {
        const side = fwd > 0 ? 1 : -1;
        if (!canAdvance(side)) {
          // First chapter pushing back, or last chapter pushing forward:
          // nowhere to go, so no pill and no accumulation.
          resetOver();
          return;
        }
        // Pushing past a chapter edge: fill the indicator, then advance.
        ev.preventDefault();
        bumpOver(side, Math.abs(fwd), book);
      } else {
        resetOver();
      }
    },
    { passive: false },
  );
}

function onPageKey(book: BookRendition, ev: KeyboardEvent): void {
  const t = ev.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
    return;
  }
  if (ev.key === "ArrowLeft") {
    ev.preventDefault();
    void book.prev();
  } else if (ev.key === "ArrowRight") {
    ev.preventDefault();
    void book.next();
  }
  // Up/Down are left alone to scroll natively.
}

function onKeys(ev: KeyboardEvent): void {
  if (ev.key === "Escape") hideSel();
  else if (ev.key === "ArrowLeft") prev();
  else if (ev.key === "ArrowRight") next();
}

function load(): void {
  player.stop();
  detachProgress();
  resetOver();
  totalPages.value = 0;
  curPage.value = 0;
  curSpine.value = -1;
  locating.value = false;
  scrubbing.value = false;
  void reader.open(props.id);
}

onMounted(() => {
  load();
  window.addEventListener("keydown", onKeys);
  // Static in-flow bars: re-measure the rendition whenever the frame's
  // size settles (error banner, window resize) — no timers involved.
  if (frameEl.value) {
    frameRO = new ResizeObserver(() => {
      try {
        reader.rendition?.resize();
      } catch {
        // Tearing down; nothing to resize.
      }
    });
    frameRO.observe(frameEl.value);
  }
});

watch(
  () => props.id,
  () => load(),
);

// Font size / theme live in Settings now; re-paint loaded pages on change.
watch(
  () => reader.fontScale,
  () => repaintAll(),
);

watch(
  () => reader.theme,
  () => repaintAll(),
);

onUnmounted(() => {
  window.removeEventListener("keydown", onKeys);
  frameRO?.disconnect();
  frameRO = null;
  stopPopTrack?.();
  stopPopTrack = null;
  detachProgress();
  player.stop();
  reader.close();
});
</script>
