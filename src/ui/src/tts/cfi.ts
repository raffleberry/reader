/** The slice of the epub.js Rendition our app uses. */
export function spinePosOf(cfi: string): number {
  const m = /^epubcfi\(\/6\/(\d+)/.exec(cfi);
  if (!m) return -1;
  const num = parseInt(m[1], 10);
  if (!Number.isFinite(num) || num % 2 !== 0) return -1;
  return num / 2 - 1;
}

/** Do two locations sit in the same chapter of the book? */
export function sameChapter(a: string, b: string): boolean {
  if (!a || !b) return false;
  const one = spinePosOf(a);
  return one >= 0 && one === spinePosOf(b);
}
