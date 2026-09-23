<template>
  <div>
    <div v-if="error" class="alert alert-danger">{{ error }}</div>
    <div v-if="saved" class="alert alert-success">Saved.</div>

    <div class="mb-3">
      <label class="form-label" for="sidecar-voice">Voice</label>
      <select id="sidecar-voice" v-model="voice" class="form-select">
        <option v-for="v in VOICES" :key="v" :value="v">{{ v }}</option>
      </select>
      <div class="form-text">Saved to the server on Save, mirrored in this browser.</div>
    </div>
    <div class="mb-3">
      <label class="form-label" for="sidecar-rate">Playback speed</label>
      <select
        id="sidecar-rate"
        class="form-select"
        :value="player.rate"
        @change="player.setRate(Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="r in RATES" :key="r" :value="r">{{ r }}×</option>
      </select>
      <div class="form-text">Client-side speed, pitch preserved. Applies immediately.</div>
    </div>
    <div class="mb-3">
      <label class="form-label" for="sidecar-theme">Theme</label>
      <select
        id="sidecar-theme"
        class="form-select"
        :value="reader.theme"
        @change="onTheme(($event.target as HTMLSelectElement).value)"
      >
        <option value="light">Light</option>
        <option value="sepia">Sepia</option>
        <option value="dark">Dark</option>
        <option value="monokai">Monokai</option>
      </select>
    </div>
    <div class="mb-3">
      <span id="sidecar-font-label" class="form-label">Font size · {{ reader.fontScale }}%</span>
      <div class="btn-group btn-group-sm d-flex" role="group" aria-labelledby="sidecar-font-label">
        <button class="btn btn-outline-secondary" title="Smaller text" @click="reader.setFont(reader.fontScale - 10)">A−</button>
        <button class="btn btn-outline-secondary" title="Larger text" @click="reader.setFont(reader.fontScale + 10)">A+</button>
      </div>
    </div>
    <div class="mb-3">
      <label class="form-label" for="sidecar-cache">Speech cache size (MB)</label>
      <input id="sidecar-cache" v-model.number="cacheMb" type="number" min="10" max="2000" class="form-control" />
      <div class="form-text">Shared across books, oldest first out. Currently {{ statsText }}.</div>
    </div>
    <div class="mb-3">
      <label class="form-label" for="sidecar-ahead">Read-ahead sentences</label>
      <input id="sidecar-ahead" v-model.number="ahead" type="number" min="0" max="10" class="form-control" />
      <div class="form-text">How many upcoming sentences to pre-generate while you listen.</div>
    </div>
    <div class="mb-3">
      <label class="form-label" for="sidecar-wheel">Scroll direction</label>
      <select
        id="sidecar-wheel"
        class="form-select"
        :value="reader.wheel"
        @change="onWheel(($event.target as HTMLSelectElement).value)"
      >
        <option value="normal">Normal — scroll down goes forward</option>
        <option value="inverted">Inverted — scroll up goes forward</option>
      </select>
      <div class="form-text">
        Pushing past the end opens the next chapter (past the start, the previous one).
      </div>
    </div>
    <div class="mb-3 form-check form-switch">
      <input
        id="sidecar-autoscroll"
        class="form-check-input"
        type="checkbox"
        :checked="player.autoScroll"
        @change="player.toggleScroll()"
      />
      <label class="form-check-label" for="sidecar-autoscroll">Auto-scroll</label>
      <div class="form-text">Keep the sentence being read in view while reading aloud.</div>
    </div>
    <div class="d-flex gap-2">
      <button class="btn btn-primary" :disabled="busy" @click="save">
        {{ busy ? "Saving…" : "Save" }}
      </button>
      <button class="btn btn-outline-danger" :disabled="busy" @click="wipe">
        Clear speech cache
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  VOICES,
  cacheStats,
  clearCache,
  getSettings,
  putSettings,
} from "../api/settings";
import { useReader } from "../store/reader";
import type { ThemeName } from "../store/reader";
import { RATES, usePlayer } from "../store/player";

const AHEAD_KEY = "reader.readahead";
const VOICE_KEY = "reader.voice";

const reader = useReader();
const player = usePlayer();

const voice = ref(VOICES[0]);
const cacheMb = ref(100);
const ahead = ref(3);
const statsText = ref("…");
const busy = ref(false);
const error = ref("");
const saved = ref(false);

function fmtBytes(n: number): string {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

async function refreshStats(): Promise<void> {
  try {
    const s = await cacheStats();
    statsText.value = `${s.entries} entries, ${fmtBytes(s.bytes)}`;
  } catch {
    statsText.value = "unavailable";
  }
}

function onWheel(value: string): void {
  reader.setWheel(value === "inverted" ? "inverted" : "normal");
}

function onTheme(value: string): void {
  if (value === "sepia" || value === "dark" || value === "monokai" || value === "light") {
    reader.setTheme(value as ThemeName);
  }
}

onMounted(async () => {
  const cached = localStorage.getItem(VOICE_KEY);
  if (cached && VOICES.includes(cached)) voice.value = cached;
  try {
    const s = await getSettings();
    voice.value = VOICES.includes(s.voice) ? s.voice : VOICES[0];
    cacheMb.value = s.cache_mb;
  } catch (err) {
    error.value = (err as Error).message;
  }
  const n = Number(localStorage.getItem(AHEAD_KEY) || 3);
  if (Number.isFinite(n)) ahead.value = n;
  await refreshStats();
});

async function save(): Promise<void> {
  busy.value = true;
  error.value = "";
  saved.value = false;
  try {
    await putSettings({ voice: voice.value, cache_mb: cacheMb.value });
    localStorage.setItem(AHEAD_KEY, String(ahead.value));
    localStorage.setItem(VOICE_KEY, voice.value);
    saved.value = true;
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}

async function wipe(): Promise<void> {
  if (!confirm("Delete all cached speech audio?")) return;
  busy.value = true;
  try {
    await clearCache();
    await refreshStats();
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>
