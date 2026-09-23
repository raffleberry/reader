<template>
  <div class="d-flex flex-column" style="min-height: 100vh">
    <ReaderBar
      :title="reader.title"
      :chapter="reader.chapterLabel"
      :flow="reader.flow"
      :theme="reader.theme"
      @prev="prev"
      @next="next"
      @toc="tocOpen = true"
      @flow="reader.setFlow($event)"
      @font="bumpFont"
      @theme="applyTheme"
    />

    <div class="container-fluid py-2">
      <div v-if="reader.loading" class="alert alert-info">Loading book…</div>
      <div v-else-if="reader.error" class="alert alert-danger">{{ reader.error }}</div>
      <template v-else-if="reader.current">
        <PlayerBar />
        <div class="reader-frame border rounded bg-white">
          <EpubView
            :key="reader.flow"
            ref="view"
            :url="bookUrl"
            :location="reader.location || undefined"
            :epub-init-options="{ openAs: 'epub' }"
            :epub-options="epubOptions"
            :enable-key="false"
            :toc-changed="onToc"
            :get-rendition="onRendition"
            @update:location="onLocation"
          >
            <template #loadingView><p class="text-center text-muted mt-5">Opening book…</p></template>
            <template #errorView>
              <p class="text-center text-danger mt-5">This book could not be opened.</p>
            </template>
          </EpubView>
        </div>
        <p class="text-muted small mt-2 mb-0">
          Tip: ← → keys, mouse wheel, or swipe turn pages in Pages mode.
        </p>
      </template>
    </div>

    <TocDrawer :open="tocOpen" :toc="reader.toc" :current="reader.chapterHref" @close="tocOpen = false" @go="go" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { EpubView } from "vue-reader";
import "vue-reader/lib/index.css";
import type { Contents, NavItem } from "epubjs";
import { useReader } from "../store/reader";
import type { Flow, ThemeName } from "../store/reader";
import { usePlayer } from "../store/player";
import { contentHook } from "../types";
import type { BookRendition } from "../types";
import { fileUrl } from "../api/books";
import PlayerBar from "../components/PlayerBar.vue";
import ReaderBar from "../components/ReaderBar.vue";
import TocDrawer from "../components/TocDrawer.vue";

interface EpubViewApi {
  nextPage(): void;
  prevPage(): void;
  setLocation(href: string | number): void;
}

interface LocStart {
  cfi: string;
  href: string;
}

const HL_CSS = ".tts-sent{background:#fff3bf}.tts-word{background:#ffd43b}";
const PAGE_STYLE_ID = "reader-page-style";

/** Docs already given our key handler (one WeakSet for the book). */
const keyedDocs = new WeakSet<Document>();

const PALETTES: Record<ThemeName, { bg: string; fg: string }> = {
  light: { bg: "#ffffff", fg: "#212529" },
  sepia: { bg: "#f6f0e4", fg: "#433422" },
  dark: { bg: "#1b1b1b", fg: "#e8e8e8" },
};

const props = defineProps<{ id: string }>();
const reader = useReader();
const player = usePlayer();
const view = ref<unknown>(null);
const tocOpen = ref(false);

const bookUrl = computed(() => fileUrl(props.id));
const epubOptions = computed(() => ({
  // Our /file URL has no .epub extension, so epub.js is told the type above.
  flow: reader.flow === "scrolled" ? "scrolled-doc" : "paginated",
}));

function api(): EpubViewApi | null {
  return view.value as EpubViewApi | null;
}

function prev(): void {
  api()?.prevPage();
}

function next(): void {
  api()?.nextPage();
}

function go(href: string): void {
  api()?.setLocation(href);
}

function onLocation(loc: LocStart): void {
  reader.setLocation(loc.cfi, loc.href);
}

function onToc(toc: NavItem[]): void {
  reader.setToc(toc);
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
  style.textContent = HL_CSS;
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
}

/**
 * Arrow keys inside the book. The top-window listener cannot hear them:
 * events in the chapter iframe never reach the parent document, and the
 * library's own keyup listener proved unreliable — so we own this.
 */
function watchKeys(book: BookRendition, doc: Document): void {
  if (keyedDocs.has(doc)) return;
  keyedDocs.add(doc);
  doc.addEventListener("keydown", (ev: KeyboardEvent) => onPageKey(book, ev));
}

function onPageKey(book: BookRendition, ev: KeyboardEvent): void {
  const t = ev.target as HTMLElement | null;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
    return;
  }
  const scrolled = useReader().flow === "scrolled";
  if (ev.key === "ArrowLeft") {
    ev.preventDefault();
    void book.prev();
  } else if (ev.key === "ArrowRight") {
    ev.preventDefault();
    void book.next();
  } else if (!scrolled && ev.key === "ArrowUp") {
    ev.preventDefault();
    void book.prev();
  } else if (!scrolled && ev.key === "ArrowDown") {
    ev.preventDefault();
    void book.next();
  }
  // Up/Down in Scroll mode are left alone to scroll natively.
}

function bumpFont(delta: number): void {
  reader.setFont(reader.fontScale + delta);
  repaintAll();
}

function applyTheme(theme: ThemeName): void {
  reader.setTheme(theme);
  repaintAll();
}

function onKeys(ev: KeyboardEvent): void {
  if (ev.key === "ArrowLeft") prev();
  else if (ev.key === "ArrowRight") next();
}

function load(): void {
  player.stop();
  void reader.open(props.id);
}

onMounted(() => {
  load();
  window.addEventListener("keydown", onKeys);
});

watch(
  () => props.id,
  () => load(),
);

onUnmounted(() => {
  window.removeEventListener("keydown", onKeys);
  player.stop();
  reader.close();
});
</script>
