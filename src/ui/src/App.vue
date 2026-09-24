<template>
  <StorageGate v-if="!open" @ready="onReady" />
  <div v-else-if="seeding" class="seed-note">Preparing your starter library…</div>
  <div v-else class="app-shell">
    <div v-if="IS_DEMO && offline" class="offline-pill" role="status">
      You're offline — reading still works. Read-aloud needs the downloaded app anyway.
    </div>
    <Sidecar />
    <div class="app-main">
      <RouterView />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useReader } from "./store/reader";
import { applyAppTheme } from "./theme";
import { IS_DEMO } from "./demo";
import { ensureSeedBooks } from "./library/seed";
import Sidecar from "./components/Sidecar.vue";
import StorageGate from "./components/StorageGate.vue";

const reader = useReader();
const open = ref(false);
const seeding = ref(false);
const offline = ref(typeof navigator !== "undefined" ? !navigator.onLine : false);

function markOnline(): void {
  offline.value = false;
}

function markOffline(): void {
  offline.value = true;
}

onMounted(async () => {
  applyAppTheme(reader.theme);
  window.addEventListener("online", markOnline);
  window.addEventListener("offline", markOffline);
  try {
    if (await navigator.storage.persisted()) await onReady();
  } catch {
    open.value = false;
  }
});

/** StorageGate (or the persisted fast-path) says books are safe to keep. */
async function onReady(): Promise<void> {
  if (IS_DEMO) {
    seeding.value = true;
    try {
      await ensureSeedBooks();
    } finally {
      seeding.value = false;
    }
  }
  open.value = true;
}

onUnmounted(() => {
  window.removeEventListener("online", markOnline);
  window.removeEventListener("offline", markOffline);
});

watch(
  () => reader.theme,
  (theme) => applyAppTheme(theme),
);
</script>

<style>
/* App palette. data-bs-theme (set alongside) carries Bootstrap's own
   components; these vars paint our surfaces to match each theme. */
:root,
[data-theme="light"] {
  --app-bg: #f8f9fa;
  --app-surface: #ffffff;
  --app-fg: #212529;
  --app-border: #dee2e6;
}
[data-theme="sepia"] {
  --app-bg: #efe6d0;
  --app-surface: #faf5e6;
  --app-fg: #433422;
  --app-border: #d8c9a6;
  --bs-secondary-color: #8a7a5c;
}
[data-theme="dark"] {
  --app-bg: #121212;
  --app-surface: #1e1e1e;
  --app-fg: #e8e8e8;
  --app-border: #333333;
}
[data-theme="monokai"] {
  --app-bg: #1e1f1c;
  --app-surface: #272822;
  --app-fg: #f8f8f2;
  --app-border: #49483e;
  --bs-secondary-color: #9d9d91;
  --bs-primary: #a6e22e;
  --bs-link-color: #66d9ef;
  --bs-link-hover-color: #a6e22e;
}

body {
  background: var(--app-bg);
  color: var(--app-fg);
}

.card {
  --bs-card-bg: var(--app-surface);
  --bs-card-color: var(--app-fg);
  --bs-card-border-color: var(--app-border);
}

.navbar-themed {
  background: var(--app-surface);
}

.upload-zone {
  border: 2px dashed var(--app-border);
  border-radius: 0.75rem;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
}
.upload-zone:hover {
  border-color: var(--bs-primary);
}

.book-card {
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.book-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 0.5rem 1rem rgba(0, 0, 0, 0.15);
}

.reader-root {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.reader-frame {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--app-surface);
}
/* EpubView's root (.reader) is absolutely positioned with a 50px inset
   meant for its own full-page layout. Pin it to our frame instead,
   otherwise it escapes and positions against the viewport. */
.reader-frame > div.reader {
  position: absolute;
  inset: 0;
}
/* Reader edge bars: in-flow strips so the book is never covered.
   Collapsed they keep a two-line hover target; hovering reveals both bars. */
