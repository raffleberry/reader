/** Backend settings + TTS cache controls. */

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

async function json<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

export function getSettings(): Promise<Settings> {
  return fetch("/api/settings").then(json<Settings>);
}

export async function putSettings(patch: Partial<Settings>): Promise<Settings> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return json<Settings>(res);
}

export function cacheStats(): Promise<CacheStats> {
  return fetch("/api/cache/stats").then(json<CacheStats>);
}

export async function clearCache(): Promise<void> {
  await fetch("/api/cache", { method: "DELETE" }).then(json<unknown>);
}
