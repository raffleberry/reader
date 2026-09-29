import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { VOICES, getSettings } from "../src/api/settings";
import { HIGHLIGHT_CSS, LINK_CSS } from "../src/theme";
import { RATES, usePrefs } from "../src/store/prefs";
import { audioRate } from "../src/tts/sound";
import { closeHost } from "../src/ext/serve";

/**
 * Appearance + preference settings: the voice list, the per-theme highlight
 * CSS, and playback speed (clamped, persisted in extension storage, and
 * applied to the audio element).
 */

beforeEach(() => {
  fakeBrowser.reset();
  closeHost();
  setActivePinia(createPinia());
  vi.unstubAllGlobals();
});

describe("voices", () => {
  it("defaults to Ava and lists every English voice", () => {
    expect(VOICES[0]).toBe("en-US-AvaNeural");
    expect(VOICES).toHaveLength(47);
    expect(new Set(VOICES).size).toBe(VOICES.length);
    expect(VOICES.every((v) => v.endsWith("Neural"))).toBe(true);
    for (const keep of ["en-US-AriaNeural", "en-US-JennyNeural", "en-US-GuyNeural"]) {
      expect(VOICES).toContain(keep);
    }
  });
});

describe("highlight css", () => {
  it("covers every theme, with contrast kept on the dark ones", () => {
    expect(Object.keys(HIGHLIGHT_CSS).sort()).toEqual(["dark", "light", "monokai", "sepia"]);
    // Light keeps the classic yellow wash.
    expect(HIGHLIGHT_CSS.light).toBe(".tts-sent{background:#fff3bf}.tts-word{background:#ffd43b}");
    for (const rule of Object.values(HIGHLIGHT_CSS)) {
      expect(rule).toContain(".tts-sent{");
      expect(rule).toContain(".tts-word{");
    }
    // Dark themes pin a dark word colour so the bright pill stays readable.
    for (const theme of ["dark", "monokai"] as const) {
      expect(HIGHLIGHT_CSS[theme]).toMatch(/\.tts-word\{[^}]*color:#/);
    }
  });
});

/** Chapter page background per theme — the same values Reader.vue paints. */
const THEME_BG: Record<string, string> = {
  light: "#ffffff",
  sepia: "#f6f0e4",
  dark: "#1b1b1b",
  monokai: "#272822",
};

function linkColour(css: string): string {
  return /^a\{color:(#[0-9a-f]{6})/.exec(css)?.[1] ?? "#000000";
}

/** WCAG relative luminance, so "is this readable" is a number, not an opinion. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

describe("link css", () => {
  it("gives every theme a link colour and a visited colour, forcefully", () => {
    expect(Object.keys(LINK_CSS).sort()).toEqual(["dark", "light", "monokai", "sepia"]);
    for (const [theme, css] of Object.entries(LINK_CSS)) {
      // `!important` because a book's own stylesheet is more specific than
      // ours, and usually wins otherwise — the bug this exists to fix.
      expect(css, theme).toMatch(
        /^a\{color:#[0-9a-f]{6}!important\}a:visited\{color:#[0-9a-f]{6}!important\}$/,
      );
    }
  });

  it("keeps dark-theme links light enough to read on the chapter background", () => {
    // The bug: a book's own stylesheet picks a dark blue that vanishes.
    for (const theme of ["dark", "monokai"] as const) {
      expect(luminance(linkColour(LINK_CSS[theme]))).toBeGreaterThan(
        luminance(THEME_BG[theme]) * 3,
      );
    }
  });
});

describe("playback speed", () => {
  it("offers half speed to double", () => {
    expect(RATES).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  });

  it("defaults to 1x", async () => {
    const prefs = usePrefs();
    await prefs.hydrate();
    expect(prefs.rate).toBe(1);
    expect(audioRate()).toBe(1);
  });

  it("applies to the audio element and persists", async () => {
    const prefs = usePrefs();
    await prefs.hydrate();
    await prefs.setRate(1.5);
    expect(prefs.rate).toBe(1.5);
    expect(audioRate()).toBe(1.5);
    // Written to extension storage, not localStorage: no book, no traces.
    expect(await fakeBrowser.storage.local.get("rate")).toEqual({ rate: 1.5 });
    expect(localStorage.getItem("reader.rate")).toBeNull();
  });

  it("clamps nonsense instead of breaking the element", async () => {
    const prefs = usePrefs();
    await prefs.hydrate();
    await prefs.setRate(99);
    expect(prefs.rate).toBe(2);
    await prefs.setRate(Number.NaN);
    expect(prefs.rate).toBe(1);
    expect(audioRate()).toBe(1);
  });
});

describe("reading preferences", () => {
  it("clamps font size and read-ahead", async () => {
    const prefs = usePrefs();
    await prefs.hydrate();
    await prefs.setFont(1000);
    expect(prefs.font).toBe(200);
    await prefs.setFont(1);
    expect(prefs.font).toBe(60);
    await prefs.setReadahead(50);
    expect(prefs.readahead).toBe(10);
    await prefs.setReadahead(-1);
    expect(prefs.readahead).toBe(0);
  });

  it("remembers theme, font and auto-scroll", async () => {
    const prefs = usePrefs();
    await prefs.hydrate();
    await prefs.setTheme("monokai");
    await prefs.setFont(130);
    await prefs.setAutoScroll(true);
    // A second store, as the options page would be.
    setActivePinia(createPinia());
    const other = usePrefs();
    await other.hydrate();
    expect([other.theme, other.font, other.autoScroll]).toEqual(["monokai", 130, true]);
  });
});

describe("the speech helper's whereabouts", () => {
  /** A fake browser→host channel answering every call from `reply`. */
  function hostUp(reply: (msg: { id: number; method: string }) => unknown = () => ({})) {
    let onMsg: ((m: unknown) => void) | null = null;
    const connect = vi.fn(() => ({
      posted: [] as unknown[],
      disconnect: vi.fn(),
      onMessage: {
        addListener(cb: (m: unknown) => void): void {
          onMsg = cb;
        },
        removeListener(): void {
          onMsg = null;
        },
      },
      onDisconnect: {
        addListener(): void {},
        removeListener(): void {},
      },
      postMessage(msg: { id: number; method: string }): void {
        const result = reply(msg);
        queueMicrotask(() => onMsg?.({ id: msg.id, ok: true, result }));
      },
    }));
    vi.stubGlobal("chrome", { runtime: { connectNative: connect } });
    return connect;
  }

  /** Pretend the helper answers pings with a version. */
  function serverUp(): ReturnType<typeof vi.fn> {
    return hostUp((msg) => (msg.method === "ping" ? { version: "1.0.0" } : {}));
  }

  /** …or that it was never installed. */
  function serverGone(): void {
    closeHost();
    vi.stubGlobal("chrome", { runtime: { connectNative: vi.fn(() => undefined) } });
  }

  /** hydrate() deliberately doesn't block first paint on a probe. */
  async function settled(): Promise<ReturnType<typeof usePrefs>> {
    const prefs = usePrefs();
    await prefs.hydrate();
    await prefs.checkServer();
    return prefs;
  }

  it("is down when nothing answers", async () => {
    serverGone();
    expect((await settled()).server).toBe("down");
  });

  it("records the version when it answers", async () => {
    serverUp();
    const prefs = await settled();
    expect(prefs.server).toBe("up");
    expect(prefs.serverVersion).toBe("1.0.0");
  });

  it("goes down the moment a call finds no helper", async () => {
    serverUp();
    const prefs = await settled();
    expect(prefs.server).toBe("up");

    // The helper is uninstalled mid-session: the next call says so, and the
    // play button must not keep inviting a press that cannot work.
    serverGone();
    await expect(getSettings()).rejects.toThrow(/speech helper/i);
    expect(prefs.server).toBe("down");
    expect(prefs.serverVersion).toBe("");
  });

  it("trusts a good answer without re-probing", async () => {
    const connect = serverUp();
    const prefs = await settled();
    const calls = connect.mock.calls.length;
    expect(await prefs.ensureServer()).toBe(true);
    expect(connect.mock.calls.length).toBe(calls);
  });

  it("re-probes before speaking when it is not known to be up", async () => {
    serverGone();
    const prefs = await settled();
    expect(prefs.server).toBe("down");
    // "Down" is never final: the user may have just started the server.
    serverUp();
    expect(await prefs.ensureServer()).toBe(true);
    expect(prefs.server).toBe("up");
  });
});
