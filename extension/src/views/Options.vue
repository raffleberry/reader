<template>
  <main class="container py-4" style="max-width: 40rem">
    <h1 class="h4 mb-1">EPUB Reader settings</h1>
    <p class="text-body-secondary small mb-4">
      The same settings the reader's sidebar shows. Read-aloud needs the
      speech helper installed on your computer; everything else works without it.
    </p>
    <SettingsPanel />
  </main>
</template>

<script setup lang="ts">
import { onUnmounted, watch } from "vue";
import SettingsPanel from "../components/SettingsPanel.vue";
import { usePrefs } from "../store/prefs";
import { applyAppTheme } from "../theme";

/** Follow the reader tab's changes while this page sits open. */
const prefs = usePrefs();
const stop = prefs.watchStorage();

watch(
  () => prefs.theme,
  (theme) => applyAppTheme(theme),
  { immediate: true },
);

onUnmounted(stop);
</script>
