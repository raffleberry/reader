/** Read-aloud API: the server only ever sees plain text. */
import { api, reportDown, ServerDown } from "../ext/serve";

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
  try {
    return await fetch(api(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    // A refused connection or a timeout is the server not being there, and
    // the reader deserves to be told exactly that.
    reportDown();
    throw new ServerDown();
  }
}

/** The server's own complaint, or a plain HTTP failure. */
async function failure(res: Response): Promise<Error> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(data.error || `request failed (${res.status})`);
}

/** MP3 for one sentence text, as an object URL. */
export async function speakAudio(text: string): Promise<string> {
  const res = await post("/api/tts/audio", { text });
  if (!res.ok) throw await failure(res);
  return URL.createObjectURL(await res.blob());
}

/** Word timings for one sentence text. */
export async function getWords(text: string): Promise<Word[]> {
  const res = await post("/api/tts/words", { text });
  if (!res.ok) throw await failure(res);
  const data = (await res.json().catch(() => ({}))) as { words?: Word[] };
  return data.words || [];
}
