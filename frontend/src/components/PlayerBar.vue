<template>
  <div class="card mb-3">
    <div class="card-body d-flex flex-wrap align-items-center gap-2">
      <button v-if="!player.busy" class="btn btn-success" :disabled="!canPlay" @click="play">
        ▶ Read aloud
      </button>
      <button v-else-if="player.phase === 'playing'" class="btn btn-warning" @click="player.pause()">
        ⏸ Pause
      </button>
      <button v-else-if="player.phase === 'paused'" class="btn btn-success" @click="resume">
        ▶ Resume
      </button>
      <button v-else class="btn btn-secondary" disabled>
        <span class="spinner-border spinner-border-sm"></span> Loading…
      </button>
      <button v-if="player.busy" class="btn btn-outline-danger" @click="player.stop()">
        ⏹ Stop
      </button>

      <div class="form-check form-switch ms-2">
        <input
          id="autoscroll"
          class="form-check-input"
          type="checkbox"
          :checked="player.autoScroll"
          @change="player.toggleScroll()"
        />
        <label class="form-check-label" for="autoscroll">Auto-scroll</label>
      </div>

      <span v-if="player.busy" class="text-muted small ms-auto">
        Sentence {{ player.pos + 1 }} of {{ total }}
      </span>
    </div>
    <div v-if="player.phase === 'error'" class="card-footer text-danger small">
      {{ player.error }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { usePlayer } from "../store/player";
import { useReader } from "../store/reader";

const player = usePlayer();
const reader = useReader();

const total = computed(() => reader.sentences.length);
const canPlay = computed(
  () => !!reader.current && !!reader.rendition && total.value > 0,
);

function play(): void {
  if (reader.current) void player.start(reader.current.id);
}

function resume(): void {
  void player.resume();
}
</script>
