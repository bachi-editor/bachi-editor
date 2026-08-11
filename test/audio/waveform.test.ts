import { describe, expect, test } from 'vitest';
import { computePeaks } from '../../src/audio/waveform';

function expectClose(actual: Float32Array, expected: number[]): void {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i++) expect(actual[i]).toBeCloseTo(expected[i], 5);
}

describe('computePeaks', () => {
  test('captures per-bucket min/max of a mono signal', () => {
    // 8 frames, 4 buckets -> 2 frames per bucket.
    const ch = new Float32Array([0.1, 0.3, -0.2, -0.5, 0.9, 0.4, -1, 0.2]);
    const peaks = computePeaks([ch], 4);
    expect(peaks.length).toBe(4);
    expectClose(peaks.max, [0.3, -0.2, 0.9, 0.2]);
    expectClose(peaks.min, [0.1, -0.5, 0.4, -1]);
  });

  test('mono-mixes multiple channels', () => {
    const left = new Float32Array([1, 0]);
    const right = new Float32Array([0, 1]);
    const peaks = computePeaks([left, right], 1);
    // Single bucket over both frames: mixed values are 0.5 and 0.5.
    expect(peaks.max[0]).toBeCloseTo(0.5, 6);
    expect(peaks.min[0]).toBeCloseTo(0.5, 6);
  });

  test('the last bucket absorbs the remainder when frames do not divide evenly', () => {
    const ch = new Float32Array([0.2, 0.4, 0.6, 0.8, 1]); // 5 frames, 2 buckets
    const peaks = computePeaks([ch], 2);
    expect(peaks.length).toBe(2);
    // bucket 0 -> frames [0,2): max 0.4; bucket 1 -> frames [2,5): max 1.
    expect(peaks.max[0]).toBeCloseTo(0.4, 6);
    expect(peaks.max[1]).toBeCloseTo(1, 6);
  });

  test('empty buckets (frames < buckets) collapse to zero, never Infinity', () => {
    const ch = new Float32Array([0.5, -0.5]); // 2 frames, 5 buckets
    const peaks = computePeaks([ch], 5);
    expect(peaks.length).toBe(5);
    for (let i = 0; i < peaks.length; i++) {
      expect(Number.isFinite(peaks.min[i])).toBe(true);
      expect(Number.isFinite(peaks.max[i])).toBe(true);
    }
  });

  test('no channels / no frames yields a zero envelope', () => {
    expectClose(computePeaks([], 3).max, [0, 0, 0]);
    expectClose(computePeaks([new Float32Array(0)], 3).min, [0, 0, 0]);
  });

  test('clamps a non-positive bucket count to one', () => {
    const peaks = computePeaks([new Float32Array([0.5, -0.5])], 0);
    expect(peaks.length).toBe(1);
    expect(peaks.max[0]).toBeCloseTo(0.5, 6);
    expect(peaks.min[0]).toBeCloseTo(-0.5, 6);
  });
});
