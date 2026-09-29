import type { ThemeName } from "./types";

/**
 * Read-aloud highlight rules per theme. Light themes get the classic yellow
 * wash; dark themes get a dim sentence wash with a bright word pill in dark
 * text, so both stay readable on dark chapter backgrounds.
 */
export const HIGHLIGHT_CSS: Record<ThemeName, string> = {
  light: ".tts-sent{background:#fff3bf}.tts-word{background:#ffd43b}",
  sepia: ".tts-sent{background:#eed9a4}.tts-word{background:#dd9b00;color:#433422}",
  dark: ".tts-sent{background:#3d3403}.tts-word{background:#ffd43b;color:#1b1b1b}",
  monokai: ".tts-sent{background:#49483e}.tts-word{background:#e6db74;color:#272822}",
};

/**
 * Link colours per theme, injected into every chapter document.
 *
 * A book's own stylesheet decides what a link looks like, and plenty of them
 * use a plain dark blue (or the browser default) that vanishes against a dark
 * background. We set the colour and the underline explicitly per theme, so a
 * link always reads as a link — and an *external* one gets the usual marker.
 * `!important` because the EPUB's own rules are more specific than ours.
 */
export const LINK_CSS: Record<ThemeName, string> = {
  light: "a{color:#0a58ca!important}a:visited{color:#6f42c1!important}",
  sepia: "a{color:#8a4b00!important}a:visited{color:#6b3a86!important}",
  dark: "a{color:#7cc0ff!important}a:visited{color:#c4a7ff!important}",
  monokai: "a{color:#66d9ef!important}a:visited{color:#ae81ff!important}",
};

/**
 * App-wide theme: sets our palette hook (data-theme) and Bootstrap's own
 * dark mode (data-bs-theme) so every Bootstrap component follows along.
 */
export function applyAppTheme(theme: ThemeName): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.bsTheme = theme === "dark" || theme === "monokai" ? "dark" : "light";
}
