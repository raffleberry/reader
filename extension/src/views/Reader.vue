<template>
  <div class="reader-root" @mousedown="hideSel">
    <div class="edge edge-top">
      <ReaderBar
        :title="reader.title"
        :chapter="reader.chapterLabel"
        :page="pageLabel"
        @open="closeBook"
        @toc="car.show('toc')"
        @settings="car.show('settings')"
      />
    </div>

    <div ref="frameEl" class="reader-frame">
      <div v-if="banner" class="alert m-3 mb-0" :class="prefs.server === 'down' ? 'alert-warning' : 'alert-info'">
        {{ banner }}
        <a :href="RELEASE_URL" target="_blank" rel="noopener">Download the helper</a>
        (<a :href="INSTALL_URL" target="_blank" rel="noopener">setup guide</a>)
        <button class="btn btn-sm btn-link p-0 ms-1" @click="retry">Retry</button>
        <button class="btn btn-sm btn-link p-0" title="Dismiss" @click="bannerGone = true">✕</button>
      </div>
      <div v-if="reader.loading" class="alert alert-info m-3">Opening book…</div>
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
      <div v-if="note" class="book-note">
        {{ note }}
      </div>
    </div>

    <div class="edge edge-bottom">
      <div v-if="player.phase === 'error'" class="player-error" role="alert">
        {{ player.error }}
        <a v-if="prefs.server === 'down'" :href="RELEASE_URL" target="_blank" rel="noopener">Download it</a>
        <button v-if="prefs.server === 'down'" class="btn btn-link btn-sm p-0" @click="retry">Retry</button>
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
              @mouseenter="tocTipShow(m, $event)"
              @mouseleave="tocTipHide"
              @click="goPage(m.page)"
            ></button>
          </div>
          <div v-if="tocTip" ref="tocTipEl" class="toc-tip">{{ tocTip.page }} | {{ tocTip.title }}</div>
        </div>
        <div class="play-group">
          <button
            v-if="!player.busy"
            class="btn btn-success btn-sm"
            :title="playTitle"
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
            :disabled="serverDown"
            :title="serverDown ? playTitle : 'Resume'"
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
      <button
        class="btn btn-sm btn-outline-secondary"
        title="Bookmark this passage"
        :disabled="!reader.book"
        @click="markSel"
      >
        🔖
      </button>
      <button class="btn btn-sm btn-success" title="Read aloud from here" @click="readFromHere">
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
import { usePrefs } from "../store/prefs";
import type { ThemeName } from "../types";
import { rerender, usePlayer } from "../store/player";
import { addMark, newId, TEXT_MAX } from "../ext/marks";
import { sentenceIndexAtSelection } from "../tts/locate";
import { spinePosOf } from "../tts/cfi";
import { HIGHLIGHT_CSS, LINK_CSS } from "../theme";
import { contentHook } from "../types";
import type { BookRendition, RelocatedLocation } from "../types";
import ReaderBar from "../components/ReaderBar.vue";
import { useSidecar } from "../store/sidecar";
import { INSTALL_URL, RELEASE_URL, downMessage } from "../ext/serve";

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

const PALETTES: Record<ThemeName, { bg: string; fg: string }> = {
  light: { bg: "#ffffff", fg: "#212529" },
  sepia: { bg: "#f6f0e4", fg: "#433422" },
  dark: { bg: "#1b1b1b", fg: "#e8e8e8" },
  monokai: { bg: "#272822", fg: "#f8f8f2" },
};

/** Docs already given our key handler (one WeakSet for the book). */
const keyedDocs = new WeakSet<Document>();

const reader = useReader();
const player = usePlayer();
const prefs = usePrefs();
const car = useSidecar();
const view = ref<unknown>(null);
const frameEl = ref<HTMLDivElement | null>(null);
let frameRO: ResizeObserver | null = null;

/** Book-wide page progress (from generated locations). */
const totalPages = ref(0);
const curPage = ref(0);
const locating = ref(false);
const scrubbing = ref(false);
const scrubPage = ref(1);
/** Dismissed the "no server" banner for this book. */
const bannerGone = ref(false);
/** Drops stale location runs (book switches) and old listeners. */
let progressRun = 0;
let subRendition: BookRendition | null = null;
let subHandler: ((loc: RelocatedLocation) => void) | null = null;

/**
 * The whole book, as one scroll.
 *
 * `scrolled-doc` renders a whole chapter without a scrollbar of its own;
 * epub.js's `continuous` manager then stacks those sections in a single
 * scrollable container and appends the next (or the previous) as you reach
 * one, so scrolling never stops at a chapter edge. The wheel is left to the
 * browser and the page buttons scroll a screenful at a time.
 */
