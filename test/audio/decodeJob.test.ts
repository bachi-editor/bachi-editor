import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runDecodeJob } from '../../src/audio/decodeJob';
import { loadTestG719Wasm } from '../helpers/g719';
import { HAS_CORPUS } from '../helpers/resources';

const REPO = resolve(__dirname, '../../..');
const SOUND_DIR = resolve(REPO, 'resources/TaikoCHN/Data/x64/sound');

async function loadBytes(name: string): Promise<Uint8Array> {
  const buf = await readFile(resolve(SOUND_DIR, name));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe.skipIf(!HAS_CORPUS)('runDecodeJob', () => {
  test('returns planar PCM plus a waveform envelope in one pass', async () => {
    const bytes = await loadBytes('song_kumatm.nus3bank');
    // 5s spans the ~1.4s silent intro plus real signal (mirrors the BNSF test).
    const job = await runDecodeJob({
      bankBytes: bytes,
      preferredStem: 'song_kumatm',
      peakBuckets: 256,
      maxSamples: 240_000,
      g719Wasm: await loadTestG719Wasm(),
    });

    expect(job.channels).toBe(2);
    expect(job.channelData).toHaveLength(2);
    expect(job.samplesPerChannel).toBe(240_000);

    expect(job.peaks.length).toBe(256);
    expect(job.peaks.min).toHaveLength(256);
    expect(job.peaks.max).toHaveLength(256);
    // Envelope stays bounded and max >= min in every bucket.
    let nonzero = 0;
    for (let i = 0; i < job.peaks.length; i++) {
      expect(job.peaks.max[i]).toBeGreaterThanOrEqual(job.peaks.min[i]);
      expect(Math.abs(job.peaks.max[i])).toBeLessThanOrEqual(1);
      expect(Math.abs(job.peaks.min[i])).toBeLessThanOrEqual(1);
      if (job.peaks.max[i] !== 0 || job.peaks.min[i] !== 0) nonzero++;
    }
    // A real song's envelope is mostly populated, not a flat line.
    expect(nonzero).toBeGreaterThan(128);
  });

  test('is deterministic', async () => {
    const bytes = await loadBytes('song_kumatm.nus3bank');
    const req = {
      bankBytes: bytes,
      g719Wasm: await loadTestG719Wasm(),
      preferredStem: 'song_kumatm',
      peakBuckets: 64,
      maxSamples: 9_600,
    };
    const a = await runDecodeJob(req);
    const b = await runDecodeJob(req);
    expect(Array.from(a.peaks.max)).toEqual(Array.from(b.peaks.max));
    expect(Array.from(a.channelData[0])).toEqual(Array.from(b.channelData[0]));
  });
});
