import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { BankDecodeError, decodeBankToPcm } from '../../src/audio/decodeBank';
import { loadTestG719Wasm } from '../helpers/g719';
import { CHN_X64, HAS_CORPUS } from '../helpers/resources';

const SOUND_DIR = resolve(CHN_X64, 'sound');

async function loadBytes(name: string): Promise<Uint8Array> {
  const buf = await readFile(resolve(SOUND_DIR, name));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe('decodeBankToPcm', () => {
  test.skipIf(!HAS_CORPUS)('routes a BNSF/IS22 song bank through the G.719 decoder', async () => {
    const bytes = await loadBytes('song_kumatm.nus3bank');
    const decoded = await decodeBankToPcm(bytes, 'song_kumatm', {
      maxSamples: 48_000,
      g719Wasm: await loadTestG719Wasm(),
    });
    expect(decoded.codec).toContain('BNSF/IS22');
    expect(decoded.toneName).toBe('song_kumatm');
    expect(decoded.channels).toBe(2);
    expect(decoded.sampleRate).toBe(48_000);
    expect(decoded.samplesPerChannel).toBe(48_000);
    expect(decoded.durationSeconds).toBeCloseTo(1, 6);
    expect(decoded.channelData).toHaveLength(2);
    for (const channel of decoded.channelData) {
      expect(channel).toHaveLength(48_000);
      let peak = 0;
      for (const v of channel) {
        expect(Number.isFinite(v)).toBe(true);
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      expect(peak).toBeLessThanOrEqual(1);
    }
  });

  test.skipIf(!HAS_CORPUS)('routes an IDSP song bank through the DSP-ADPCM decoder', async () => {
    const bytes = await loadBytes('song_i7poli.nus3bank');
    const decoded = await decodeBankToPcm(bytes, 'song_i7poli', { maxSamples: 4_410 });
    expect(decoded.codec).toContain('IDSP');
    expect(decoded.toneName).toBe('song_i7poli');
    expect(decoded.channels).toBe(2);
    expect(decoded.sampleRate).toBe(44_100);
    expect(decoded.samplesPerChannel).toBe(4_410);
    expect(decoded.channelData).toHaveLength(2);
    expect(decoded.channelData[1].some((v) => v !== 0 && Number.isFinite(v))).toBe(true);
  });

  test('BankDecodeError is a typed Error the UI can switch on', () => {
    const err = new BankDecodeError('no tone');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('BankDecodeError');
    expect(err.message).toBe('no tone');
  });

  test.skipIf(!HAS_CORPUS)('BNSF playback is disabled cleanly when no decoder was supplied', async () => {
    const bytes = await loadBytes('song_kumatm.nus3bank');
    await expect(decodeBankToPcm(bytes, 'song_kumatm')).rejects.toThrow(
      'G.719 decoder WASM is not configured',
    );
  });

  test('rejects bytes that are not a parseable bank', async () => {
    const garbage = new Uint8Array(64).fill(0xab);
    await expect(decodeBankToPcm(garbage, 'whatever')).rejects.toThrow();
  });
});
