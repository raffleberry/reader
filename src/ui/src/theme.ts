import type { ThemeName } from "./store/reader";

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
 * App-wide theme: sets our palette hook (data-theme) and Bootstrap's own
 * dark mode (data-bs-theme) so every Bootstrap component follows along.
 */
export function applyAppTheme(theme: ThemeName): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.bsTheme = theme === "dark" || theme === "monokai" ? "dark" : "light";
}