.edge {
  flex: 0 0 auto;
}
.edge-top {
  background: var(--app-surface);
  border-bottom: 1px solid var(--app-border);
}
.edge-bottom {
  background: var(--app-bg);
  border-top: 1px solid var(--app-border);
}
.scrub-row {
  min-height: 3rem;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  padding: 0.25rem 0.75rem;
}
.page-group {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.play-group {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.35rem;
}
.tts-pos {
  font-size: 0.8rem;
  color: var(--bs-secondary-color);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.player-error {
  padding: 0.25rem 0.75rem 0;
  font-size: 0.8rem;
  color: var(--bs-danger);
}
/* Edge-overscroll chapter indicator: fills as you push past the end
   (or start); the number counts down the px needed to advance. */
.over-ind {
  position: absolute;
  left: 50%;
  bottom: 1rem;
  transform: translateX(-50%);
  z-index: 1040;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  pointer-events: none;
  background: var(--app-surface);
  color: var(--app-fg);
  border: 1px solid var(--app-border);
  border-radius: 999px;
  padding: 0.3rem 0.8rem;
  box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.25);
  animation: over-in 0.15s ease;
  white-space: nowrap;
}
.over-arrow {
  font-weight: 700;
}
.over-track {
  width: 90px;
  height: 6px;
  border-radius: 3px;
  background: var(--app-border);
  overflow: hidden;
}
.over-fill {
  height: 100%;
  background: var(--bs-primary);
  transition: width 0.08s linear;
}
.over-num {
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  color: var(--bs-secondary-color);
}
@keyframes over-in {
  from {
    opacity: 0;
    transform: translate(-50%, 8px);
  }
}
.scrub-slider {
  position: relative;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  min-width: 0;
}
.scrub-slider input[type="range"] {
  width: 100%;
  margin: 0;
}
.scrub-slider input[type="range"]:disabled {
  opacity: 0.4;
}
.scrub-pop {
  position: absolute;
  left: 0;
  top: 0;
  white-space: nowrap;
  pointer-events: none;
  z-index: 1040;
  background: #212529;
  color: #fff;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  padding: 0.15rem 0.55rem;
  border-radius: 0.5rem;
  box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.3);
}
/* TOC chapter markers pinned to the scrub track. The button is a wide
   transparent hit area; the visible tick is drawn in ::after. */
.toc-marks {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.toc-mark {
  position: absolute;
  top: 50%;
  width: 12px;
  height: 18px;
  transform: translate(-50%, -50%);
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
}
.toc-mark::after {
  content: "";
  display: block;
  width: 3px;
  height: 10px;
  margin: 4px auto;
  border-radius: 2px;
  background: var(--bs-secondary-color);
  opacity: 0.65;
}
.toc-mark:hover::after {
  opacity: 1;
  background: var(--bs-primary);
}
.mark-tip {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 1050;
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  background: #212529;
  color: #fff;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  padding: 0.15rem 0.55rem;
  border-radius: 0.5rem;
  box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.3);
}
/* Text-selection popup: bookmark / read-from-here / copy. */
.sel-pop {
  position: absolute;
  left: 0;
  top: 0;
  z-index: 1060;
  display: flex;
  gap: 0.35rem;
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  border-radius: 0.6rem;
  padding: 0.3rem;
  box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.25);
}
.page-count {
  flex: 0 0 auto;
  font-size: 0.8rem;
  color: var(--bs-secondary-color);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 7ch;
  text-align: right;
}

/* Demo first-run notice while the bundled books copy into the library. */
.seed-note {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100dvh;
  color: var(--bs-secondary-color);
}

/* App shell: sidecar + main column. */
.seed-note {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100dvh;
  color: var(--bs-secondary-color);
}
.app-shell {
  display: flex;
  height: 100dvh;
  overflow: hidden;
}
/* Demo offline notice: floats above everything, reading keeps working. */
.offline-pill {
  position: fixed;
  top: 0.5rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2000;
  background: #212529;
  color: #fff;
  font-size: 0.8rem;
  padding: 0.35rem 0.9rem;
  border-radius: 999px;
  box-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.3);
  white-space: nowrap;
  max-width: 92vw;
  overflow: hidden;
  text-overflow: ellipsis;
}
.app-main {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}

/* Sidecar: multifunctional left sidebar (TOC, settings). In-flow so the
   book is never covered; collapses to a slim rail with a show button. */
.sidecar {
  flex: 0 0 auto;
  width: 300px;
  max-width: 85vw;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--app-surface);
  border-right: 1px solid var(--app-border);
  transition: width 0.2s ease;
}
.sidecar.collapsed {
  width: 3rem;
}
.sidecar-open {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}
.sidecar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem;
  border-bottom: 1px solid var(--app-border);
}
.sidecar-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0.5rem;
}
.sidecar-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
}
</style>
