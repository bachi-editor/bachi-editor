import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  BnsfMetadata,
  decideNus3Decoder,
  decodeDspAdpcmChannel,
  decodeIdspToPcm,
  extractStreamBytes,
  getBnsfFrameLayout,
  getBnsfFrameRange,
  getIdspChannelDataRange,
  getIdspDataLayout,
  IdspMetadata,
  IdspChannelHeader,
  isNus3BankBytes,
  Nus3ParseError,
  patchNus3BankDemoStartMs,
  parseNus3Bank,
  readNus3BankDemoStartMs,
  RiffWaveMetadata,
  selectPlayableTone,
} from '../../src/codec';
import { CHN_X64, HAS_CORPUS } from '../helpers/resources';

const SOUND_DIR = resolve(CHN_X64, 'sound');
const EXPECTED_SECTIONS = ['PROP', 'BINF', 'GRP ', 'DTON', 'TONE', 'JUNK', 'PACK'];

async function loadBank(name: string) {
  const bytes = await loadBytes(name);
  return parseNus3Bank(bytes);
}

async function loadBytes(name: string) {
  const buf = await readFile(resolve(SOUND_DIR, name));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function writeU32le(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function writeAscii(bytes: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i);
}

function makeSyntheticBank(
  sections: Array<{ tocId: string; size: number; sectionId?: string; actualSize?: number; payload?: Uint8Array }>,
): Uint8Array {
  const tocSize = 4 + sections.length * 8;
  const tocEnd = 20 + tocSize;
  const bodySize = sections.reduce((sum, section) => sum + 8 + (section.payload?.byteLength ?? section.size), 0);
  const bytes = new Uint8Array(tocEnd + bodySize);
  writeAscii(bytes, 0, 'NUS3');
  writeU32le(bytes, 4, bytes.byteLength - 8);
  writeAscii(bytes, 8, 'BANKTOC ');
  writeU32le(bytes, 16, tocSize);
  writeU32le(bytes, 20, sections.length);

  sections.forEach((section, index) => {
    const entryOffset = 24 + index * 8;
    writeAscii(bytes, entryOffset, section.tocId);
    writeU32le(bytes, entryOffset + 4, section.size);
  });

  let sectionOffset = tocEnd;
  for (const section of sections) {
    writeAscii(bytes, sectionOffset, section.sectionId ?? section.tocId);
    writeU32le(bytes, sectionOffset + 4, section.actualSize ?? section.size);
    const payloadLength = section.payload?.byteLength ?? section.size;
    if (section.payload) bytes.set(section.payload, sectionOffset + 8);
    sectionOffset += 8 + payloadLength;
  }
  return bytes;
}

function toneDescriptorBase(bytes: Uint8Array, recordOffset: number): number {
  const nameLength = bytes[recordOffset + 12];
  return 12 + ((1 + nameLength + 3) & ~3);
}

function testDspHeader(coefficients = Array.from({ length: 16 }, () => 0)): IdspChannelHeader {
  return {
    index: 0,
    headerOffset: 0,
    sampleCount: 0,
    nibbleCount: 0,
    sampleRate: 48_000,
    loopFlag: 0,
    format: 0,
    loopStartNibble: 0,
    loopEndNibble: 0,
    currentAddress: 0,
    coefficients,
    gain: 0,
    initialPredictorScale: 0,
    initialHistory1: 0,
    initialHistory2: 0,
    loopPredictorScale: 0,
    loopHistory1: 0,
    loopHistory2: 0,
  };
}

describe('nus3bank parser', () => {
  test.skipIf(!HAS_CORPUS)('parses a normal BNSF song bank', async () => {
    const bank = await loadBank('song_kumatm.nus3bank');
    expect(bank.warnings).toEqual([]);
    expect(bank.sections.map((s) => s.id)).toEqual(EXPECTED_SECTIONS);
    expect(bank.tones).toHaveLength(1);
    expect(bank.tones[0].toneId).toBe(0);
    expect(bank.tones[0].name).toBe('song_kumatm');
    expect(bank.tones[0].stream?.magic).toBe('BNSF');
    const metadata = bank.tones[0].stream?.metadata as BnsfMetadata;
    expect(metadata).toMatchObject({
      format: 'BNSF',
      codec: 'IS22',
      formatChunk: 'sfmt',
      flags: 0,
      channels: 2,
      sampleRate: 48_000,
      blockSize: 640,
      blockSamples: 960,
      dataChunk: 'sdat',
    });
    expect(metadata.dataOffset).toBe(bank.tones[0].stream!.absoluteOffset + 0x30);
    expect(metadata.sampleCount).toBeGreaterThan(0);
  });

  test.skipIf(!HAS_CORPUS)('parses the minority IDSP song shape', async () => {
    const bank = await loadBank('song_i7poli.nus3bank');
    expect(bank.tones).toHaveLength(1);
    expect(bank.tones[0].stream?.magic).toBe('IDSP');
    const metadata = bank.tones[0].stream?.metadata as IdspMetadata;
    expect(metadata).toMatchObject({
      format: 'IDSP',
      channels: 2,
      sampleRate: 44_100,
      channelHeaderSize: 0x60,
      channelDataSize: 0x2520d0,
    });
    expect(metadata.channelHeaderOffset).toBe(bank.tones[0].stream!.absoluteOffset + 0x40);
    expect(metadata.dataOffset).toBe(bank.tones[0].stream!.absoluteOffset + 0x100);
    expect(metadata.channelHeaders).toHaveLength(2);
    expect(metadata.channelHeaders?.[0].coefficients).toHaveLength(16);
    expect(metadata.sampleCount).toBeGreaterThan(0);
  });

  test.skipIf(!HAS_CORPUS)('parses a large BNSF song bank', async () => {
    const bank = await loadBank('song_tmap4.nus3bank');
    expect(bank.byteLength).toBeGreaterThan(9_000_000);
    expect(bank.tones).toHaveLength(1);
    expect(bank.tones[0].stream?.magic).toBe('BNSF');
    const metadata = bank.tones[0].stream?.metadata as BnsfMetadata;
    expect(metadata.channels).toBe(2);
    expect(metadata.sampleRate).toBe(48_000);
    expect(metadata.sampleCount).toBeGreaterThan(9_000_000);
  });

  test.skipIf(!HAS_CORPUS)('locates song demo-start metadata across observed TONE record shapes', async () => {
    expect(readNus3BankDemoStartMs(await loadBytes('song_rockxx.nus3bank'), 'song_rockxx')).toBe(6395);
    expect(readNus3BankDemoStartMs(await loadBytes('song_tmap4.nus3bank'), 'song_tmap4')).toBe(0);
    expect(readNus3BankDemoStartMs(await loadBytes('song_3dsop.nus3bank'), 'song_3dsop')).toBe(70426);
    expect(readNus3BankDemoStartMs(await loadBytes('song_10binz.nus3bank'), 'song_10binz')).toBe(23374);
    expect(readNus3BankDemoStartMs(await loadBytes('song_kumatm.nus3bank'), 'song_kumatm')).toBe(71843);
  });

  test.skipIf(!HAS_CORPUS)('patches song demo-start metadata without moving the stream payload', async () => {
    const bytes = await loadBytes('song_10binz.nus3bank');
    const before = parseNus3Bank(bytes);
    const beforeSelection = selectPlayableTone(before, 'song_10binz')!;
    const patched = patchNus3BankDemoStartMs(bytes, 'song_10binz', 12345);
    const after = parseNus3Bank(patched);
    const afterSelection = selectPlayableTone(after, 'song_10binz')!;

    expect(afterSelection.tone.demoStartMs).toBe(12345);
    expect(afterSelection.stream.absoluteOffset).toBe(beforeSelection.stream.absoluteOffset);
    expect(afterSelection.stream.size).toBe(beforeSelection.stream.size);
    expect(extractStreamBytes(patched, afterSelection.stream)).toEqual(extractStreamBytes(bytes, beforeSelection.stream));
  });

  test.skipIf(!HAS_CORPUS)('parses non-song RIFF tone banks', async () => {
    const bank = await loadBank('se_neiro_00_v12a.nus3bank');
    expect(bank.tones).toHaveLength(6);
    expect(bank.tones.map((t) => t.stream?.magic)).toEqual(['RIFF', 'RIFF', 'RIFF', 'RIFF', 'RIFF', 'RIFF']);
    const metadata = bank.tones[0].stream?.metadata as RiffWaveMetadata;
    expect(metadata).toMatchObject({
      format: 'RIFF',
      waveFormat: 1,
      channels: 1,
      sampleRate: 48_000,
      bitsPerSample: 16,
    });
  });

  test.skipIf(!HAS_CORPUS)('keeps non-audio TONE records as noStreamReason', async () => {
    const bank = await loadBank('se_common_v12a.nus3bank');
    expect(bank.tones).toHaveLength(54);
    expect(bank.tones.filter((t) => t.stream)).toHaveLength(52);
    expect(bank.tones.filter((t) => t.noStreamReason)).toHaveLength(2);
  });

  test.skipIf(!HAS_CORPUS)('rejects out-of-bounds PACK references', async () => {
    const bytes = (await loadBytes('song_kumatm.nus3bank')).slice();
    const bank = parseNus3Bank(bytes);
    const tone = bank.tones[0];
    const descriptorBase = toneDescriptorBase(bytes, tone.recordOffset);
    writeU32le(bytes, tone.recordOffset + descriptorBase + 12, 0xffff_ffff);
    expect(() => parseNus3Bank(bytes)).toThrow(Nus3ParseError);
    expect(() => parseNus3Bank(bytes)).toThrow(/exceeds PACK size/);
  });

  test('rejects malformed synthetic BANKTOC and section bounds', () => {
    const shortToc = new Uint8Array(24);
    writeAscii(shortToc, 0, 'NUS3');
    writeU32le(shortToc, 4, shortToc.byteLength - 8);
    writeAscii(shortToc, 8, 'BANKTOC ');
    writeU32le(shortToc, 16, 4);
    writeU32le(shortToc, 20, 1);
    expect(() => parseNus3Bank(shortToc)).toThrow(/BANKTOC table too small/);

    const truncatedSection = makeSyntheticBank([{ tocId: 'JUNK', size: 4, payload: new Uint8Array(0) }]);
    expect(() => parseNus3Bank(truncatedSection)).toThrow(/section JUNK: range/);

    const mismatchedSection = makeSyntheticBank([{ tocId: 'JUNK', sectionId: 'PACK', size: 0 }]);
    expect(() => parseNus3Bank(mismatchedSection)).toThrow(/expected JUNK, found PACK/);
  });

  test('rejects a synthetic TONE table that overruns its section', () => {
    const tonePayload = new Uint8Array(4);
    writeU32le(tonePayload, 0, 1);
    const bytes = makeSyntheticBank([{ tocId: 'TONE', size: tonePayload.byteLength, payload: tonePayload }]);
    expect(() => parseNus3Bank(bytes)).toThrow(/TONE record table/);
  });

  // The Sound tab's single import button routes on this: NUS3 magic means copy
  // the bank in place, anything else goes through the audio-conversion pipeline.
  test.skipIf(!HAS_CORPUS)('sniffs the NUS3 magic without parsing structure', async () => {
    const bank = await loadBytes('song_kumatm.nus3bank');
    expect(isNus3BankBytes(bank)).toBe(true);
    expect(isNus3BankBytes(bank.subarray(0, 4))).toBe(true);

    expect(isNus3BankBytes(new Uint8Array([0x4f, 0x67, 0x67, 0x53]))).toBe(false); // OggS
    expect(isNus3BankBytes(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe(false); // RIFF
    expect(isNus3BankBytes(new Uint8Array([0x49, 0x44, 0x33]))).toBe(false); // ID3, short
    expect(isNus3BankBytes(new Uint8Array(0))).toBe(false);
  });
});

describe.skipIf(!HAS_CORPUS)('nus3bank tone selection', () => {
  test('selects the exact song stem and exposes stream bytes', async () => {
    const bytes = await loadBytes('song_kumatm.nus3bank');
    const bank = parseNus3Bank(bytes);
    const selected = selectPlayableTone(bank, 'song_kumatm');
    expect(selected?.reason).toBe('name-match');
    expect(selected?.ambiguous).toBe(false);
    expect(selected?.tone.name).toBe('song_kumatm');
    const streamBytes = extractStreamBytes(bytes, selected!.stream);
    expect(String.fromCharCode(...streamBytes.subarray(0, 4))).toBe('BNSF');
  });

  test('uses largest stream when a non-song bank has multiple playable tones', async () => {
    const bank = await loadBank('bgm_common_v12a.nus3bank');
    const selected = selectPlayableTone(bank);
    expect(selected?.reason).toBe('largest-stream');
    expect(selected?.ambiguous).toBe(true);
    expect(selected?.tone.name).toBe('title_v12a');
    expect(selected?.alternates.map((tone) => tone.name)).toContain('gameover_primal');
  });

  test('name match beats largest-stream fallback in multi-tone banks', async () => {
    const bank = await loadBank('se_neiro_00_v12a.nus3bank');
    const selected = selectPlayableTone(bank, 'katsu_c');
    expect(selected?.reason).toBe('name-match');
    expect(selected?.ambiguous).toBe(true);
    expect(selected?.tone.name).toBe('katsu_c');
    expect(selected?.stream.magic).toBe('RIFF');
  });

  test('returns undefined when no supported stream kind is allowed', async () => {
    const bank = await loadBank('song_kumatm.nus3bank');
    expect(selectPlayableTone(bank, 'song_kumatm', ['idsp'])).toBeUndefined();
  });
});

describe.skipIf(!HAS_CORPUS)('nus3bank decoder decision gate', () => {
  test('classifies BNSF/IS22 as supported via a supplied G.719 wasm decoder', async () => {
    const bank = await loadBank('song_kumatm.nus3bank');
    const selected = selectPlayableTone(bank, 'song_kumatm');
    expect(decideNus3Decoder(selected!.stream)).toMatchObject({
      readiness: 'ready',
      decoder: 'g719-wasm',
      codec: 'BNSF/IS22 (G.719/Siren22)',
    });
  });

  test('classifies IDSP as ready via the TypeScript DSP-ADPCM decoder', async () => {
    const bank = await loadBank('song_i7poli.nus3bank');
    const selected = selectPlayableTone(bank, 'song_i7poli');
    expect(decideNus3Decoder(selected!.stream)).toMatchObject({
      readiness: 'ready',
      decoder: 'idsp-typescript',
      codec: 'IDSP (Nintendo DSP-ADPCM)',
    });
  });

  test('classifies RIFF as browser-native once the audio service exists', async () => {
    const bank = await loadBank('se_neiro_00_v12a.nus3bank');
    const selected = selectPlayableTone(bank, 'don_c');
    expect(decideNus3Decoder(selected!.stream)).toMatchObject({
      readiness: 'browser-native',
      decoder: 'browser-native',
      codec: 'RIFF',
    });
  });
});

describe.skipIf(!HAS_CORPUS)('BNSF frame layout', () => {
  test('maps interleaved G.719 frames by block and channel', async () => {
    const bytes = await loadBytes('song_kumatm.nus3bank');
    const bank = parseNus3Bank(bytes);
    const selected = selectPlayableTone(bank, 'song_kumatm');
    const layout = getBnsfFrameLayout(selected!.stream);
    expect(layout).toMatchObject({
      codec: 'IS22',
      channels: 2,
      sampleRate: 48_000,
      blockSize: 640,
      blockSamples: 960,
      frameSizePerChannel: 320,
    });
    expect(layout.blockCount).toBe(layout.dataSize / layout.blockSize);
    expect(layout.durationSeconds).toBeCloseTo(147.23, 2);
    expect(getBnsfFrameRange(layout, 0, 0)).toEqual({ offset: layout.dataOffset, size: 320 });
    expect(getBnsfFrameRange(layout, 0, 1)).toEqual({ offset: layout.dataOffset + 320, size: 320 });
    expect(getBnsfFrameRange(layout, 1, 0)).toEqual({ offset: layout.dataOffset + 640, size: 320 });
  });

  test('rejects invalid frame indexes', async () => {
    const bank = await loadBank('song_kumatm.nus3bank');
    const selected = selectPlayableTone(bank, 'song_kumatm');
    const layout = getBnsfFrameLayout(selected!.stream);
    expect(() => getBnsfFrameRange(layout, -1, 0)).toThrow(RangeError);
    expect(() => getBnsfFrameRange(layout, 0, 2)).toThrow(RangeError);
  });
});

describe.skipIf(!HAS_CORPUS)('IDSP data layout', () => {
  test('maps per-channel DSP headers and data ranges', async () => {
    const bank = await loadBank('song_i7poli.nus3bank');
    const selected = selectPlayableTone(bank, 'song_i7poli');
    const layout = getIdspDataLayout(selected!.stream);
    expect(layout).toMatchObject({
      channels: 2,
      sampleRate: 44_100,
      sampleCount: 4_258_152,
      channelHeaderSize: 0x60,
      channelDataSize: 0x2520d0,
    });
    expect(layout.durationSeconds).toBeCloseTo(96.56, 2);
    expect(getIdspChannelDataRange(layout, 0)).toEqual({ offset: layout.dataOffset, size: 0x2520d0 });
    expect(getIdspChannelDataRange(layout, 1)).toEqual({ offset: layout.dataOffset + 0x2520d0, size: 0x2520d0 });
  });

  test('rejects invalid IDSP channel indexes', async () => {
    const bank = await loadBank('song_i7poli.nus3bank');
    const selected = selectPlayableTone(bank, 'song_i7poli');
    const layout = getIdspDataLayout(selected!.stream);
    expect(() => getIdspChannelDataRange(layout, -1)).toThrow(RangeError);
    expect(() => getIdspChannelDataRange(layout, 2)).toThrow(RangeError);
  });
});

describe('IDSP DSP-ADPCM decode', () => {
  test('decodes silent DSP frames', () => {
    const pcm = decodeDspAdpcmChannel(new Uint8Array(8), testDspHeader(), 14);
    expect([...pcm]).toEqual(Array.from({ length: 14 }, () => 0));
  });

  test('decodes signed nibbles with zero predictor coefficients', () => {
    const frame = new Uint8Array([0x00, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x11]);
    const pcm = decodeDspAdpcmChannel(frame, testDspHeader(), 14);
    expect([...pcm]).toEqual(Array.from({ length: 14 }, () => 1));
  });

  test.skipIf(!HAS_CORPUS)('partially decodes a real IDSP song to planar Float32 PCM', async () => {
    const bytes = await loadBytes('song_i7poli.nus3bank');
    const bank = parseNus3Bank(bytes);
    const selected = selectPlayableTone(bank, 'song_i7poli');
    const pcm = decodeIdspToPcm(bytes, selected!.stream, { maxSamples: 28 });
    expect(pcm).toMatchObject({
      sampleRate: 44_100,
      channels: 2,
      samplesPerChannel: 28,
    });
    expect(pcm.channelData).toHaveLength(2);
    expect([...pcm.channelData[0]]).toEqual(Array.from({ length: 28 }, () => 0));
    expect(pcm.channelData[1].some((sample) => Number.isFinite(sample))).toBe(true);
  });
});

// Census of the CHN sound corpus. The absolute counts below are a baseline that
// has to be re-stated whenever the dump gains songs; the ratios that hold for
// *every* file are expressed against `files.length` instead, so an ordinary
// added song only moves one number.
test.skipIf(!HAS_CORPUS)('CHN sound corpus shape is documented', async () => {
  const files = (await readdir(SOUND_DIR)).filter((name) => name.endsWith('.nus3bank')).sort();
  expect(files).toHaveLength(1121);

  const sectionShapes = new Map<string, number>();
  const toneCounts = new Map<number, number>();
  const allStreams = new Map<string, number>();
  const songStreams = new Map<string, number>();
  const songDecoderPaths = new Map<string, number>();
  let bnsfLayouts = 0;
  let idspLayouts = 0;
  let songFiles = 0;
  let noStreamRecords = 0;
  const sizeWarningFiles: string[] = [];

  for (const file of files) {
    const bank = await loadBank(file);
    if (bank.warnings.length > 0) sizeWarningFiles.push(file);
    const sectionShape = bank.sections.map((s) => s.id).join(',');
    sectionShapes.set(sectionShape, (sectionShapes.get(sectionShape) ?? 0) + 1);
    toneCounts.set(bank.tones.length, (toneCounts.get(bank.tones.length) ?? 0) + 1);

    const isSong = file.startsWith('song_');
    if (isSong) {
      songFiles++;
      expect(bank.tones, file).toHaveLength(1);
      expect(bank.tones[0].stream, file).toBeDefined();
      const selected = selectPlayableTone(bank, file.slice(0, -'.nus3bank'.length));
      expect(selected, file).toBeDefined();
      const decision = decideNus3Decoder(selected!.stream);
      songDecoderPaths.set(decision.decoder, (songDecoderPaths.get(decision.decoder) ?? 0) + 1);
    }

    for (const tone of bank.tones) {
      if (!tone.stream) {
        noStreamRecords++;
        continue;
      }
      allStreams.set(tone.stream.magic, (allStreams.get(tone.stream.magic) ?? 0) + 1);
      if (isSong) songStreams.set(tone.stream.magic, (songStreams.get(tone.stream.magic) ?? 0) + 1);
      if (tone.stream.kind === 'bnsf') {
        const layout = getBnsfFrameLayout(tone.stream);
        expect(layout.blockSamples, file).toBe(960);
        expect(layout.dataSize % layout.blockSize, file).toBe(0);
        bnsfLayouts++;
      } else if (tone.stream.kind === 'idsp') {
        const layout = getIdspDataLayout(tone.stream);
        expect(layout.channels, file).toBe(2);
        expect(layout.channelHeaderSize, file).toBe(0x60);
        expect(layout.channelDataSize * layout.channels + (layout.dataOffset - tone.stream.absoluteOffset), file)
          .toBe(tone.stream.size);
        const pcm = decodeIdspToPcm(await loadBytes(file), tone.stream, { maxSamples: 14 });
        expect(pcm.channelData, file).toHaveLength(2);
        expect(pcm.channelData[0], file).toHaveLength(14);
        idspLayouts++;
      }
    }
  }

  expect(songFiles).toBe(1044);
  expect(sizeWarningFiles).toEqual([
    'song_i7poli.nus3bank',
    'song_kamias.nus3bank',
    'song_krseib.nus3bank',
    'song_pr9del.nus3bank',
    'song_pr9trp.nus3bank',
    'song_umamop.nus3bank',
  ]);
  // Every file in the corpus, without exception, carries the same section list.
  expect([...sectionShapes.entries()]).toEqual([[EXPECTED_SECTIONS.join(','), files.length]]);
  expect([...toneCounts.entries()].sort((a, b) => a[0] - b[0])).toEqual([
    [1, 1072],
    [2, 5],
    [3, 2],
    [4, 1],
    [5, 1],
    [6, 21],
    [7, 6],
    [9, 1],
    [11, 1],
    [14, 1],
    [16, 2],
    [17, 1],
    [18, 1],
    [26, 1],
    [36, 1],
    [48, 1],
    [54, 2],
    [168, 1],
  ]);
  expect(noStreamRecords).toBe(20);
  expect([...allStreams.entries()].sort()).toEqual([
    ['BNSF', 1601],
    ['IDSP', 7],
    ['RIFF', 124],
  ]);
  expect(bnsfLayouts).toBe(1601);
  expect(idspLayouts).toBe(7);
  // Every song bank decodes through one of the two playback paths, so these two
  // partition the song files rather than standing on their own.
  expect([...songStreams.entries()].sort()).toEqual([
    ['BNSF', songFiles - 7],
    ['IDSP', 7],
  ]);
  expect([...songDecoderPaths.entries()].sort()).toEqual([
    ['g719-wasm', songFiles - 7],
    ['idsp-typescript', 7],
  ]);
}, 120_000);
