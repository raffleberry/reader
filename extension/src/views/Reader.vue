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

    <div class="reader-frame">
      <div v-if="banner" class="alert m-3 mb-0" :class="prefs.server === 'down' ? 'alert-warning' : 'alert-info'">
        {{ banner }}
        <a :href="RELEASE_URL" target="_blank" rel="noopener">Download the helper</a>
        (<a :href="INSTALL_URL" target="_blank" rel="noopener">setup guide</a>)
        <button class="btn btn-sm btn-link p-0 ms-1" @click="retry">Retry</button>
        <button class="btn btn-sm btn-link p-0" title="Dismiss" @click="bannerGone = true">✕</button>
      </div>
      <div v-if="reader.book" ref="viewEl" class="folio-host" :style="{ background: PALETTES[prefs.theme].bg }"></div>
      <template v-if="!reader.book">
        <div v-if="reader.loading" class="alert alert-info m-3">Opening book…</div>
        <div v-else-if="reader.error" class="alert alert-danger m-3">{{ reader.error }}</div>
        <div v-else class="alert alert-danger m-3">This book could not be opened.</div>
      </template>
      <div v-if="reader.book && opening" class="alert alert-info m-3 over-book">Opening book…</div>
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
import { autoUpdate, computePosition, flip, offset, shift } from "@floating-ui/dom";
import type { VirtualElement } from "@floating-ui/dom";
import { useReader } from "../store/reader";
import { usePrefs } from "../store/prefs";
import type { ThemeName } from "../types";
import { usePlayer } from "../store/player";
import { addMark, newId, TEXT_MAX } from "../ext/marks";
import { sentenceAtPoint } from "../text/sentences";
import { HIGHLIGHT_CSS, LINK_CSS } from "../theme";
import { mountView } from "../foliate/render";
import type { TocItem } from "../foliate/book";
import ReaderBar from "../components/ReaderBar.vue";
import { useSidecar } from "../store/sidecar";
import { INSTALL_URL, RELEASE_URL, downMessage } from "../ext/serve";

interface TocMark {
  page: number;
  title: string;
  /** 0..1 across the slider's thumb travel. */
  frac: number;
}

/** Chars per generated page (~one screenful of prose). */
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
const viewEl = ref<HTMLDivElement | null>(null);
const opening = ref(false);

/** Book-wide page progress (chars per page, sections weighted by length). */
const totalPages = ref(0);
const curPage = ref(0);
const locating = ref(false);
const scrubbing = ref(false);
const scrubPage = ref(1);
/** Dismissed the "no server" banner for this book. */
const bannerGone = ref(false);
/** Drops stale mount runs (book switches) and old listeners. */
let viewRun = 0;
let stopRelocate: (() => void) | null = null;
let stopLoad: (() => void) | null = null;

