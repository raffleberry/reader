<template>
  <nav class="navbar navbar-themed border-bottom sticky-top">
    <div class="container-fluid">
      <RouterLink to="/" class="btn btn-outline-secondary btn-sm">← Library</RouterLink>
      <div class="text-center flex-grow-1 px-2 text-truncate">
        <strong>{{ title }}</strong>
        <div v-if="sub" class="small text-body-secondary text-truncate">{{ sub }}</div>
      </div>
      <div class="d-flex align-items-center gap-2">
        <button class="btn btn-outline-secondary btn-sm" title="Table of contents" @click="emit('toc')">
          ☰
        </button>
        <button class="btn btn-outline-secondary btn-sm" title="Settings" @click="emit('settings')">⚙</button>
      </div>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ title: string; chapter: string; page: string }>();
const sub = computed(() => (props.chapter ? `${props.page} · ${props.chapter}` : props.page));
const emit = defineEmits<{
  toc: [];
  settings: [];
}>();
</script>
