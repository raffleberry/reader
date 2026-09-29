import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  HOST,
  ServerDown,
  closeHost,
  downMessage,
  onServerDown,
  probe,
  reportDown,
  request,
  timeoutFor,
} from "../src/ext/serve";

/**
 * The speech helper's lifeline: one persistent native-messaging channel,
 * request ids routed to the right waiter, and one honest message when the
 * helper isn't there. That message is the difference between "read-aloud is
 * broken" and "you haven't run the thing that speaks yet".
 */

interface Posted {
  id: number;
  method: string;
  params: Record<string, unknown>;
}

/** A fake browser→host channel that answers from `reply`. */
function fakePort(reply: (msg: Posted) => unknown) {
  const state: {
    posted: Posted[];
    onMsg: ((m: unknown) => void) | null;
    onDisc: (() => void) | null;
  } = { posted: [], onMsg: null, onDisc: null };
  return {
    posted: state.posted,
    disconnect: vi.fn(),
    onMessage: {
      addListener(cb: (m: unknown) => void): void {
        state.onMsg = cb;
      },
      removeListener(): void {
        state.onMsg = null;
      },
    },
    onDisconnect: {
      addListener(cb: () => void): void {
        state.onDisc = cb;
      },
      removeListener(): void {
        state.onDisc = null;
      },
    },
    postMessage(msg: Posted): void {
      state.posted.push(msg);
      const result = reply(msg) as Record<string, unknown>;
      queueMicrotask(() => {
        if (result && typeof result === "object" && "$error" in result) {
          state.onMsg?.({ id: msg.id, ok: false, error: result.$error });
        } else {
          state.onMsg?.({ id: msg.id, ok: true, result });
        }
      });
    },
  };
}

/** Pretend the helper is installed and answers every call from `reply`. */
function hostUp(reply: (msg: Posted) => unknown = () => ({})) {
  const port = fakePort(reply);
  const connect = vi.fn(() => port);
  vi.stubGlobal("chrome", { runtime: { connectNative: connect } });
  return { port, connect };
}

/** …or that it was never installed. */
function hostMissing(): void {
  vi.stubGlobal("chrome", { runtime: { connectNative: vi.fn(() => undefined) } });
}

beforeEach(() => {
  fakeBrowser.reset();
  closeHost();
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("sends the host name and routes the answer by id", async () => {
    const { port, connect } = hostUp((msg) =>
      msg.method === "ping" ? { version: "9.9.9" } : {},
    );
    const answer = (await request("ping", {}, 1000)) as { version: string };
    expect(connect).toHaveBeenCalledWith(HOST);
    expect(answer.version).toBe("9.9.9");
    expect(port.posted).toHaveLength(1);
    expect(port.posted[0].method).toBe("ping");
  });

  it("reuses one channel for concurrent calls", async () => {
    const { connect } = hostUp((msg) => ({ echo: msg.method }));
    const [a, b] = await Promise.all([request("getSettings"), request("cacheStats")]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ echo: "getSettings" });
    expect(b).toEqual({ echo: "cacheStats" });
  });

  it("throws the helper's own complaint for a bad call", async () => {
    hostUp(() => ({ $error: "empty text" }));
    const err = await request("speak", { text: "" }, 1000).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(ServerDown);
    expect((err as Error).message).toBe("empty text");
  });

  it("says ServerDown when the helper was never installed", async () => {
    hostMissing();
    let heard = 0;
    onServerDown(() => (heard += 1));
    await expect(request("ping", {}, 50)).rejects.toBeInstanceOf(ServerDown);
    expect(heard).toBe(1);
  });
});

describe("probe", () => {
  it("reports the version when the helper answers", async () => {
    hostUp(() => ({ version: "1.2.3" }));
    expect(await probe()).toEqual({ ok: true, version: "1.2.3" });
  });

  it("reports down when nothing is installed", async () => {
    hostMissing();
    const res = await probe();
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("reports down when spawning the helper fails", async () => {
    vi.stubGlobal("chrome", {
      runtime: {
        connectNative: vi.fn(() => {
          throw new Error("No such host");
        }),
      },
    });
    expect((await probe()).ok).toBe(false);
  });
});

describe("downMessage", () => {
  it("says to run the download once and where the guide is", () => {
    const msg = downMessage();
    expect(msg).toContain("run it once");
    expect(msg).toContain("Download it");
    expect(msg).toContain("https://github.com/raffleberry/reader/releases/latest");
  });
});

it("ServerDown carries the one honest message", () => {
  const err = new ServerDown();
  expect(err.name).toBe("ServerDown");
  expect(err.message).toBe(downMessage());
});

describe("timeoutFor", () => {
  it("gives speech minutes and settings seconds", () => {
    expect(timeoutFor("speak")).toBeGreaterThanOrEqual(60_000);
    expect(timeoutFor("ttsWords")).toBeGreaterThanOrEqual(60_000);
    expect(timeoutFor("ping")).toBeLessThan(60_000);
  });
});

describe("reportDown", () => {
  it("tells the page that the helper is gone", () => {
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
