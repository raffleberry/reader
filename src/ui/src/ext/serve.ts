/**
 * The speech server: where it is, and how to tell it isn't there.
 *
 * The extension holds the books; this server only turns text into audio. So
 * every failure mode that isn't our fault (not running, wrong port, not the
 * Reader server) resolves to one honest message: here is where we looked,
 * here is where to get the thing that should be listening.
 */

/** Where to get the server when it isn't running. */
export const RELEASE_URL = "https://github.com/raffleberry/reader/releases/latest";

/** Where the packaged speech server listens unless it was moved. */
export const DEFAULT_SERVER = "http://127.0.0.1:8000";

/** Health probe timeout: a local answer is instant or it isn't there. */
const PROBE_MS = 2500;

/**
 * Told when a request never reached the server. A failed fetch is proof it
 * went away, and waiting for the next health probe to notice would leave
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

/** Any http(s) address. The server allows our origin, so a LAN host works. */
export function normalizeUrl(raw: string): string {
  const text = (raw || "").trim();
  if (!text) return "";
  // A scheme the user typed must be one we can actually speak to; anything
  // else is left alone rather than quietly reinterpreted as a host name.
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(text);
  if (scheme && !/^https?$/i.test(scheme[1])) return "";
  const withScheme = scheme ? text : `http://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.origin;
  } catch {
    return "";
  }
}

/**
 * The current base URL, module-scope so the API layer can build a request
 * without a store lookup. Set once at start-up and whenever the user saves
 * a different address.
 */
let base = DEFAULT_SERVER;

export function setServerBase(url: string): string {
  const next = normalizeUrl(url) || DEFAULT_SERVER;
  base = next;
  return next;
}

/** Absolute URL for one API path. */
export function api(path: string): string {
  return `${base}${path}`;
}

export interface Probe {
  ok: boolean;
  version?: string;
  error?: string;
}

/** Is the server up? Never throws; never waits long. */
export async function probe(url = base): Promise<Probe> {
  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(PROBE_MS),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `server said ${res.status}` };
    const data = (await res.json().catch(() => ({}))) as { version?: string };
    return { ok: true, version: data.version };
  } catch (err) {
    // Offline, refused, DNS, timeout: all mean the same thing to a reader.
    return { ok: false, error: (err as Error).message || "no answer" };
  }
}

/** The message shown whenever speech is needed and there is nothing to ask. */
export function downMessage(url = base): string {
  return (
    `Read-aloud needs the Reader server, and nothing answered at ${url}. ` +
    `Download it, then press play again: ${RELEASE_URL}`
  );
}

/** Thrown by the API layer so callers can tell "no server" from "no audio". */
export class ServerDown extends Error {
  readonly url: string;

  constructor(url = base) {
    super(downMessage(url));
    this.name = "ServerDown";
    this.url = url;
  }
}
