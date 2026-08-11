import { describe, expect, test } from 'vitest';
import { floatToPcm16, normalizeAudioForGame, resampleLinear } from '../../src/audio';

describe('audio import normalization', () => {
  test('linearly resamples to the requested rate', () => {
    const out = resampleLinear(Float32Array.from([0, 1, 0]), 3, 6);
    expect(out).toHaveLength(6);
    expect(Array.from(out)).toEqual([0, 0.5, 1, 0.5, 0, 0]);
  });

  test('clips float PCM and handles non-finite input', () => {
    expect(Array.from(floatToPcm16(Float32Array.from([-2, -1, -0.5, 0, 0.5, 1, 2, Number.NaN]))))
      .toEqual([-32768, -32768, -16384, 0, 16384, 32767, 32767, 0]);
  });

  test('duplicates mono and normalizes to stereo 48 kHz PCM16', () => {
    const pcm = normalizeAudioForGame({
      sampleRate: 24_000,
      channelData: [Float32Array.from([0, 0.5, -0.5, 1])],
    });
    expect(pcm.sampleRate).toBe(48_000);
    expect(pcm.sampleCount).toBe(8);
    expect(pcm.channelData[0]).toEqual(pcm.channelData[1]);
    expect(pcm.channelData[0]).not.toBe(pcm.channelData[1]);
  });
});
