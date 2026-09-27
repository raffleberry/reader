/**
 * Reading preferences and the speech server's whereabouts, hydrated once at
 * start-up from extension storage.
 *
 * Components read and write these refs; the store is the only thing that
 * touches storage, so the sidebar and the options page stay in step (and
 * neither has to know how a setting is persisted).
 */
import { ref } from "vue";
import { defineStore } from "pinia";
import { onServerDown, probe, setServerBase } from "../ext/serve";
import * as store from "../ext/settings";
import { VOICES } from "../api/settings";
import { applyRate } from "../tts/sound";
import type { ServerState, ThemeName } from "../types";

/** Offered playback speeds (client-side element rate, pitch preserved). */
export const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** How often to notice a server that stopped answering while we read. */
export const HEARTBEAT_MS = 15000;

function clampRate(n: number): number {
  return Number.isFinite(n) ? Math.min(2, Math.max(0.5, n)) : 1;
}

function clampFont(n: number): number {
  return Number.isFinite(n) ? Math.min(200, Math.max(60, Math.round(n))) : 100;
}

function clampAhead(n: number): number {
  return Number.isFinite(n) ? Math.min(10, Math.max(0, Math.floor(n))) : 3;
}

export const usePrefs = defineStore("prefs", () => {
  const theme = ref<ThemeName>("light");
  const font = ref(100);
  const rate = ref(1);
  const readahead = ref(3);
  const autoScroll = ref(false);
  const serverUrl = ref(store.serverUrl.fallback);
  const server = ref<ServerState>("unknown");
  const serverVersion = ref("");

  /** Load every setting, then let the app render. Safe to call twice. */
  async function hydrate(): Promise<void> {
    theme.value = await store.theme.getValue();
    font.value = clampFont(await store.font.getValue());
    rate.value = clampRate(await store.rate.getValue());
    readahead.value = clampAhead(await store.readahead.getValue());
    autoScroll.value = await store.autoscroll.getValue();
    const url = await store.serverUrl.getValue();
    serverUrl.value = setServerBase(url);
    applyRate(rate.value);
    // A request that never connected is proof enough; don't wait for a probe.
    onServerDown(() => markDown());
    void checkServer();
  }

  /**
   * Follow changes made in the other page (options while reading, or the
   * reader while the options tab is open). Returns a stop function.
   */
  function watchStorage(): () => void {
    const stops = [
      store.theme.watch((v) => (theme.value = v)),
      store.font.watch((v) => (font.value = clampFont(v))),
      store.rate.watch((v) => {
        rate.value = clampRate(v);
        applyRate(rate.value);
      }),
      store.readahead.watch((v) => (readahead.value = clampAhead(v))),
      store.autoscroll.watch((v) => (autoScroll.value = v)),
      store.serverUrl.watch((v) => {
        serverUrl.value = setServerBase(v);
        void checkServer();
      }),
    ];
    return () => stops.forEach((stop) => stop());
  }

  async function setTheme(v: ThemeName): Promise<void> {
    theme.value = v;
    await store.theme.setValue(theme.value);
  }

  async function setFont(n: number): Promise<void> {
    font.value = clampFont(n);
    await store.font.setValue(font.value);
  }

  async function setRate(n: number): Promise<void> {
    rate.value = clampRate(n);
    applyRate(rate.value);
    await store.rate.setValue(rate.value);
  }

  async function setReadahead(n: number): Promise<void> {
    readahead.value = clampAhead(n);
    await store.readahead.setValue(readahead.value);
  }

  async function setAutoScroll(on: boolean): Promise<void> {
    autoScroll.value = on;
    await store.autoscroll.setValue(on);
  }

  async function setVoice(v: string): Promise<void> {
    if (VOICES.includes(v)) await store.voice.setValue(v);
  }

  /** Save a new server address and see whether anything answers there. */
  async function setServerUrl(raw: string): Promise<void> {
    const next = setServerBase(raw);
    if (!next) {
      serverUrl.value = store.serverUrl.fallback;
      setServerBase(serverUrl.value);
      return;
    }
    serverUrl.value = next;
    server.value = "unknown";
    await store.serverUrl.setValue(next);
    await checkServer();
  }

  /**
   * Ask the server how it is. Anything other than a 200 from /api/health
   * means "not there" — the extension must never be vague about this.
   */
  async function checkServer(): Promise<ServerState> {
    const res = await probe();
    server.value = res.ok ? "up" : "down";
    serverVersion.value = res.ok ? (res.version ?? "") : "";
    return server.value;
  }

  /** The server stopped answering (a request failed, or a probe gave up). */
  function markDown(): void {
    server.value = "down";
    serverVersion.value = "";
  }

  /**
   * Notice a server that dies while you are reading rather than at the next
   * button press. Cheap on loopback, and it only runs while the tab is in
   * front of you. Returns a stop function.
   */
  function watchServer(intervalMs = HEARTBEAT_MS): () => void {
    const beat = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void checkServer();
    }, intervalMs);
    return () => window.clearInterval(beat);
  }

  /**
   * Cheap gate before we try to speak: an already-known-good server is
   * trusted, anything else gets one probe.
   */
  async function ensureServer(): Promise<boolean> {
    if (server.value === "up") return true;
    return (await checkServer()) === "up";
  }

  return {
    theme,
    font,
    rate,
    readahead,
    autoScroll,
    serverUrl,
    server,
    serverVersion,
    hydrate,
    watchStorage,
    setTheme,
    setFont,
    setRate,
    setReadahead,
    setAutoScroll,
    setVoice,
    setServerUrl,
    checkServer,
    markDown,
    watchServer,
    ensureServer,
  };
});

/**
 * Read every setting before the app's first render. Call once the pinia is
 * installed (both entrypoints do this before mounting).
 */
export async function hydrate(): Promise<void> {
  await usePrefs().hydrate();
}
