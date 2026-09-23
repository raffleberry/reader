<template>
  <nav class="p-1">
    <button
      v-for="item in flat"
      :key="item.href"
      class="btn btn-sm w-100 text-start text-truncate"
      :class="item.href === current ? 'btn-primary' : 'btn-link text-body text-decoration-none'"
      :style="{ paddingLeft: `${0.75 + item.depth * 1.25}rem` }"
      @click="emit('go', item.href)"
    >
      {{ item.label }}
    </button>
    <p v-if="!flat.length" class="text-body-secondary small p-2">No table of contents.</p>
  </nav>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { NavItem } from "epubjs";

interface FlatItem {
  href: string;
  label: string;
  depth: number;
}

const props = defineProps<{ toc: NavItem[]; current: string }>();
const emit = defineEmits<{ go: [href: string] }>();

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
</script>
