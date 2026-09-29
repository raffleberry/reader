<template>
  <div class="card book-card h-100">
    <div class="card-body">
      <div class="d-flex align-items-start">
        <div class="flex-grow-1 min-w-0">
          <h3 class="h6 mb-1 text-truncate" :title="rec.title">{{ rec.title }}</h3>
          <div class="small text-body-secondary text-truncate">
            <template v-if="rec.place.chapter">{{ rec.place.chapter }}</template>
            <template v-else>{{ rec.name }}</template>
          </div>
        </div>
        <button
          class="btn btn-sm btn-link text-body-secondary p-0 ms-1"
          title="Delete the note and every bookmark for this book"
          @click="emit('forget', rec.id, rec.title)"
        >
          ✕
        </button>
      </div>
      <div
        class="progress my-2"
        role="progressbar"
        :aria-valuenow="Math.round(pct * 100)"
        aria-valuemin="0"
        aria-valuemax="100"
        :style="{ height: '4px' }"
      >
        <div class="progress-bar" :style="{ width: `${Math.max(2, pct * 100)}%` }"></div>
      </div>
      <div class="d-flex align-items-center justify-content-between">
        <span class="small text-body-secondary">{{ Math.round(pct * 100) }}% · {{ ago }}</span>
        <span v-if="marks" class="small text-body-secondary" :title="`${marks} bookmark${marks > 1 ? 's' : ''}`">
          🔖 {{ marks }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Recent } from "../ext/shelf";

/**
 * One remembered book: how far you got, how many bookmarks you left in it,
 * and when. There is deliberately nothing else to press — Reader holds no
 * copy of the book, so it cannot open one, and the only thing it can do is
 * forget.
 */
const props = withDefaults(defineProps<{ rec: Recent; marks?: number }>(), { marks: 0 });
const emit = defineEmits<{ forget: [id: string, title: string] }>();

const pct = computed(() => props.rec.place.pct);

const ago = computed(() => {
  const mins = Math.floor((Date.now() - props.rec.at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
});
</script>
