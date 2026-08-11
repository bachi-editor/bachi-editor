import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { openEnvelope, sealEnvelope } from '../../src/codec/envelope';
import { DATATABLE_KEY_HEX, FUMEN_KEY_HEX } from '../helpers/keys';
import { HAS_CORPUS } from '../helpers/resources';

const REPO = resolve(__dirname, '../../..');
const DATATABLE_DIR = resolve(REPO, 'resources/TaikoCHN/Data/x64/datatable');

async function load(p: string): Promise<Uint8Array> {
  const buf = await readFile(p);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

describe.skipIf(!HAS_CORPUS)('envelope against real CHN datatable files', () => {
  test('decrypts musicinfo.bin to valid JSON', async () => {
    const bytes = await load(resolve(DATATABLE_DIR, 'musicinfo.bin'));
    const { payload } = await openEnvelope(bytes, DATATABLE_KEY_HEX);
    const text = new TextDecoder().decode(payload);
    const parsed = JSON.parse(text);
    expect(Array.isArray(parsed.items) || Array.isArray(parsed.musicInfoEntries) || typeof parsed === 'object').toBe(true);
    // dump top-level keys to help us pick the right shape later
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // eslint-disable-next-line no-console
      console.log('musicinfo top-level keys:', Object.keys(parsed));
    }
  });

  test('musicinfo round-trip recovers byte-identical payload', async () => {
    const bytes = await load(resolve(DATATABLE_DIR, 'musicinfo.bin'));
    const { payload, iv } = await openEnvelope(bytes, DATATABLE_KEY_HEX);
    const reSealed = await sealEnvelope(payload, DATATABLE_KEY_HEX, iv);
    const { payload: payload2, iv: iv2 } = await openEnvelope(reSealed, DATATABLE_KEY_HEX);
    expect(iv2).toEqual(iv);
    expect(payload2).toEqual(payload);
  });

  test('decrypts music_order.bin', async () => {
    const bytes = await load(resolve(DATATABLE_DIR, 'music_order.bin'));
    const { payload } = await openEnvelope(bytes, DATATABLE_KEY_HEX);
    const text = new TextDecoder().decode(payload);
    const parsed = JSON.parse(text);
    expect(typeof parsed).toBe('object');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // eslint-disable-next-line no-console
      console.log('music_order top-level keys:', Object.keys(parsed));
    }
  });

  test('decrypts wordlist.bin', async () => {
    const bytes = await load(resolve(DATATABLE_DIR, 'wordlist.bin'));
    const { payload } = await openEnvelope(bytes, DATATABLE_KEY_HEX);
    const text = new TextDecoder().decode(payload);
    const parsed = JSON.parse(text);
    expect(typeof parsed).toBe('object');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // eslint-disable-next-line no-console
      console.log('wordlist top-level keys:', Object.keys(parsed));
    }
  });
});

describe.skipIf(!HAS_CORPUS)('envelope against real CHN fumen files', () => {
  test('decrypts a sample fumen and dumps the first 64 bytes for inspection', async () => {
    const fumenPath = resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_e.bin');
    const bytes = await load(fumenPath);
    const { payload } = await openEnvelope(bytes, FUMEN_KEY_HEX);
    expect(payload.length).toBeGreaterThan(16);
    // eslint-disable-next-line no-console
    console.log(`fumen 10binz_e decompressed size: ${payload.length} bytes`);
    // eslint-disable-next-line no-console
    console.log('first 96 bytes hex:', [...payload.slice(0, 96)].map((b) => b.toString(16).padStart(2, '0')).join(' '));
  });

  test('fumen payload round-trip recovers byte-identical bytes', async () => {
    const fumenPath = resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_e.bin');
    const bytes = await load(fumenPath);
    const { payload, iv } = await openEnvelope(bytes, FUMEN_KEY_HEX);
    const reSealed = await sealEnvelope(payload, FUMEN_KEY_HEX, iv);
    const { payload: payload2 } = await openEnvelope(reSealed, FUMEN_KEY_HEX);
    expect(payload2).toEqual(payload);
  });
});