const sliderMax = computed(() => Math.max(1, totalPages.value));
const sliderValue = computed(() => (scrubbing.value ? scrubPage.value : curPage.value || 1));
const sentTotal = computed(() => reader.sentences.length);
/** No server, no speech: the buttons say so instead of failing on a press. */
const serverDown = computed(() => prefs.server === "down");
const canPlay = computed(
  () => !!reader.book && !!reader.view && sentTotal.value > 0 && !serverDown.value,
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
 * TOC markers on the scrub track. Each TOC href resolves to a section (the
 * same resolution the sidebar jump uses); the marker sits on the page where
 * that section starts. One marker per page — depth-first order lets a parent
 * title win a shared page.
 */
const tocMarks = computed<TocMark[]>(() => {
  const folio = reader.folio;
  const n = totalPages.value;
  if (!folio || n < 2 || !reader.toc.length) return [];
  const seen = new Set<number>();
  const marks: TocMark[] = [];
  for (const item of flattenToc(reader.toc)) {
    const target = folio.resolveHref(item.href);
    if (!target) continue;
    const loc = pageOf(target.index, 0);
    if (seen.has(loc)) continue;
    seen.add(loc);
    marks.push({ page: loc + 1, title: item.label, frac: loc / (n - 1) });
  }
  return marks.sort((a, b) => a.page - b.page);
});

function flattenToc(items: TocItem[]): { href: string; label: string }[] {
  const out: { href: string; label: string }[] = [];
  const walk = (list: TocItem[]): void => {
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

function prev(): void {
  void reader.view?.prevPage().catch(() => undefined);
}

function next(): void {
  void reader.view?.nextPage().catch(() => undefined);
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
 * Sentence index under the selection's start. Resolved by DOM position in
 * the live section document, so a repeated phrase maps to the occurrence
 * actually selected instead of the first match above it. Falls back to text
 * search when the DOM is unusable.
 */
function sentenceAtSelection(doc: Document, text: string): number {
  const pool = reader.chapterIndices();
  if (pool.length) {
    const live = reader.view?.contents();
    const sel = doc.getSelection();
    if (live && live.doc === doc && sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      const at = sentenceAtPoint(doc, r.startContainer, r.startOffset, pool.length);
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

function detachView(): void {
  viewRun++;
  stopRelocate?.();
  stopLoad?.();
  stopRelocate = null;
  stopLoad = null;
}

/** Chars per section, in spine order (progress weights sections by length). */
let charCache = { id: "", chars: [] as number[] };
function sectionChars(): number[] {
  const id = reader.book?.id ?? "";
  if (charCache.id === id && charCache.chars.length) return charCache.chars;
  const counts = new Map<number, number>();
  for (const s of reader.sentences) {
    counts.set(s.chapter, (counts.get(s.chapter) ?? 0) + s.text.length + 1);
  }
  const n = reader.folio?.sections.length ?? 0;
  charCache = { id, chars: Array.from({ length: n }, (_, i) => counts.get(i) ?? 0) };
  return charCache.chars;
}

function totalChars(): number {
  return sectionChars().reduce((a, b) => a + b, 0);
}

/** 0-based page for a section start + fraction through it. */
function pageOf(section: number, fraction: number): number {
  const chars = sectionChars();
  const total = chars.reduce((a, b) => a + b, 0);
  const n = Math.max(1, Math.ceil(total / LOC_CHARS));
  if (n < 2) return 0;
  let before = 0;
  for (let i = 0; i < section && i < chars.length; i++) before += chars[i];
  const at = before + Math.min(1, Math.max(0, fraction)) * (chars[section] ?? 0);
  return Math.min(n - 1, Math.floor((at / total) * n));
}

/** Theme + highlight CSS, repainted into the live section document. */
function themeCss(): string {
  const pal = PALETTES[prefs.theme];
  return (
    `html{background:${pal.bg}}` +
    `body{background:${pal.bg}!important;color:${pal.fg}!important;font-size:${prefs.font}%}` +
    `${HIGHLIGHT_CSS[prefs.theme]}${LINK_CSS[prefs.theme]}`
  );
}

function applyTheme(): void {
  reader.view?.setTheme(themeCss());
}

/**
 * Mount the viewer for the open book: create the paginator, open the book,
 * seek the resumed section, and follow relocations for progress + notes.
 * One section renders at a time; moving between them is explicit (TOC,
 * scrubber, bookmarks, narration), never an infinite stack.
 */
async function mountBook(): Promise<void> {
  detachView();
  const run = ++viewRun;
  const folio = reader.folio;
  const host = viewEl.value;
  if (!folio || !host) return;
  opening.value = true;
  locating.value = true;
  totalPages.value = 0;
  curPage.value = 0;
  scrubbing.value = false;
  try {
    const view = mountView(host);
    if (run !== viewRun) {
      view.destroy();
      return;
    }
    reader.setView(view);
    applyTheme();
    stopLoad = view.onLoad(({ doc }) => {
      if (run !== viewRun) return;
      watchKeys(doc);
    });
    stopRelocate = view.onRelocate(({ index, fraction }) => {
      if (run !== viewRun) return;
      reader.setSection(index);
      const n = Math.max(1, Math.ceil(totalChars() / LOC_CHARS));
      reader.setPages(pageOf(index, fraction) + 1, n);
      syncPages();
      // This is the only note we keep: where the reader got to.
      reader.scheduleSave(player.pos);
    });
    view.open(folio);
    await view.goTo({ index: reader.section });
    if (run !== viewRun) return;
    const n = Math.max(1, Math.ceil(totalChars() / LOC_CHARS));
    totalPages.value = n;
    curPage.value = pageOf(reader.section, 0) + 1;
    locating.value = false;
  } catch {
    if (run === viewRun) {
      locating.value = false;
      reader.error = "This book could not be opened.";
    }
  } finally {
    if (run === viewRun) opening.value = false;
  }
}

/** Mirror the store's page numbers into the scrub row's local view. */
function syncPages(): void {
  totalPages.value = reader.totalPages;
  curPage.value = reader.curPage;
}

/** Jump to a 1-based page. */
function goPage(p: number): void {
  const view = reader.view;
  const chars = sectionChars();
  const total = chars.reduce((a, b) => a + b, 0);
  const n = totalPages.value;
  if (!view || !n || !total) return;
  const clamped = Math.min(n, Math.max(1, Math.round(p)));
  const at = ((clamped - 1) / (n - 1 || 1)) * total;
  let before = 0;
  for (let i = 0; i < chars.length; i++) {
    if (at < before + chars[i] || i === chars.length - 1) {
      const frac = chars[i] > 0 ? (at - before) / chars[i] : 0;
      void view.goTo({ index: i, anchor: frac }).catch(() => undefined);
      return;
    }
    before += chars[i];
  }
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

/**
 * Keys and selection inside the book. The top-window listener cannot hear
 * them: events in a section iframe never reach the parent document — so we
 * own them. Scrolling is *not* ours: the section scrolls natively, the wheel
 * and the scrollbar do that, and the arrows page a screenful at a time.
 */
function watchKeys(doc: Document): void {
  if (keyedDocs.has(doc)) return;
  keyedDocs.add(doc);
  doc.addEventListener("keydown", (ev: KeyboardEvent) => onPageKey(ev));
  doc.addEventListener("mousedown", () => hideSel());
  doc.addEventListener("mouseup", () => onBookMouseUp(doc));
}

function onPageKey(ev: KeyboardEvent): void {
  const t = ev.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
    return;
  }
  if (ev.key === "ArrowLeft") {
    ev.preventDefault();
    prev();
  } else if (ev.key === "ArrowRight") {
    ev.preventDefault();
    next();
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
  if (reader.book) void mountBook();
  window.addEventListener("keydown", onKeys);
});

// Font size / theme live in Settings now; re-paint on change.
watch(
  () => prefs.font,
  () => applyTheme(),
);

watch(
  () => prefs.theme,
  () => applyTheme(),
);

onUnmounted(() => {
  window.removeEventListener("keydown", onKeys);
  if (noteTimer) window.clearTimeout(noteTimer);
  noteTimer = 0;
  stopPopTrack?.();
  stopPopTrack = null;
  detachView();
  player.stop();
  void reader.flushPlace();
  reader.close();
});
</script>
