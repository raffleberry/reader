import { spawnSync } from "node:child_process";
import { chromium, expect, test } from "@playwright/test";
import { proseFrame, replacedFrame } from "./chapter";

/**
 * The whole point of the extension: the browser half talking to the server
 * half. Boots the real `reader.py` on a spare port, points the extension at
 * it, and checks that read-aloud works and that the settings round-trip.
 * Skipped when python/uv aren't available (the unit tests cover the rest).
 */

const PORT = 8931;
const BASE = `http://127.0.0.1:${PORT}`;
const EXT = new URL("../.output/chrome-mv3", import.meta.url).pathname;

interface Runner {
  cmd: string;
  args: string[];
}

/** Prefer uv (it has the deps); fall back to whatever python is around. */
function findPython(): Runner | null {
  for (const r of [
    { cmd: "uv", args: ["run", "reader.py"] },
    { cmd: "python3", args: ["reader.py"] },
  ] satisfies Runner[]) {
    if (!spawnSync(r.cmd, ["--version"], { stdio: "ignore" }).error) return r;
  }
  return null;
}

test.describe.configure({ mode: "serial" });

const python = findPython();
test.skip(!python, "no uv/python available to run the server");

/** The python project root, three levels up from e2e/. */
const ROOT = new URL("../../..", import.meta.url).pathname;

let server: { kill: () => void } | null = null;

test.beforeAll(async () => {
  server = await startServer();
  // Better a loud skip than a test that "passes" against nothing.
  test.skip(!server, "the Reader server did not start");
});

test.afterAll(() => {
  server?.kill();
});

async function startServer(): Promise<{ kill: () => void } | null> {
  const { spawn } = await import("node:child_process");
  const run = python as Runner;
  const proc = spawn(run.cmd, [...run.args, "--port", String(PORT)], {
    cwd: ROOT,
    stdio: "ignore",
  });
  // Wait for it to answer before handing the extension a chance to fail.
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (res.ok) return { kill: () => proc.kill() };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill();
  return null;
}

async function withReader(): Promise<{
  context: import("@playwright/test").BrowserContext;
  page: import("@playwright/test").Page;
}> {
  const context = await chromium.launchPersistentContext("", {
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 20_000 });
  const page = await context.newPage();
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/reader.html`);
  return { context, page };
}

test("the server address is checked, saved and used", async () => {
  const { context, page } = await withReader();
  try {
    // Start from the default (nothing is running there).
    await expect(page.locator(".server-badge")).toHaveClass(/down/);

    // Open settings and point the extension at the server we just booted.
    await page.getByRole("button", { name: "⚙ Settings" }).first().click();
    const field = page.locator("#set-server");
    await expect(field).toBeVisible();
    await field.fill(BASE);
    await page.getByRole("button", { name: /save & test/i }).click();

    // It checks, and says so.
    await expect(page.locator(".server-badge")).toHaveClass(/up/, { timeout: 15_000 });
    await expect(page.getByText(/Connected/)).toBeVisible();
    // And it remembered: the address is in extension storage.
    expect(
      await page.evaluate(() => browser.storage.local.get("serverUrl")),
    ).toEqual({ serverUrl: BASE });
  } finally {
    await context.close();
  }
});

test("opening a book and pressing play speaks through the server", async () => {
  const { context, page } = await withReader();
  try {
    await page.evaluate(
      (base) => browser.storage.local.set({ serverUrl: base }),
      BASE,
    );
    await page.reload();
    await expect(page.locator(".server-badge")).toHaveClass(/up/, { timeout: 15_000 });

    const fixture = new URL("../fixtures/sample.epub", import.meta.url).pathname;
    await page.setInputFiles('input[type="file"]', fixture);
    await expect(page.locator(".reader-frame iframe").first()).toBeVisible({ timeout: 30_000 });

    // With the server up, play is available again — a server that was
    // reported missing must not leave the button stuck.
    const play = page.locator(".play-group .btn-success");
    await expect(play).toBeEnabled({ timeout: 20_000 });
    await play.click();

    // Either the sentence is spoken (network + TTS service), or the server
    // reported a real failure — both prove the round trip works; what must
    // never happen is "connection refused".
    const outcome = page.locator(".player-error, .tts-pos").first();
    await expect(outcome).toBeVisible({ timeout: 30_000 });
    const text = (await outcome.textContent()) ?? "";
    expect(text).not.toMatch(/nothing answered|Failed to fetch|ERR_CONNECTION/i);
  } finally {
    await context.close();
  }
});

test("the highlight survives hiding the sidebar", async () => {
  // The reported bug: collapsing the sidebar resized the frame, epub.js
  // rebuilt the chapter document, and every highlight vanished with it.
  // Needs real speech, so it is skipped without an internet connection.
  const speech = await fetch(`${BASE}/api/tts/audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Reader." }),
  }).catch(() => null);
  test.skip(!speech || speech.status === 502, "the speech service is unreachable");

  const { context, page } = await withReader();
  try {
    await page.evaluate((base) => browser.storage.local.set({ serverUrl: base }), BASE);
    await page.reload();
    await expect(page.locator(".server-badge")).toHaveClass(/up/, { timeout: 15_000 });
    await page.setInputFiles(
      'input[type="file"]',
      new URL("../fixtures/sample.epub", import.meta.url).pathname,
    );
    await expect(page.locator(".reader-frame iframe").first()).toBeVisible({ timeout: 30_000 });

    // The book is one continuous stack, so pick the chapter with prose in it
    // (the cover is a document too) and hold on to it across the resize.
    const chapter = async (): Promise<import("@playwright/test").Frame | undefined> =>
      proseFrame(page);

    // Speak, and wait for the sentence to light up.
    await page.locator(".play-group .btn-success").click();
    await expect
      .poll(async () => (await chapter())?.locator(".tts-sent").count() ?? 0, {
        timeout: 40_000,
      })
      .toBeGreaterThan(0);

    // Freeze it: a highlight that keeps moving would make the comparison racy.
    await page.locator(".play-group .btn-warning").click();
    const lit = (await (await chapter())!.locator(".tts-sent").first().textContent())?.trim();
    expect(lit).toBeTruthy();

    // Mark the live document, so we can prove it really was replaced.
    const before = await chapter();
    await before!.evaluate(() => {
      (window as unknown as { __probe?: number }).__probe = 1;
    });

    await page.getByTitle("Hide sidebar").click();
    await expect(page.locator(".sidecar.collapsed")).toBeVisible();

    // A new document, and the same sentence highlighted inside it.
    await expect
      .poll(
        async () => {
          // The frame is a new object after the re-render, so find it again
          // by its text: the stack holds the other chapters too.
          const frame = await replacedFrame(page, before!, lit ?? "");
          if (!frame) return "no frame";
          try {
            const probe = await frame.evaluate(
              () => (window as unknown as { __probe?: number }).__probe ?? 0,
            );
            const text = (
              await frame.locator(".tts-sent").first().textContent().catch(() => null)
            )?.trim();
            return probe === 0 && text === lit ? "restored" : `probe=${probe} text=${text}`;
          } catch {
            // The old iframe is gone and the new one isn't up yet.
            return "detached";
          }
        },
        { timeout: 20_000 },
      )
      .toBe("restored");
  } finally {
    await context.close();
  }
});
