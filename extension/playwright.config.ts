import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the *built* extension: Chromium is launched with
 * the unpacked MV3 output loaded, so these exercise the real manifest, the
 * real content-security policy, and the real reader page — not a dev server.
 *
 * The pure logic (highlighter, navigation, storage) is covered by the much
 * faster vitest suite in test/.
 */
const EXT = ".output/chrome-mv3";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  reporter: "list",
  timeout: 45_000,
  use: {
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "extension",
      use: { channel: "chromium" },
    },
  ],
  globalSetup: "./e2e/build.ts",
});

export { EXT };
