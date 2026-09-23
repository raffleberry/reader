import { defineConfig, devices } from "@playwright/test";

// Browser tests for the read-aloud highlighter (tts/locate.ts +
// store/player.ts). Specs drive the real source modules through the vite dev
// server, so no build step or fixture app is needed.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
  },
  webServer: {
    command: "bun run dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
