/**
 * The one audio element.
 *
 * Module scope on purpose: playback state must survive re-renders and be
 * reachable from both the player and the settings that change its speed.
 */

const el = new Audio();
el.preload = "auto";
/** Speed changes must not make the voice chipmunk. */
el.preservesPitch = true;

/** Object URL currently assigned to the element (revoked on swap). */
let blobUrl = "";

export function sound(): HTMLAudioElement {
  return el;
}

/** Point the element at audio, revoking whatever it replaces. */
export function setSource(url: string): void {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = url;
  if (url) el.src = url;
}

/** Re-assign the current source, to kick a stalled load. */
export function reload(): void {
  if (blobUrl) el.src = blobUrl;
}

/** Client-side playback speed; pitch stays put. */
export function applyRate(rate: number): void {
  el.preservesPitch = true;
  el.playbackRate = rate;
}

/** Element rate, for tests. */
export function audioRate(): number {
  return el.playbackRate;
}
