/**
 * Every reader preference, in extension storage.
 *
 * Storage (not localStorage) because the extension must not touch the
 * books themselves: these are settings and a note of where you stopped,
 * nothing else. Values are read once at start-up into the prefs store and
 * written back here on change.
 */
import { storage } from "wxt/utils/storage";
import { VOICES } from "../api/settings";
import { DEFAULT_SERVER } from "./serve";
import type { ThemeName } from "../types";

export const serverUrl = storage.defineItem<string>("local:serverUrl", {
  fallback: DEFAULT_SERVER,
});
export const voice = storage.defineItem<string>("local:voice", {
  fallback: VOICES[0],
});
export const rate = storage.defineItem<number>("local:rate", { fallback: 1 });
export const readahead = storage.defineItem<number>("local:readahead", { fallback: 3 });
export const theme = storage.defineItem<ThemeName>("local:theme", { fallback: "light" });
export const font = storage.defineItem<number>("local:font", { fallback: 100 });
export const autoscroll = storage.defineItem<boolean>("local:autoscroll", {
  fallback: false,
});
