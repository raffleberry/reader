<template>
  <div class="one-card" :class="{ 'one-card-over': over }">
    <div class="p-4 p-lg-5 mx-auto" style="max-width: 46rem">
      <div class="d-flex align-items-center gap-2 mb-1">
        <h1 class="display-6 mb-0">Reader</h1>
        <ServerBadge @open="car.show('settings')" />
      </div>
      <p class="lead text-body-secondary">
        Open an EPUB from your computer to read it — and hear it read aloud.
      </p>
      <p class="text-body-secondary small">
        Nothing is stored. The book lives in this tab only and is gone when you
        close it; Reader keeps a note of where you stopped, and the bookmarks
        you make.
      </p>

      <label class="upload-zone d-inline-block px-4 py-3 my-3">
        <span class="fw-semibold">{{ reader.loading ? "Opening…" : "＋ Choose an EPUB" }}</span>
        <input
          type="file"
          accept=".epub,application/epub+zip"
          hidden
          :disabled="reader.loading"
          @change="pick"
        />
      </label>
      <p class="text-body-secondary small mt-0">…or drop the file anywhere on this page.</p>

      <div v-if="reader.error" class="alert alert-danger">{{ reader.error }}</div>
      <div v-if="prefs.server === 'down'" class="alert alert-warning">
        Reading works without the server, but read-aloud doesn't.
        <a :href="RELEASE_URL" target="_blank" rel="noopener">Download the Reader server</a>
        to hear your books, then press play.
      </div>

      <section v-if="recent.length" class="mt-4">
        <div class="d-flex align-items-baseline justify-content-between mb-2">
          <h2 class="h6 text-uppercase text-body-secondary mb-0">Recently read</h2>
          <button class="btn btn-link btn-sm p-0" @click="forgetAll">Forget all</button>
        </div>
        <p class="small text-body-secondary">
          Notes only. Reader keeps no copy of these books, so there is nothing
          here to open — choose the file again to pick up where you stopped.
        </p>
        <div class="row g-3">
          <div v-for="r in recent" :key="r.id" class="col-12 col-md-6">
            <RecentCard :rec="r" :marks="counts[r.id] || 0" @forget="purge" />
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import { useReader } from "../store/reader";
import { useSidecar } from "../store/sidecar";
import { usePrefs } from "../store/prefs";
import { RELEASE_URL } from "../ext/serve";
import { forget as forgetNote, forgetAll as forgetAllNotes, listRecent } from "../ext/shelf";
import { forgetAll as forgetAllMarks, forgetBook, markCounts } from "../ext/marks";
import type { Recent } from "../ext/shelf";
import RecentCard from "../components/RecentCard.vue";
import ServerBadge from "../components/ServerBadge.vue";

const reader = useReader();
const prefs = usePrefs();
const car = useSidecar();
const recent = ref<Recent[]>([]);
/** Bookmarks per book, keyed by fingerprint. */
const counts = ref<Record<string, number>>({});
const over = ref(false);

/** Read the shelf and the bookmark counts afresh — a book was just closed. */
async function reload(): Promise<void> {
  const [list, marks] = await Promise.all([listRecent(), markCounts()]);
  recent.value = list;
  counts.value = marks;
}

async function take(file: File | undefined): Promise<void> {
  if (!file) return;
  await reader.open(file);
}

function pick(ev: Event): void {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  void take(file);
}

/**
 * One click removes everything Reader knows about a book: its note and every
 * bookmark. Bookmarks are the reader's own work, so ask before taking them.
 */
async function purge(id: string, title: string): Promise<void> {
  if (!window.confirm(`Delete everything Reader knows about “${title}”?`)) return;
  await Promise.all([forgetNote(id), forgetBook(id)]);
  await reload();
}

async function forgetAll(): Promise<void> {
  if (!window.confirm("Forget every book and every bookmark?")) return;
  await Promise.all([forgetAllNotes(), forgetAllMarks()]);
  await reload();
}

/** The whole page is the drop target: a reader shouldn't have to aim. */
function onDragOver(ev: DragEvent): void {
  if (!ev.dataTransfer?.types.includes("Files")) return;
  ev.preventDefault();
  over.value = true;
}

function onDragLeave(ev: DragEvent): void {
  if (ev.relatedTarget) return;
  over.value = false;
}

function onDrop(ev: DragEvent): void {
  ev.preventDefault();
  over.value = false;
  void take(ev.dataTransfer?.files?.[0]);
}

onMounted(() => {
  void reload();
  window.addEventListener("dragover", onDragOver);
  window.addEventListener("dragleave", onDragLeave);
  window.addEventListener("drop", onDrop);
});

onUnmounted(() => {
  window.removeEventListener("dragover", onDragOver);
  window.removeEventListener("dragleave", onDragLeave);
  window.removeEventListener("drop", onDrop);
});
</script>

<style scoped>
/* Drop anywhere: the page lights up so it's obvious the file will land. */
.one-card {
  height: 100%;
  overflow-y: auto;
}
.one-card-over {
  outline: 3px dashed var(--bs-primary);
  outline-offset: -12px;
  background: var(--app-surface);
}
</style>
