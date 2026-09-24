/** Read-aloud API: the backend only ever sees plain text. */
import { DEMO_TTS_MESSAGE, IS_DEMO } from "../demo";

export interface Sentence {
  /** Chapter + index, e.g. "00-0003". */
  key: string;
  /** Spine index. */
  chapter: number;
  /** Chapter file inside the book. */
  href: string;
  /** Plain sentence text. */
  text: string;
}

export interface Word {
  text: string;
  start_ms: number;
  end_ms: number;
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await post(path, body);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

/** MP3 for one sentence text, as an object URL. */
export async function speakAudio(text: string): Promise<string> {
  if (IS_DEMO) throw new Error(DEMO_TTS_MESSAGE);
  const res = await post("/api/tts/audio", { text });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || `audio failed (${res.status})`);
  }
  return URL.createObjectURL(await res.blob());
}

/** Word timings for one sentence text. */
export async function getWords(text: string): Promise<Word[]> {
  if (IS_DEMO) throw new Error(DEMO_TTS_MESSAGE);
  const data = await postJson<{ words: Word[] }>("/api/tts/words", { text });
  return data.words || [];
}

/** Warm the server cache ahead of playback. Never throws. */
export async function prefetch(texts: string[]): Promise<void> {
  if (IS_DEMO) return;
  try {
    await fetch("/api/tts/prefetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });
  } catch {
    // Playback fetches directly; prefetch is best-effort.
  }
}
