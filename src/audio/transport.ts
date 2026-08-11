// Pure transport-position math for the Web Audio player (PLAN 6.6). An
// AudioBufferSourceNode cannot be paused, so the player tracks an anchor (the
// buffer position when playback last (re)started, plus the AudioContext clock
// at that moment) and derives the live playhead from the context clock. Kept
// pure so it is unit-testable without an AudioContext.

export interface TransportAnchor {
  playing: boolean;
  /** Buffer position (seconds) captured at the anchor. */
  anchorTime: number;
  /** AudioContext.currentTime captured when playback (re)started. */
  anchorContextTime: number;
  /** Total buffer duration (seconds). */
  duration: number;
}

export function clamp(value: number, lo: number, hi: number): number {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/**
 * Current playhead position in seconds, clamped to [0, duration]. When paused
 * this is simply the anchor; when playing it advances with the context clock.
 */
export function computeCurrentTime(anchor: TransportAnchor, contextTime: number): number {
  if (!anchor.playing) {
    return clamp(anchor.anchorTime, 0, anchor.duration);
  }
  const elapsed = contextTime - anchor.anchorContextTime;
  return clamp(anchor.anchorTime + elapsed, 0, anchor.duration);
}
