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
    name: "EPUB Reader",
    description: "Read EPUB books with read-aloud and word highlighting.",
    // Speech runs in a native helper the browser starts on demand: no port,
    // no address, and no website can reach it.
    permissions: ["storage", "nativeMessaging"],
    // No popup: clicking the icon opens (or focuses) the reader tab, which
    // the background script handles.
    action: { default_title: "Open EPUB Reader" },
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
