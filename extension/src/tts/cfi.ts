/**
 * Same-section checks for saved places. New places hold a foliate section
 * CFI (the stable per-section part before the `!`); places saved by older
 * versions hold a full epub.js CFI, which never matches — those books simply
 * resume at the chapter top instead of the sentence.
 */
export function sameChapter(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (!a.startsWith("epubcfi(") || !b.startsWith("epubcfi(")) return a === b;
  const pos = (cfi: string): number => {
    const m = /^epubcfi\(\/6\/(\d+)/.exec(cfi);
    if (!m) return -1;
    const num = parseInt(m[1], 10);
    if (!Number.isFinite(num) || num % 2 !== 0) return -1;
    return num / 2 - 1;
  };
  const one = pos(a);
  return one >= 0 && one === pos(b);
}
