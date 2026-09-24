/** Static demo build (no backend): `bun run build:demo` sets VITE_DEMO=1. */
export const IS_DEMO = import.meta.env.VITE_DEMO === "1";

/** Where to get the full app (with read-aloud) when running the demo. */
export const RELEASE_URL = "https://github.com/raffleberry/reader/releases/latest";

/** Shown wherever speech would play in the demo build. */
export const DEMO_TTS_MESSAGE =
  "Read-aloud needs the Reader app running on your computer. Download it here: " +
  RELEASE_URL;
