/**
 * Every reader preference, in extension storage.
 *
 * Storage (not localStorage) because the extension must not touch the
 * books themselves: these are settings and a note of where you stopped,
 * nothing else. Values are read once at start-up into the prefs store and
 * written back here on change. Speech lives in the native helper, so there
 * is no server address to keep: nothing to type, nothing to misconfigure.
 */
import { storage } from "wxt/utils/storage";
import type { ThemeName } from "../types";

export const rate = storage.defineItem<number>("local:rate", { fallback: 1 });
export const readahead = storage.defineItem<number>("local:readahead", { fallback: 3 });
export const theme = storage.defineItem<ThemeName>("local:theme", { fallback: "light" });
export const font = storage.defineItem<number>("local:font", { fallback: 100 });
export const autoscroll = storage.defineItem<boolean>("local:autoscroll", {
  fallback: false,
});
