import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  BnsfMetadata,
  createNus3BankFromTemplate,
  decodeBnsfToPcm,
  encodeG719Bnsf,
  extractStreamBytes,
  parseNus3Bank,
  replaceNus3BankStream,
  selectPlayableTone,
} from '../../src/codec';
import { HAS_G719_DECODER, HAS_G719_ENCODER, loadTestG719EncoderWasm, loadTestG719Wasm } from '../helpers/g719';
import { HAS_CORPUS, RESOURCES_DIR } from '../helpers/resources';

const TEMPLATE_PATH = resolve(__dirname, '../../src/assets/song-template.nus3bank');

async function templateBytes(): Promise<Uint8Array> {
  const file = await readFile(TEMPLATE_PATH);
  return new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
}

function testPcm(samples: number): [Int16Array, Int16Array] {
  return [
    Int16Array.from({ length: samples }, (_, i) => Math.round(10_000 * Math.sin(2 * Math.PI * 440 * i / 48_000))),
    Int16Array.from({ length: samples }, (_, i) => Math.round(8_000 * Math.sin(2 * Math.PI * 660 * i / 48_000))),
  ];
}

describe.skipIf(!HAS_CORPUS || !HAS_G719_ENCODER || !HAS_G719_DECODER)('game-native G.719 sound-bank encoding', () => {
  test('writes the observed stereo BNSF/IS22 frame layout', async () => {
    const stream = await encodeG719Bnsf(testPcm(1_500), await loadTestG719EncoderWasm());
    const bankBytes = createNus3BankFromTemplate(await templateBytes(), {
      songId: 'newsng',
      uniqueId: 4321,
      demoStartMs: 1234,
      streamBytes: stream,
    });
    const bank = parseNus3Bank(bankBytes);
    const selected = selectPlayableTone(bank, 'song_newsng')!;
    const metadata = selected.stream.metadata as BnsfMetadata;

    expect(bank.warnings).toEqual([]);
    expect(selected.tone.name).toBe('song_newsng');
    expect(selected.tone.demoStartMs).toBe(1234);
    expect(metadata).toMatchObject({
      codec: 'IS22',
      channels: 2,
      sampleRate: 48_000,
      sampleCount: 1_500,
      blockSize: 640,
      blockSamples: 960,
      dataSize: 1_280,
    });
    expect(stream).toHaveLength(48 + 1_280);

    const decoded = await decodeBnsfToPcm(bankBytes, selected.stream, {
      g719Wasm: await loadTestG719Wasm(),
    });
    expect(decoded.samplesPerChannel).toBe(1_500);
    expect(decoded.channelData[0].some((sample) => sample !== 0)).toBe(true);
  });

  test('creates valid banks for song ids longer than the original six-character template', async () => {
    const stream = await encodeG719Bnsf(testPcm(960), await loadTestG719EncoderWasm());
    const bytes = createNus3BankFromTemplate(await templateBytes(), {
      songId: 'my_custom_song',
      uniqueId: 99,
      demoStartMs: 42_000,
      streamBytes: stream,
    });
    const bank = parseNus3Bank(bytes);
    expect(bank.warnings).toEqual([]);
    expect(bank.tones[0].name).toBe('song_my_custom_song');
    expect(bank.tones[0].demoStartMs).toBe(42_000);
  });

  test('replaces a stream while preserving the surrounding bank metadata', async () => {
    const firstStream = await encodeG719Bnsf(testPcm(960), await loadTestG719EncoderWasm());
    const first = createNus3BankFromTemplate(await templateBytes(), {
      songId: 'replace_me',
      uniqueId: 7,
      demoStartMs: 777,
      streamBytes: firstStream,
    });
    const replacement = await encodeG719Bnsf(testPcm(2_100), await loadTestG719EncoderWasm());
    const replaced = replaceNus3BankStream(first, replacement, 'song_replace_me');
    const bank = parseNus3Bank(replaced);
    const selected = selectPlayableTone(bank, 'song_replace_me')!;

    expect(bank.warnings).toEqual([]);
    expect(selected.tone.demoStartMs).toBe(777);
    expect(selected.tone.name).toBe('song_replace_me');
    expect(extractStreamBytes(replaced, selected.stream)).toEqual(replacement);
    expect(replaced.length - first.length).toBe(replacement.length - firstStream.length);
  });

  test.each([
    ['CHN', 'TaikoCHN/Data/x64/sound/song_589him.nus3bank', 'song_589him'],
    ['JPN', 'JPN39.06/Data/x64/sound/song_armage.nus3bank', 'song_armage'],
  ])('preserves the real %s bank shape when replacing its stream', async (_region, relative, stem) => {
    const file = await readFile(resolve(RESOURCES_DIR, relative));
    const source = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
    const before = parseNus3Bank(source);
    const beforeTone = selectPlayableTone(before, stem)!.tone;
    const stream = await encodeG719Bnsf(testPcm(960), await loadTestG719EncoderWasm());
    const replaced = replaceNus3BankStream(source, stream, stem);
    const after = parseNus3Bank(replaced);
    const afterTone = selectPlayableTone(after, stem)!.tone;

    expect(after.warnings).toEqual([]);
    expect(after.sections.map((section) => section.id)).toEqual(before.sections.map((section) => section.id));
    expect(afterTone.name).toBe(beforeTone.name);
    expect(afterTone.demoStartMs).toBe(beforeTone.demoStartMs);
    expect(afterTone.stream?.metadata).toMatchObject({
      format: 'BNSF', codec: 'IS22', channels: 2, sampleRate: 48_000,
    });
  });
});
