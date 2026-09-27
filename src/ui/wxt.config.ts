import { defineConfig } from "wxt";

/**
 * WXT builds the extension. `srcDir: "src"` puts `entrypoints/` next to the
 * app's own `views/`, `components/` and `stores/`, so the reader source
 * stays exactly where it has always lived.
 *
 * Auto-imports are off: this codebase imports everything explicitly.
 */
export default defineConfig({
  srcDir: "src",
  modules: ["@wxt-dev/module-vue", "@wxt-dev/auto-icons"],
  imports: false,
  // One hand-written SVG; the module renders the PNG sizes each browser wants.
  autoIcons: { baseIconPath: "assets/icon.svg" },
  manifest: ({ browser }) => ({
    name: "Reader",
    description: "Read EPUB books with read-aloud and word highlighting.",
    permissions: ["storage"],
    // Match patterns ignore the port, so any local port works. The server
    // also allows the extension origin over CORS, which is what makes
    // Firefox (where host permissions are opt-in) and a server on another
    // host reachable at all.
    host_permissions: ["http://127.0.0.1/*", "http://localhost/*"],
    // No popup: clicking the icon opens (or focuses) the reader tab, which
    // the background script handles.
    action: { default_title: "Open Reader" },
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "reader@raffleberry.github.io",
              data_collection_permissions: { required: ["none"] },
            },
          },
        }
      : {}),
  }),
  vite: () => ({
    build: { target: "chrome110" },
  }),
});
