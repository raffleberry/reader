/** Library API (same origin; vite proxies /api in dev). */

export interface Book {
  id: string;
  title: string;
  format: string;
  size: number;
  created: number;
}

async function json<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

export function listBooks(): Promise<Book[]> {
  return fetch("/api/books").then(json<Book[]>);
}

export function getBook(id: string): Promise<Book> {
  return fetch(`/api/books/${id}`).then(json<Book>);
}

/** Raw EPUB bytes URL for the reader component. */
export function fileUrl(id: string): string {
  return `/api/books/${id}/file`;
}

export async function uploadBook(file: File): Promise<Book> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/books", { method: "POST", body: form });
  return json<Book>(res);
}

export async function deleteBook(id: string): Promise<void> {
  await fetch(`/api/books/${id}`, { method: "DELETE" }).then(json<unknown>);
}
