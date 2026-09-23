import { test, expect } from "@playwright/test";

/**
 * Appearance + playback settings: voice list default, per-theme highlight
 * CSS, and client-side playback rate (persisted, pitch preserved).
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("Ava is the default voice and all English voices are listed", async ({
  page,
}) => {
  const out = await page.evaluate(async () => {
    const mod = await import("/src/api/settings.ts");
    const voices = mod.VOICES as string[];
    return {
      first: voices[0],
      count: voices.length,
      neural: voices.every((v) => v.endsWith("Neural")),
      unique: new Set(voices).size === voices.length,
      keeps: ["en-US-AriaNeural", "en-US-JennyNeural", "en-US-GuyNeural"].every((v) =>
        voices.includes(v),
      ),
    };
  });
  expect(out).toEqual({ first: "en-US-AvaNeural", count: 47, neural: true, unique: true, keeps: true });
});

test("highlight CSS covers every theme with contrast on dark", async ({ page }) => {
  const out = await page.evaluate(async () => {
    const mod = await import("/src/theme.ts");
    const css = mod.HIGHLIGHT_CSS as Record<string, string>;
    return {
      themes: Object.keys(css).sort(),
      light: css.light,
      darkWord: css.dark,
      monokaiWord: css.monokai,
      allHaveBoth: Object.values(css).every((c) => c.includes(".tts-sent{") && c.includes(".tts-word{")),
    };
  });
  expect(out.themes).toEqual(["dark", "light", "monokai", "sepia"]);
  // Light keeps the classic yellow wash.
  expect(out.light).toBe(".tts-sent{background:#fff3bf}.tts-word{background:#ffd43b}");
  expect(out.allHaveBoth).toBe(true);
  // Dark themes pin a dark word color so the bright pill stays readable.
  for (const rule of [out.darkWord, out.monokaiWord]) {
    expect(rule).toMatch(/\.tts-word\{[^}]*color:#/);
  }
});

async function playerIn(page: import("@playwright/test").Page): Promise<{
  rate: number;
  audio: number;
  stored: string | null;
}> {
  return page.evaluate(async () => {
    const mod = await import("/src/store/player.ts");
    const player = mod.isolatedPlayer();
    return { rate: player.rate as number, audio: mod.audioRate() as number, stored: localStorage.getItem("reader.rate") };
  });
}

test("playback rate defaults to 1×", async ({ page }) => {
  expect(await playerIn(page)).toEqual({ rate: 1, audio: 1, stored: null });
});

test("playback rate applies to the element and persists", async ({ page }) => {
  const out = await page.evaluate(async () => {
    const mod = await import("/src/store/player.ts");
    const player = mod.isolatedPlayer();
    player.setRate(1.5);
    const after = { rate: player.rate as number, audio: mod.audioRate() as number, stored: localStorage.getItem("reader.rate") };
    player.setRate(99);
    const clamped = { rate: player.rate as number, audio: mod.audioRate() as number };
    player.setRate(Number.NaN);
    const nan = { rate: player.rate as number, audio: mod.audioRate() as number };
    return { after, clamped, nan };
  });
  expect(out.after).toEqual({ rate: 1.5, audio: 1.5, stored: "1.5" });
  expect(out.clamped).toEqual({ rate: 2, audio: 2 });
  expect(out.nan).toEqual({ rate: 1, audio: 1 });
});
