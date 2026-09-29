<template>
  <button
    class="server-badge"
    :class="prefs.server"
    type="button"
    :title="title"
    role="status"
    @click="emit('open')"
  >
    <span class="dot" aria-hidden="true"></span>{{ label }}
  </button>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { usePrefs } from "../store/prefs";

/** Is the speech helper there? One dot, three states, always visible. */
const emit = defineEmits<{ open: [] }>();
const prefs = usePrefs();

const label = computed(() => {
  if (prefs.server === "up") {
    return prefs.serverVersion ? `speech ${prefs.serverVersion}` : "speech ready";
  }
  if (prefs.server === "down") return "no speech helper";
  return "checking speech…";
});

const title = computed(() =>
  prefs.server === "down"
    ? `The speech helper isn't answering. Read-aloud needs it.`
    : `Speech helper${prefs.serverVersion ? ` ${prefs.serverVersion}` : ""}`,
);
</script>

<style scoped>
.server-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid var(--app-border);
  background: transparent;
  color: var(--bs-secondary-color);
  border-radius: 999px;
  padding: 0.1rem 0.6rem;
  font-size: 0.75rem;
  line-height: 1.5;
  white-space: nowrap;
}
.server-badge:hover {
  color: var(--app-fg);
  border-color: var(--bs-primary);
}
.dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--bs-secondary-color);
}
.server-badge.up .dot {
  background: var(--bs-success);
}
.server-badge.down {
  color: var(--bs-danger);
  border-color: var(--bs-danger);
}
.server-badge.down .dot {
  background: var(--bs-danger);
}
</style>
