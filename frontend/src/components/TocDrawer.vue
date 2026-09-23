<template>
  <div>
    <div v-if="open" class="offcanvas-backdrop fade show" @click="emit('close')"></div>
    <aside class="toc-panel bg-white shadow" :class="{ show: open }">
      <div class="d-flex justify-content-between align-items-center p-3 border-bottom">
        <strong>Contents</strong>
        <button class="btn-close" aria-label="Close" @click="emit('close')"></button>
      </div>
      <nav class="p-2">
        <button
          v-for="item in flat"
          :key="item.href"
          class="btn btn-sm w-100 text-start text-truncate"
          :class="item.href === current ? 'btn-primary' : 'btn-link text-dark text-decoration-none'"
          :style="{ paddingLeft: `${0.75 + item.depth * 1.25}rem` }"
          @click="go(item.href)"
        >
          {{ item.label }}
        </button>
        <p v-if="!flat.length" class="text-muted small p-2">No table of contents.</p>
      </nav>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { NavItem } from "epubjs";

interface FlatItem {
  href: string;
  label: string;
  depth: number;
}

const props = defineProps<{ open: boolean; toc: NavItem[]; current: string }>();
const emit = defineEmits<{ close: []; go: [href: string] }>();

function flatten(items: NavItem[], depth: number, out: FlatItem[]): void {
  for (const item of items) {
    out.push({ href: item.href, label: item.label.trim() || item.href, depth });
    if (item.subitems?.length) flatten(item.subitems, depth + 1, out);
  }
}

const flat = computed<FlatItem[]>(() => {
  const out: FlatItem[] = [];
  flatten(props.toc, 0, out);
  return out;
});

function go(href: string): void {
  emit("go", href);
  emit("close");
}
</script>

<style scoped>
.toc-panel {
  position: fixed;
  top: 0;
  bottom: 0;
  left: 0;
  width: min(320px, 85vw);
  z-index: 1050;
  transform: translateX(-100%);
  transition: transform 0.25s ease;
  overflow-y: auto;
}
.toc-panel.show {
  transform: none;
}
</style>
