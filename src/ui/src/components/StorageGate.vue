<template>
  <main class="container py-5" style="max-width: 560px">
    <div class="text-center mb-4">
      <h1 class="display-6">Reader</h1>
      <p class="lead text-body-secondary">Your books live on this device.</p>
    </div>
    <div class="card">
      <div class="card-body">
        <p>
          Reader keeps your EPUBs and reading progress in this browser's
          persistent storage, so the browser won't delete them to free space.
        </p>
        <p v-if="denied" class="alert alert-warning">
          Persistent storage was not granted. The app can't run without it —
          allow it in your browser's site settings, then try again.
        </p>
        <button class="btn btn-primary w-100" :disabled="busy" @click="allow">
          {{ busy ? "Checking…" : "Allow & continue" }}
        </button>
        <p class="text-body-secondary small mt-3 mb-0">
          Nothing ever leaves your device except the sentences being read
          aloud, which are sent to the speech service for audio.
        </p>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { ref } from "vue";

const emit = defineEmits<{ ready: [] }>();
const busy = ref(false);
const denied = ref(false);

async function allow(): Promise<void> {
  busy.value = true;
  try {
    if (await navigator.storage.persist()) emit("ready");
    else denied.value = true;
  } catch {
    denied.value = true;
  } finally {
    busy.value = false;
  }
}
</script>
