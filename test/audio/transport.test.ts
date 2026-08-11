import { describe, expect, test } from 'vitest';
import { clamp, computeCurrentTime, type TransportAnchor } from '../../src/audio/transport';

describe('clamp', () => {
  test('bounds to [lo, hi]', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe('computeCurrentTime', () => {
  const paused: TransportAnchor = { playing: false, anchorTime: 12, anchorContextTime: 100, duration: 60 };

  test('paused returns the anchor, clamped', () => {
    expect(computeCurrentTime(paused, 999)).toBe(12);
    expect(computeCurrentTime({ ...paused, anchorTime: -5 }, 0)).toBe(0);
    expect(computeCurrentTime({ ...paused, anchorTime: 99 }, 0)).toBe(60);
  });

  test('playing advances with the context clock from the anchor', () => {
    const playing: TransportAnchor = { playing: true, anchorTime: 12, anchorContextTime: 100, duration: 60 };
    // 3.5s of context time elapsed since the anchor.
    expect(computeCurrentTime(playing, 103.5)).toBeCloseTo(15.5, 6);
  });

  test('playing clamps to duration once the buffer would have finished', () => {
    const playing: TransportAnchor = { playing: true, anchorTime: 55, anchorContextTime: 0, duration: 60 };
    expect(computeCurrentTime(playing, 100)).toBe(60);
  });

  test('never goes negative', () => {
    const playing: TransportAnchor = { playing: true, anchorTime: 0, anchorContextTime: 50, duration: 60 };
    // Context time before the anchor (shouldn't happen, but stays clamped).
    expect(computeCurrentTime(playing, 49)).toBe(0);
  });
});
