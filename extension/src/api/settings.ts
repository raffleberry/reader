/** Helper settings + speech-cache controls, over native messaging. */
import { reportDown, request, ServerDown, timeoutFor } from "../ext/serve";

export interface Settings {
  cache_mb: number;
  readahead: number;
  voice: string;
}

/** English Edge voices, live 2026-09-24. Ava first: it is the default. */
export const VOICES = [
  "en-US-AvaNeural",
  "en-AU-NatashaNeural",
  "en-AU-WilliamMultilingualNeural",
  "en-CA-ClaraNeural",
  "en-CA-LiamNeural",
  "en-GB-LibbyNeural",
  "en-GB-MaisieNeural",
  "en-GB-RyanNeural",
  "en-GB-SoniaNeural",
  "en-GB-ThomasNeural",
  "en-HK-SamNeural",
  "en-HK-YanNeural",
  "en-IE-ConnorNeural",
  "en-IE-EmilyNeural",
  "en-IN-NeerjaExpressiveNeural",
  "en-IN-NeerjaNeural",
  "en-IN-PrabhatNeural",
  "en-KE-AsiliaNeural",
  "en-KE-ChilembaNeural",
  "en-NG-AbeoNeural",
  "en-NG-EzinneNeural",
  "en-NZ-MitchellNeural",
  "en-NZ-MollyNeural",
  "en-PH-JamesNeural",
  "en-PH-RosaNeural",
  "en-SG-LunaNeural",
  "en-SG-WayneNeural",
  "en-TZ-ElimuNeural",
  "en-TZ-ImaniNeural",
  "en-US-AnaNeural",
  "en-US-AndrewMultilingualNeural",
  "en-US-AndrewNeural",
  "en-US-AriaNeural",
  "en-US-AvaMultilingualNeural",
  "en-US-BrianMultilingualNeural",
  "en-US-BrianNeural",
  "en-US-ChristopherNeural",
  "en-US-EmmaMultilingualNeural",
  "en-US-EmmaNeural",
  "en-US-EricNeural",
  "en-US-GuyNeural",
  "en-US-JennyNeural",
  "en-US-MichelleNeural",
  "en-US-RogerNeural",
  "en-US-SteffanNeural",
  "en-ZA-LeahNeural",
  "en-ZA-LukeNeural",
];

export interface CacheStats {
  entries: number;
  bytes: number;
}

/** Run a call, turning "nothing is listening" into the one clear error. */
async function call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  try {
    return await request(method, params, timeoutFor(method));
  } catch (err) {
    if (err instanceof ServerDown) {
      reportDown();
      throw err;
    }
    throw err instanceof Error ? err : new Error("request failed");
  }
}

export function getSettings(): Promise<Settings> {
  return call("getSettings") as Promise<Settings>;
}

export function putSettings(patch: Partial<Settings>): Promise<Settings> {
  return call("putSettings", patch as Record<string, unknown>) as Promise<Settings>;
}

export function cacheStats(): Promise<CacheStats> {
  return call("cacheStats") as Promise<CacheStats>;
}

export async function clearCache(): Promise<void> {
  await call("clearCache");
}
