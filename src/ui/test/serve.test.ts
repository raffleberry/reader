import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  DEFAULT_SERVER,
  ServerDown,
  api,
  downMessage,
  normalizeUrl,
  onServerDown,
  probe,
  reportDown,
  setServerBase,
} from "../src/ext/serve";

/**
 * The speech server's address book: how we normalise what the user typed,
 * where every request goes, and what we say when nothing answers. The one
 * message here is the difference between "read-aloud is broken" and "you
 * haven't started the thing that speaks".
 */

beforeEach(() => {
  fakeBrowser.reset();
  setServerBase(DEFAULT_SERVER);
  vi.unstubAllGlobals();
});

describe("normalizeUrl", () => {
  it("keeps a bare address and gives it a scheme", () => {
    expect(normalizeUrl("127.0.0.1:8000")).toBe("http://127.0.0.1:8000");
    expect(normalizeUrl("localhost:9000")).toBe("http://localhost:9000");
  });

  it("reduces any spelling to a bare origin", () => {
    for (const raw of [
      "http://127.0.0.1:8000/",
      "http://127.0.0.1:8000/api",
      "  HTTPS://Reader.Example:8443/  ",
    ]) {
      expect(normalizeUrl(raw)).toBe(new URL(raw.trim()).origin);
    }
  });

  it("refuses what is not an http address", () => {
    for (const raw of ["", "   ", "ftp://x", "file:///tmp/book.epub", "not a url", "http://", "javascript:alert(1)"]) {
      expect(normalizeUrl(raw)).toBe("");
    }
  });
});

describe("setServerBase / api", () => {
  it("sends every request at the configured address", () => {
    setServerBase("127.0.0.1:9000");
    expect(api("/api/tts/audio")).toBe("http://127.0.0.1:9000/api/tts/audio");
  });

  it("falls back to the default when the address is unusable", () => {
    expect(setServerBase("not a url")).toBe(DEFAULT_SERVER);
    expect(api("/api/health")).toBe(`${DEFAULT_SERVER}/api/health`);
  });
});

describe("probe", () => {
  it("reports the version when the server answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true, version: "1.2.3" }))),
    );
    expect(await probe()).toEqual({ ok: true, version: "1.2.3" });
  });

  it("reports down when nothing is listening", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    const res = await probe();
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("reports down on a non-2xx health check", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    expect((await probe()).ok).toBe(false);
  });
});

describe("downMessage", () => {
  it("names the address it tried and where to get the server", () => {
    const msg = downMessage("http://127.0.0.1:9999");
    expect(msg).toContain("http://127.0.0.1:9999");
    expect(msg).toContain("Download it");
    expect(msg).toContain("https://github.com/raffleberry/reader/releases/latest");
  });
});

it("ServerDown carries the address it failed to reach", () => {
  setServerBase("127.0.0.1:8123");
  const err = new ServerDown();
  expect(err.name).toBe("ServerDown");
  expect(err.url).toBe("http://127.0.0.1:8123");
  expect(err.message).toBe(downMessage("http://127.0.0.1:8123"));
});

describe("reportDown", () => {
  it("tells the page that a request never connected", () => {
    let heard = 0;
    onServerDown(() => (heard += 1));
    reportDown();
    expect(heard).toBe(1);
  });

  it("is harmless when nobody is listening", () => {
    onServerDown(null);
    expect(() => reportDown()).not.toThrow();
  });
});
