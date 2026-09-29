<template>
  <div>
    <h2 class="h6 text-uppercase text-body-secondary">Speech helper</h2>
    <p class="small text-body-secondary">
      EPUB Reader reads on its own. To hear it speak, it needs the small
      speech helper on your computer. Run the downloaded app once and it
      installs itself — the browser then starts it whenever you press play,
      and it quits on its own when you are done.
    </p>
    <div v-if="serverError" class="alert alert-danger p-2 small">
      {{ serverError }}
      <a :href="RELEASE_URL" target="_blank" rel="noopener">Download it</a>
      (<a :href="INSTALL_URL" target="_blank" rel="noopener">setup guide</a>)
    </div>
    <div v-else-if="prefs.server === 'down'" class="alert alert-warning p-2 small">
      The speech helper isn't answering.
      <a :href="RELEASE_URL" target="_blank" rel="noopener">Download it</a>,
      run it once, then try again
      (<a :href="INSTALL_URL" target="_blank" rel="noopener">setup guide</a>).
    </div>
    <div class="d-flex gap-2">
      <button class="btn btn-outline-secondary btn-sm" :disabled="busy" @click="testOnly">Test speech helper</button>
    </div>
    <div class="form-text">
      <template v-if="prefs.server === 'up'">Connected<span v-if="prefs.serverVersion"> · version {{ prefs.serverVersion }}</span>.</template>
      <template v-else-if="prefs.server === 'unknown'">Checking…</template>
      <template v-else>Not reachable.</template>
    </div>

    <hr />

    <h2 class="h6 text-uppercase text-body-secondary">Voice</h2>
    <div v-if="error" class="alert alert-danger p-2 small">{{ error }}</div>
    <div v-if="saved" class="alert alert-success p-2 small">Saved.</div>
    <div class="mb-3">
      <label class="form-label" for="set-voice">Voice</label>
      <select id="set-voice" v-model="voice" class="form-select form-select-sm">
        <option v-for="v in VOICES" :key="v" :value="v">{{ v }}</option>
      </select>
      <div class="form-text">Sent to the server when you save.</div>
    </div>
    <div class="mb-3">
      <label class="form-label" for="set-cache">Speech cache size (MB)</label>
      <input
        id="set-cache"
        v-model.number="cacheMb"
        type="number"
        min="10"
        max="2000"
        class="form-control form-control-sm"
      />
      <div class="form-text">
        Shared across books, oldest first out. Currently {{ statsText }}.
      </div>
    </div>
    <div class="d-flex gap-2">
      <button class="btn btn-primary btn-sm" :disabled="busy" @click="save">Save</button>
      <button class="btn btn-outline-danger btn-sm" :disabled="busy" @click="wipe">Clear cache</button>
    </div>

    <hr />

    <h2 class="h6 text-uppercase text-body-secondary">Playback</h2>
    <div class="mb-3">
      <label class="form-label" for="set-rate">Playback speed</label>
      <select
        id="set-rate"
        class="form-select form-select-sm"
        :value="prefs.rate"
        @change="prefs.setRate(Number(($event.target as HTMLSelectElement).value))"
      >
        <option v-for="r in RATES" :key="r" :value="r">{{ r }}×</option>
      </select>
      <div class="form-text">Client-side speed, pitch preserved. Applies immediately.</div>
    </div>
    <div class="mb-3">
      <label class="form-label" for="set-ahead">Read-ahead sentences</label>
      <input
        id="set-ahead"
        class="form-control form-control-sm"
        type="number"
        min="0"
        max="10"
        :value="prefs.readahead"
        @change="prefs.setReadahead(Number(($event.target as HTMLInputElement).value))"
      />
      <div class="form-text">How many upcoming sentences to pre-generate while you listen.</div>
    </div>
    <div class="mb-3 form-check form-switch">
      <input
        id="set-autoscroll"
        class="form-check-input"
        type="checkbox"
        :checked="prefs.autoScroll"
        @change="prefs.setAutoScroll(($event.target as HTMLInputElement).checked)"
      />
      <label class="form-check-label" for="set-autoscroll">Auto-scroll</label>
      <div class="form-text">Keep the sentence being read in view while reading aloud.</div>
    </div>

    <hr />

    <h2 class="h6 text-uppercase text-body-secondary">Reading</h2>
    <div class="mb-3">
      <label class="form-label" for="set-theme">Theme</label>
      <select
        id="set-theme"
        class="form-select form-select-sm"
        :value="prefs.theme"
        @change="onTheme(($event.target as HTMLSelectElement).value)"
      >
        <option value="light">Light</option>
        <option value="sepia">Sepia</option>
        <option value="dark">Dark</option>
        <option value="monokai">Monokai</option>
      </select>
    </div>
    <div class="mb-3">
      <span id="set-font-label" class="form-label">Font size · {{ prefs.font }}%</span>
      <div class="btn-group btn-group-sm d-flex" role="group" aria-labelledby="set-font-label">
        <button class="btn btn-outline-secondary" title="Smaller text" @click="prefs.setFont(prefs.font - 10)">A−</button>
        <button class="btn btn-outline-secondary" title="Larger text" @click="prefs.setFont(prefs.font + 10)">A+</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { VOICES, cacheStats, clearCache, getSettings, putSettings } from "../api/settings";
import { INSTALL_URL, RELEASE_URL } from "../ext/serve";
import { RATES, usePrefs } from "../store/prefs";
import type { ThemeName } from "../types";

const prefs = usePrefs();

const voice = ref(VOICES[0]);
const cacheMb = ref(100);
const statsText = ref("…");
const busy = ref(false);
const error = ref("");
const saved = ref(false);
const serverError = ref("");

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

function onTheme(value: string): void {
  if (value === "sepia" || value === "dark" || value === "monokai" || value === "light") {
    void prefs.setTheme(value as ThemeName);
  }
}

async function testOnly(): Promise<void> {
  busy.value = true;
  try {
    await prefs.checkServer();
  } finally {
    busy.value = false;
  }
  if (prefs.server === "up") await refreshStats();
}

onMounted(async () => {
  try {
    const s = await getSettings();
    voice.value = VOICES.includes(s.voice) ? s.voice : VOICES[0];
    cacheMb.value = s.cache_mb;
    await refreshStats();
  } catch (err) {
    if ((err as Error).name === "ServerDown") serverError.value = (err as Error).message;
    else error.value = (err as Error).message;
  }
});

async function save(): Promise<void> {
  busy.value = true;
  error.value = "";
  saved.value = false;
  try {
    await putSettings({ voice: voice.value, cache_mb: cacheMb.value });
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
