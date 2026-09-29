/** Read-aloud API: the helper only ever sees plain text. */
import { reportDown, request, ServerDown, timeoutFor } from "../ext/serve";

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

interface SpeakResult {
  audio?: string;
  words?: Word[];
}

/** Run a call, turning "nothing is listening" into the one clear error. */
async function call(method: string, params: Record<string, unknown>): Promise<unknown> {
  try {
    return await request(method, params, timeoutFor(method));
  } catch (err) {
    if (err instanceof ServerDown) {
      reportDown();
      throw err;
    }
    // The helper answered with its own complaint (bad text, TTS failure).
    // Log what we sent: without this the failure leaves no trace anywhere.
    const text = typeof params.text === "string" ? params.text : "";
    console.error(`[voice] ${method} failed for ${JSON.stringify(text.slice(0, 80))}:`, err);
    throw err instanceof Error ? err : new Error("request failed");
  }
}

function toBlobURL(b64: string): string {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: "audio/mpeg" }));
}

/** MP3 for one sentence text, as an object URL. */
export async function speakAudio(text: string): Promise<string> {
  const data = (await call("speak", { text })) as SpeakResult;
  if (!data?.audio) throw new Error("speech helper returned no audio");
  return toBlobURL(data.audio);
}

/** Word timings for one sentence text. */
export async function getWords(text: string): Promise<Word[]> {
  const data = (await call("ttsWords", { text })) as { words?: Word[] };
  return data?.words || [];
}
