<template>
  <div class="app-shell">
    <Sidecar />
    <div class="app-main">
      <OpenBookView v-if="!reader.book" />
      <ReaderView v-else />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from "vue";
import { useReader } from "./store/reader";
import { usePrefs } from "./store/prefs";
import { applyAppTheme } from "./theme";
import Sidecar from "./components/Sidecar.vue";
import OpenBookView from "./views/OpenBook.vue";
import ReaderView from "./views/Reader.vue";

const reader = useReader();
const prefs = usePrefs();

/** Settings can change in the options tab while this one is open. */
let unwatch: (() => void) | null = null;
/** Keeps the server badge (and the play button) honest. */
let unbeat: (() => void) | null = null;

onMounted(() => {
  applyAppTheme(prefs.theme);
  unwatch = prefs.watchStorage();
  unbeat = prefs.watchServer();
  // The page is going away: write down where we were before it is.
  window.addEventListener("pagehide", onPageHide);
});

function onPageHide(): void {
  void reader.flushPlace();
}

onUnmounted(() => {
  window.removeEventListener("pagehide", onPageHide);
  unwatch?.();
  unwatch = null;
  unbeat?.();
  unbeat = null;
});

watch(
  () => prefs.theme,
  (theme) => applyAppTheme(theme),
);
</script>