const epubOptions = { flow: "scrolled-doc", manager: "continuous" };

const sliderMax = computed(() => Math.max(1, totalPages.value));
const sliderValue = computed(() => (scrubbing.value ? scrubPage.value : curPage.value || 1));
const sentTotal = computed(() => reader.sentences.length);
/** No server, no speech: the buttons say so instead of failing on a press. */
const serverDown = computed(() => prefs.server === "down");
const canPlay = computed(
  () => !!reader.book && !!reader.rendition && sentTotal.value > 0 && !serverDown.value,
);
const playTitle = computed(() =>
  serverDown.value
    ? "Read-aloud needs the speech helper — run it once, then press play"
    : "Read aloud",
);
/** A one-line note over the book: what just happened, then gone again. */
const note = ref("");
let noteTimer = 0;

/** Replace whatever the pill is saying, and take it away after `ms`. */
function say(text: string, ms: number): void {
  note.value = text;
  if (noteTimer) window.clearTimeout(noteTimer);
  noteTimer = window.setTimeout(() => (note.value = ""), ms);
}

/** The one thing a reader without the server must be told, up front. */
const banner = computed(() => {
  if (bannerGone.value || prefs.server !== "down") return "";
  return downMessage();
});
/** Persistent bars always show the count; live preview while scrubbing. */
const pageLabel = computed(() => {
  if (!totalPages.value) return locating.value ? "…" : "–";
  return scrubbing.value ? `${scrubPage.value} / ${totalPages.value}` : `${curPage.value || "–"} / ${totalPages.value}`;
});
const sliderEl = ref<HTMLInputElement | null>(null);
const popEl = ref<HTMLDivElement | null>(null);
let stopPopTrack: (() => void) | null = null;
const tocTip = ref<{ page: number; title: string } | null>(null);
const tocTipEl = ref<HTMLDivElement | null>(null);

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

/** Tooltip for one chapter tick on the scrub track. */
function tocTipShow(m: TocMark, ev: MouseEvent): void {
  tocTip.value = { page: m.page, title: m.title };
  const anchor = ev.currentTarget as HTMLElement;
  void nextTick(() => {
    const tip = tocTipEl.value;
    if (!tip || !tocTip.value) return;
    void computePosition(anchor, tip, {
      placement: "top",
      middleware: [offset(8), shift({ padding: 6 })],
    }).then(({ x, y }) => {
      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
    });
  });
}

