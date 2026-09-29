import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";

/**
 * The whole point of the extension: the browser half talking to the helper
 * half. There is no port to probe from a browser test — the helper speaks
 * native messaging on stdin/stdout — so this suite talks the same framed
 * JSON the extension sends and checks the real Go binary answers.
 * Skipped when Go isn't available (the vitest suite covers the rest).
 */

test.describe.configure({ mode: "serial" });

/** The Go module, two levels up from extension/e2e/. */
const SERVER = new URL("../../server", import.meta.url).pathname;

function haveGo(): boolean {
  return !spawnSync("go", ["version"], { stdio: "ignore" }).error;
}

test.skip(!haveGo(), "no Go toolchain to build the speech helper");

let bin = "";
let env: NodeJS.ProcessEnv = process.env;
const scratch: string[] = [];

test.afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

test.beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "epub-reader-e2e-"));
  scratch.push(dir);
  bin = join(dir, "epub-reader");
  execFileSync("go", ["build", "-o", bin, "."], { cwd: SERVER, stdio: "inherit" });
  const profile = mkdtempSync(join(tmpdir(), "epub-reader-profile-"));
  scratch.push(profile);
  env = {
    ...process.env,
    EPUB_READER_CONFIG_FILE: join(profile, "settings.json"),
    EPUB_READER_CACHE_DIR: join(profile, "tts"),
  };
});

interface Reply {
  id: number;
  ok: boolean;
  result?: Record<string, unknown>;
  error?: string;
}

/** One request on a fresh host process (browsers spawn one per session). */
async function call(id: number, method: string, params: Record<string, unknown> = {}): Promise<Reply> {
  const proc = spawn(bin, ["--native-host"], { env, stdio: ["pipe", "pipe", "ignore"] });
  const body = Buffer.from(JSON.stringify({ id, method, params }));
  const frame = Buffer.alloc(4 + body.length);
  frame.writeUInt32LE(body.length, 0);
  body.copy(frame, 4);
  const chunks: Buffer[] = [];
  const done = new Promise<Reply>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("helper timed out")), 20_000);
    proc.stdout.on("data", (d: Buffer) => {
      chunks.push(d);
      const all = Buffer.concat(chunks);
      if (all.length < 4) return;
      const n = all.readUInt32LE(0);
      if (all.length < 4 + n) return;
      clearTimeout(timer);
      resolve(JSON.parse(all.subarray(4, 4 + n).toString()) as Reply);
      proc.kill();
    });
    proc.on("error", reject);
  });
  proc.stdin.write(frame);
  return done;
}

test("ping reports the helper version", async () => {
  const res = await call(1, "ping");
  expect(res).toMatchObject({ id: 1, ok: true, result: { ok: true } });
  expect(typeof (res.result as { version: string }).version).toBe("string");
});

test("settings round-trip through the real binary", async () => {
  const put = await call(2, "putSettings", { voice: "en-GB-RyanNeural" });
  expect(put.ok).toBe(true);
  expect(put.result).toMatchObject({ voice: "en-GB-RyanNeural" });
  const bad = await call(3, "putSettings", { cache_mb: 1 });
  expect(bad.ok).toBe(false);
  expect(bad.error).toMatch(/cache_mb/);
});

test("speech validates without reaching the network", async () => {
  const empty = await call(4, "speak", { text: "  " });
  expect(empty.ok).toBe(false);
  expect(empty.error).toMatch(/empty text/);
  const unknown = await call(5, "nope");
  expect(unknown.ok).toBe(false);
});

test("prefetch accepts a batch and cache answers stats", async () => {
  const pre = await call(6, "prefetch", { texts: ["hello", "", 5] });
  expect(pre).toMatchObject({ id: 6, ok: true });
  const stats = await call(7, "cacheStats");
  expect(stats.ok).toBe(true);
  expect(typeof (stats.result as { entries: number }).entries).toBe("number");
});
