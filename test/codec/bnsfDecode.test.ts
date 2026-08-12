import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  decodeBnsfToPcm,
  G719_SAMPLES_PER_FRAME,
  parseNus3Bank,
  selectPlayableTone,
} from '../../src/codec';
import { loadTestG719Wasm } from '../helpers/g719';
import { CHN_X64, HAS_CORPUS } from '../helpers/resources';

const SOUND_DIR = resolve(CHN_X64, 'sound');

async function loadBnsfStream(name: string) {
  const buf = await readFile(resolve(SOUND_DIR, name));
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const bank = parseNus3Bank(bytes);
  const selected = selectPlayableTone(bank, name.slice(0, -'.nus3bank'.length));
  if (!selected) throw new Error(`no playable tone in ${name}`);
  return { bytes, stream: selected.stream };
}

function stats(pcm: Float32Array) {
  let peak = 0;
  let sumSq = 0;
  let nonFinite = 0;
  let nonzero = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i];
    if (!Number.isFinite(v)) nonFinite++;
    if (Math.abs(v) > peak) peak = Math.abs(v);
    if (v !== 0) nonzero++;
    sumSq += v * v;
  }
  return { peak, rms: Math.sqrt(sumSq / pcm.length), nonFinite, nonzero };
}

describe.skipIf(!HAS_CORPUS)('BNSF/IS22 G.719 decode', () => {
  // 5s prefix keeps the test fast while spanning the song's ~1.4s silent
  // intro plus real signal (~250 frames/channel of overlap-add state).
  const PREFIX = 240_000;

  test('decodes a real song bank to sane stereo PCM', async () => {
    const { bytes, stream } = await loadBnsfStream('song_kumatm.nus3bank');
    const pcm = await decodeBnsfToPcm(bytes, stream, {
      maxSamples: PREFIX,
      g719Wasm: await loadTestG719Wasm(),
    });

    expect(pcm.sampleRate).toBe(48_000);
    expect(pcm.channels).toBe(2);
    expect(pcm.channelData).toHaveLength(2);
    expect(pcm.samplesPerChannel).toBe(PREFIX);
    expect(pcm.durationSeconds).toBeCloseTo(PREFIX / 48_000, 5);

    for (const channel of pcm.channelData) {
      expect(channel).toHaveLength(PREFIX);
      const s = stats(channel);
      expect(s.nonFinite, 'all samples finite').toBe(0);
      expect(s.peak, 'normalised within [-1,1]').toBeLessThanOrEqual(1);
      expect(s.peak, 'carries real signal').toBeGreaterThan(0.05);
      // Past the silent intro the window is mostly non-zero, not a sparse spike.
      expect(s.nonzero / channel.length).toBeGreaterThan(0.3);
    }
    // True stereo: the two channels are not identical.
    expect(pcm.channelData[0]).not.toEqual(pcm.channelData[1]);
  });

  test('is deterministic across runs', async () => {
    const { bytes, stream } = await loadBnsfStream('song_kumatm.nus3bank');
    const g719Wasm = await loadTestG719Wasm();
    const a = await decodeBnsfToPcm(bytes, stream, { maxSamples: G719_SAMPLES_PER_FRAME * 8, g719Wasm });
    const b = await decodeBnsfToPcm(bytes, stream, { maxSamples: G719_SAMPLES_PER_FRAME * 8, g719Wasm });
    expect(a.channelData[0]).toEqual(b.channelData[0]);
    expect(a.channelData[1]).toEqual(b.channelData[1]);
  });

  test('a decoded prefix matches the head of a longer decode (state/order correct)', async () => {
    const { bytes, stream } = await loadBnsfStream('song_kumatm.nus3bank');
    const g719Wasm = await loadTestG719Wasm();
    const short = await decodeBnsfToPcm(bytes, stream, { maxSamples: G719_SAMPLES_PER_FRAME * 4, g719Wasm });
    const long = await decodeBnsfToPcm(bytes, stream, { maxSamples: G719_SAMPLES_PER_FRAME * 12, g719Wasm });
    for (let ch = 0; ch < 2; ch++) {
      expect(Array.from(short.channelData[ch])).toEqual(
        Array.from(long.channelData[ch].subarray(0, short.channelData[ch].length)),
      );
    }
  });
});
