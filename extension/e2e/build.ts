import { execFileSync } from "node:child_process";

/**
 * Build the extension before the suite runs: the tests load the real
 * unpacked output, so a stale build would test yesterday's code.
 */
export default function globalSetup(): void {
  execFileSync("bun", ["x", "wxt", "build"], {
    cwd: new URL("..", import.meta.url).pathname,
    stdio: "inherit",
  });
}
