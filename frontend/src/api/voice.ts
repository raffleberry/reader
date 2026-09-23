/** Read-aloud API: sentences, per-sentence audio, word timings. */

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

interface ChaptersRes {
  chapters: { sentences: Sentence[] }[];
}

async function json<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

/** Flat sentence list in reading order. */
export async function getSentences(id: string): Promise<Sentence[]> {
  const data = await fetch(`/api/books/${id}/sentences`).then(json<ChaptersRes>);
  return data.chapters.flatMap((c) => c.sentences);
}

/** MP3 URL for one sentence. */
export function audioUrl(id: string, key: string): string {
  return `/api/books/${id}/audio/${key}`;
}

export async function getWords(id: string, key: string): Promise<Word[]> {
  const data = await fetch(`/api/books/${id}/words/${key}`).then(
    json<{ words: Word[] }>,
  );
  return data.words || [];
}
