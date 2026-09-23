<template>
  <div class="card h-100 book-card">
    <div class="card-body d-flex flex-column">
      <h5 class="card-title text-truncate">{{ book.title }}</h5>
      <p class="card-text text-body-secondary small">EPUB · {{ kb }} KB</p>
      <div class="mt-auto d-flex gap-2">
        <RouterLink :to="`/read/${book.id}`" class="btn btn-primary btn-sm">Open</RouterLink>
        <button class="btn btn-outline-danger btn-sm" @click="emit('drop', book.id)">
          Delete
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { BookMeta } from "../db";

const props = defineProps<{ book: BookMeta }>();
const emit = defineEmits<{ drop: [id: string] }>();

const kb = computed(() => Math.max(1, Math.round((props.book.size || 0) / 1024)));
</script>
