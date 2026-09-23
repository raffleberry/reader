<template>
  <nav class="navbar navbar-light bg-light border-bottom sticky-top">
    <div class="container-fluid">
      <RouterLink to="/" class="btn btn-outline-secondary btn-sm">← Library</RouterLink>
      <div class="text-center flex-grow-1 px-2 text-truncate">
        <strong>{{ title }}</strong>
        <div v-if="chapter" class="small text-muted text-truncate">{{ chapter }}</div>
      </div>
      <div class="d-flex align-items-center gap-2">
        <button class="btn btn-outline-secondary btn-sm" title="Table of contents" @click="emit('toc')">
          ☰
        </button>
        <button class="btn btn-outline-secondary btn-sm" title="Previous" @click="emit('prev')">‹</button>
        <button class="btn btn-outline-secondary btn-sm" title="Next" @click="emit('next')">›</button>
        <div class="btn-group btn-group-sm" role="group" aria-label="Layout">
          <button
            class="btn"
            :class="flow === 'paginated' ? 'btn-secondary' : 'btn-outline-secondary'"
            title="Turn pages"
            @click="emit('flow', 'paginated')"
          >
            Pages
          </button>
          <button
            class="btn"
            :class="flow === 'scrolled' ? 'btn-secondary' : 'btn-outline-secondary'"
            title="Scroll continuously"
            @click="emit('flow', 'scrolled')"
          >
            Scroll
          </button>
        </div>
        <div class="btn-group btn-group-sm" role="group" aria-label="Font size">
          <button class="btn btn-outline-secondary" title="Smaller text" @click="emit('font', -10)">A−</button>
          <button class="btn btn-outline-secondary" title="Larger text" @click="emit('font', 10)">A+</button>
        </div>
        <select
          class="form-select form-select-sm"
          style="width: auto"
          :value="theme"
          title="Theme"
          @change="onTheme(($event.target as HTMLSelectElement).value)"
        >
          <option value="light">Light</option>
          <option value="sepia">Sepia</option>
          <option value="dark">Dark</option>
        </select>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import type { Flow, ThemeName } from "../store/reader";

defineProps<{ title: string; chapter: string; flow: Flow; theme: ThemeName }>();
const emit = defineEmits<{
  prev: [];
  next: [];
  toc: [];
  flow: [flow: Flow];
  font: [delta: number];
  theme: [theme: ThemeName];
}>();

function onTheme(value: string): void {
  if (value === "sepia" || value === "dark" || value === "light") emit("theme", value);
}
</script>
