/**
 * The speech helper: where it is, and how to tell it isn't there.
 *
 * Speech runs in a small app on the user's own machine, reached over
 * native messaging (the browser starts it on demand — there is no port,
 * no address to type, and no website can reach it). Every failure that
 * isn't our fault (helper not installed, answered with an error) resolves
 * to one honest message: here is what speech needs, and where to get it.
 */
import { browser } from "wxt/browser";

/** The native-messaging host name. The Go server installs itself under it. */
export const HOST = "com.raffleberry.epubreader";

/** Where to get the speech helper when it isn't installed. */
export const RELEASE_URL = "https://github.com/raffleberry/reader/releases/latest";

/** End-user setup guide: run once, then never again. */
export const INSTALL_URL = "https://github.com/raffleberry/reader/blob/main/INSTALL.md";

/** How long a liveness ping may take: a local answer is instant or missing. */
const PROBE_MS = 8000;

/** Settings/cache calls get a little longer; speech gets minutes. */
const QUICK_MS = 10_000;
const SPEAK_MS = 120_000;

interface NativePort {
  postMessage(msg: unknown): void;
  disconnect(): void;
  onMessage: {
    addListener(cb: (msg: NativeReply) => void): void;
    removeListener(cb: (msg: NativeReply) => void): void;
  };
  onDisconnect: {
    addListener(cb: () => void): void;
    removeListener(cb: () => void): void;
  };
}

interface NativeReply {
  id?: number;
  ok?: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Told when the helper is gone. A disconnect (or a call made with no host
 * at all) is proof it went away, and waiting for the next probe would leave
 * the UI claiming everything is fine.
 */
let onDown: (() => void) | null = null;

/** Register the "it's gone" listener (one per page; null clears it). */
export function onServerDown(fn: (() => void) | null): void {
  onDown = fn;
}

export function reportDown(): void {
  onDown?.();
}

/** The message shown whenever speech is needed and there is nothing to ask. */
export function downMessage(): string {
  return (
    `Read-aloud needs the EPUB Reader speech helper, and it isn't answering. ` +
    `Download it, run it once so it installs itself, then press play again: ${RELEASE_URL} ` +
    `(setup guide: ${INSTALL_URL})`
  );
}

/** Thrown so callers can tell "no helper" from "no audio". */
export class ServerDown extends Error {
  constructor() {
    super(downMessage());
    this.name = "ServerDown";
  }
}

/** One live browser→host channel, shared by every request on the page. */
let port: NativePort | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: number }>();

function failAll(err: Error): void {
  for (const [, p] of pending) {
    window.clearTimeout(p.timer);
    p.reject(err);
  }
  pending.clear();
}

function dropPort(): void {
  if (!port) return;
  const gone = port;
  port = null;
  try {
    gone.onMessage.removeListener(onReply);
  } catch {
    // Already gone.
  }
  try {
    gone.onDisconnect.removeListener(onGone);
  } catch {
    // Already gone.
  }
}

function onReply(msg: NativeReply): void {
  const id = typeof msg?.id === "number" ? msg.id : -1;
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  window.clearTimeout(p.timer);
  if (msg?.ok) p.resolve(msg.result);
  else p.reject(new Error(typeof msg?.error === "string" && msg.error ? msg.error : "request failed"));
}

function onGone(): void {
  dropPort();
  failAll(new ServerDown());
  reportDown();
}

function connector(): ((host: string) => NativePort) | undefined {
  // Globals first: extension pages always have chrome/browser, and the test
  // harness stubs the chrome global to fake the helper.
  const g = globalThis as unknown as {
    chrome?: { runtime?: { connectNative?: (host: string) => NativePort } };
    browser?: { runtime?: { connectNative?: (host: string) => NativePort } };
  };
  if (g.chrome?.runtime?.connectNative) return g.chrome.runtime.connectNative.bind(g.chrome.runtime);
  if (g.browser?.runtime?.connectNative) return g.browser.runtime.connectNative.bind(g.browser.runtime);
  const wxtRuntime = (browser as unknown as { runtime?: { connectNative?: (host: string) => NativePort } })
    .runtime;
  if (wxtRuntime?.connectNative) return wxtRuntime.connectNative.bind(wxtRuntime);
  return undefined;
}

function openPort(): NativePort {
  if (port) return port;
  const connect = connector();
  if (!connect) throw new ServerDown();
  let opened: NativePort;
  try {
    opened = connect(HOST);
  } catch {
    throw new ServerDown();
  }
  if (!opened) throw new ServerDown();
  port = opened;
  port.onMessage.addListener(onReply);
  port.onDisconnect.addListener(onGone);
  return port;
}

/** Close the host channel (tests; the browser closes it for real sessions). */
export function closeHost(): void {
  failAll(new ServerDown());
  dropPort();
  try {
    // Best effort: a live port is closed by the browser on unload anyway.
    port?.disconnect();
  } catch {
    // Nothing to close.
  }
  port = null;
}

/**
 * One call to the helper. Resolves with `result`; throws ServerDown when
 * the helper is missing or went away, or the helper's own error otherwise.
 */
export async function request(method: string, params: Record<string, unknown> = {}, timeoutMs = QUICK_MS): Promise<unknown> {
  let live: NativePort;
  try {
    live = openPort();
  } catch {
    reportDown();
    throw new ServerDown();
  }
  const id = nextId++;
  return new Promise<unknown>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new ServerDown());
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    try {
      live.postMessage({ id, method, params });
    } catch {
      pending.delete(id);
      window.clearTimeout(timer);
      dropPort();
      reportDown();
      reject(new ServerDown());
    }
  }).catch((err) => {
    // A refused spawn is the helper not being there; say exactly that.
    if (err instanceof ServerDown) reportDown();
    throw err;
  });
}

export interface Probe {
  ok: boolean;
  version?: string;
  error?: string;
}

/** Is the helper installed and answering? Never throws; never waits long. */
export async function probe(): Promise<Probe> {
  try {
    const data = (await request("ping", {}, PROBE_MS)) as { version?: string };
    return { ok: true, version: data?.version };
  } catch (err) {
    return { ok: false, error: (err as Error).message || "no answer" };
  }
}

/** Timeout budget per method, so speech never trips a settings timer. */
export function timeoutFor(method: string): number {
  return method === "speak" || method === "ttsWords" ? SPEAK_MS : QUICK_MS;
}