function tocTipHide(): void {
  tocTip.value = null;
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

/** Play from where the voice left off, or this chapter's first sentence. */
function play(): void {
  void player.start(reader.playFrom(reader.firstAudible()));
}

/** Stop, forget the book, and hand the tab back to the start screen. */
function closeBook(): void {
  player.stop();
  void reader.flushPlace().finally(() => reader.close());
  window.removeEventListener("keydown", onKeys);
}

async function retry(): Promise<void> {
  bannerGone.value = false;
  await prefs.checkServer();
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
  const pool = reader.chapterIndices();
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
  if (!want) return reader.firstAudible();
  const pool = reader.chapterIndices();
  const all = pool.length ? pool : reader.sentences.map((_, i) => i);
  for (const i of all) {
    const flat = reader.sentences[i].text.replace(/\s+/g, " ").trim();
    if (!flat) continue;
    if (flat.includes(want.slice(0, 80)) || want.includes(flat.slice(0, 40))) return i;
  }
  return reader.firstAudible();
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

/**
 * Keep this passage. A bookmark is a sentence index (stable for the same
 * file), a chapter label and a short excerpt of what was selected — filed
 * under the book's fingerprint, so it comes back with the same file and is
 * listed on the start screen.
 */
async function markSel(): Promise<void> {
  const s = selPop.value;
  const book = reader.book;
  selPop.value = null;
  if (!s || !book) return;
  await addMark({
    id: newId(),
    book: book.id,
    sent: s.idx,
    chapter: reader.chapterLabel,
    text: s.text.slice(0, TEXT_MAX),
    at: Date.now(),
  }).catch(() => undefined);
  // Nothing else on screen changed, so say that it worked.
  say("Bookmarked", 2200);
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

/**
 * Keep the book one continuous scroll.
 *
 * epub.js's continuous manager decides whether to stack the next chapter
 * from the container's scroll height, and re-checks only when you *scroll*.
 * That leaves two gaps we have to cover: the first section's height settles
 * after its own `fill()` ran, and a section short enough to fit the screen
 * leaves nothing to scroll, so no scroll ever comes. Asking it to fill after
 * each relocation fixes both — it appends only what is missing and stops as
 * soon as it has a screenful to spare, exactly as its own scroll handler
 * does. Each new section fires `relocated` again, so this converges.
 */
function stackAhead(book: BookRendition): void {
  void book.manager?.fill().catch(() => undefined);
}

/** Track current/total pages via generated locations + relocated events. */
function trackProgress(rendition: BookRendition): void {
  detachProgress();
  const run = progressRun;
  totalPages.value = 0;
  curPage.value = 0;
  scrubbing.value = false;
  locating.value = true;
  const book = rendition.book;
  if (!book) {
    locating.value = false;
    return;
  }
  const onRelocated = (loc: RelocatedLocation): void => {
    if (run !== progressRun) return;
    // vue-reader's update:location only carries the CFI string; the full
    // relocated payload is what actually has cfi + href + spine index.
    reader.setLocation(loc.start.cfi, loc.start.href);
    if (typeof loc.start.location === "number" && book.locations.length() > 0) {
      reader.setPages(loc.start.location + 1, book.locations.length());
      syncPages();
    }
    // Keep the continuous stack growing (see stackAhead).
    stackAhead(rendition);
    // This is the only note we keep: where the reader got to.
    reader.scheduleSave(player.pos);
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

/** Mirror the store's page numbers into the scrub row's local view. */
function syncPages(): void {
  totalPages.value = reader.totalPages;
  curPage.value = reader.curPage;
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
  const pal = PALETTES[prefs.theme];
  doc.documentElement.style.background = pal.bg;
  if (doc.body) {
    doc.body.style.background = pal.bg;
    doc.body.style.color = pal.fg;
  }
  doc.documentElement.style.fontSize = `${prefs.font}%`;
  let style = doc.getElementById(PAGE_STYLE_ID);
  if (!style) {
    style = doc.createElement("style");
    style.id = PAGE_STYLE_ID;
    doc.head.appendChild(style);
  }
  // Highlight rules *and* link colours: a book's own stylesheet usually picks
  // a link colour that disappears on our background.
  style.textContent = `${HIGHLIGHT_CSS[prefs.theme]}${LINK_CSS[prefs.theme]}`;
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
    // epub.js has just (re)written this chapter: whatever was highlighted in
    // the old document is gone, so put it back here.
    rerender(contents.document);
  });
  trackProgress(book);
}

/**
 * Keys and selection inside the book. The top-window listener cannot hear
 * them: events in a chapter iframe never reach the parent document — so we
 * own them. Scrolling is *not* ours: the book is one continuous scrollable,
 * so the wheel and the scrollbar do that, and the arrows page a screenful.
 */
function watchKeys(book: BookRendition, doc: Document): void {
  if (keyedDocs.has(doc)) return;
  keyedDocs.add(doc);
  doc.addEventListener("keydown", (ev: KeyboardEvent) => onPageKey(book, ev));
  doc.addEventListener("mousedown", () => hideSel());
  doc.addEventListener("mouseup", () => onBookMouseUp(doc));
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
  // Up/Down/PageUp/PageDown are left alone to scroll natively.
}

function onKeys(ev: KeyboardEvent): void {
  if (ev.key === "Escape") hideSel();
  else if (ev.key === "ArrowLeft") prev();
  else if (ev.key === "ArrowRight") next();
}

onMounted(() => {
  player.stop();
  bannerGone.value = false;
  // Say which note was found, then let the reader get on with the book.
  if (reader.resumed) {
    const at = reader.resumed;
    say(`Resumed at ${Math.round(at.pct * 100)}%${at.chapter ? ` · ${at.chapter}` : ""}`, 6000);
  }
  // Static in-flow bars: re-measure the rendition whenever the frame's
  // size settles (server banner, window resize) — no timers involved.
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
  window.addEventListener("keydown", onKeys);
});

// Font size / theme live in Settings now; re-paint loaded pages on change.
watch(
  () => prefs.font,
  () => repaintAll(),
);

watch(
  () => prefs.theme,
  () => repaintAll(),
);

onUnmounted(() => {
  window.removeEventListener("keydown", onKeys);
  if (noteTimer) window.clearTimeout(noteTimer);
  noteTimer = 0;
  frameRO?.disconnect();
  frameRO = null;
  stopPopTrack?.();
  stopPopTrack = null;
  detachProgress();
  player.stop();
  void reader.flushPlace();
  reader.close();
});
</script>
