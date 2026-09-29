import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

/**
 * Unit tests for the pure parts of the reader: the highlighter, the player's
 * navigation, the settings and the two storage-backed modules (shelf,
 * server). WxtVitest gives us a working `browser.storage` in memory, so
 * storage code is tested against the real API surface.
 */
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.ts"],
  },
});
