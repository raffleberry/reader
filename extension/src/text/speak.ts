/**
 * Speakability: which sentences are worth sending to the speech helper.
 *
 * Books are full of scene-break dinkus ("***", "* * *", "~~~"), dingbats
 * ("❦") and other punctuation-only lines. The speech service answers those
 * with no audio at all, which the helper rightly reports as a failure — so
 * the player skips anything with no letter or number instead of speaking it.
 */

/** True when the text holds at least one Unicode letter or number. */
export function speakable(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}
