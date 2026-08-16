// BINF and TONE names are length-prefixed and NUL-terminated. The declared
// length includes that terminator. Our parser trims either convention, so the
// tests below also model the game's stricter read instead of relying only on an
// encode -> parse round trip.

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createNus3BankFromTemplate,
  parseNus3Bank,
  readNus3BankId,
} from '../../src/codec';
import { DUMPS, HAS_ALL_DUMPS } from '../helpers/resources';

const TEMPLATE_PATH = resolve(__dirname, '../../src/assets/song-template.nus3bank');

interface Section {
  id: string;
  offset: number;
  size: number;
}

function u32le(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function sections(bytes: Uint8Array): Section[] {
  const tocSize = u32le(bytes, 16);
  const count = u32le(bytes, 20);
  const out: Section[] = [];
  let entryOffset = 24;
  let sectionOffset = 20 + tocSize;
  for (let index = 0; index < count; index += 1) {
    const id = fourcc(bytes, entryOffset);
    const size = u32le(bytes, entryOffset + 4);
    out.push({ id, offset: sectionOffset, size });
    entryOffset += 8;
    sectionOffset += 8 + size;
  }
  return out;
}

/** Offset of `[u8 declaredLength][ASCII bytes][NUL]` in BINF. */
function binfNameOffset(bytes: Uint8Array): number {
  const binf = sections(bytes).find((section) => section.id === 'BINF');
  if (!binf) throw new Error('fixture has no BINF section');
  return binf.offset + 16;
}

/** Offset of `[u8 declaredLength][ASCII bytes][NUL]` in the first TONE. */
function toneNameOffset(bytes: Uint8Array): number {
  const tone = sections(bytes).find((section) => section.id === 'TONE');
  if (!tone) throw new Error('fixture has no TONE section');
  const payloadOffset = tone.offset + 8;
  const firstRecordOffset = payloadOffset + u32le(bytes, payloadOffset + 4);
  return firstRecordOffset + 12;
}

/**
 * Taiko.exe allocates and copies `declaredLength + 1` bytes for BINF. If the
 * terminator is not within the declared bytes, the resulting C string consumes
 * the following bank-id byte and is not reliably terminated.
 */
function gameReadsName(bytes: Uint8Array, nameOffset: number): string | undefined {
  const declaredLength = bytes[nameOffset];
  const copied = bytes.subarray(nameOffset + 1, nameOffset + 1 + declaredLength + 1);
  const nulOffset = copied.indexOf(0);
  if (nulOffset < 0) return undefined;
  return String.fromCharCode(...copied.subarray(0, nulOffset));
}

async function templateBytes(): Promise<Uint8Array> {
  const file = await readFile(TEMPLATE_PATH);
  return new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
}

async function generatedBank(songId: string, bankId = 0xfedc_ba98): Promise<Uint8Array> {
  return createNus3BankFromTemplate(await templateBytes(), {
    songId,
    uniqueId: 1_234,
    bankId,
    demoStartMs: 5_000,
    // A real codec is unnecessary for container/name tests. The parser safely
    // classifies this small opaque PACK stream as `unknown`.
    streamBytes: Uint8Array.from({ length: 64 }, (_, index) => index + 1),
  });
}

function expectCountedNul(bytes: Uint8Array, offset: number, expectedName: string): void {
  const declaredLength = bytes[offset];
  const declaredBody = bytes.subarray(offset + 1, offset + 1 + declaredLength);
  expect(declaredLength).toBe(expectedName.length + 1);
  expect(declaredBody.indexOf(0)).toBe(declaredLength - 1);
  expect(bytes[offset + declaredLength]).toBe(0);
  expect(gameReadsName(bytes, offset)).toBe(expectedName);
}

describe('nus3bank name fields', () => {
  test('the bundled template counts the NUL in both BINF and TONE', async () => {
    const template = await templateBytes();
    expectCountedNul(template, binfNameOffset(template), 'song_ABCDEF');
    expectCountedNul(template, toneNameOffset(template), 'song_ABCDEF');
  });

  test.each([
    'abcdef', // strlen % 4 === 3: the old writer had no padding byte to save it
    'abc',
    'abcd',
    'abcde',
    'abcdefg',
    'abcdefgh',
    'a_very_long_song_id',
  ])('a generated bank for %s is readable with the game copy semantics', async (songId) => {
    const bytes = await generatedBank(songId);
    const expectedName = `song_${songId}`;
    expectCountedNul(bytes, binfNameOffset(bytes), expectedName);
    expectCountedNul(bytes, toneNameOffset(bytes), expectedName);
    expect(parseNus3Bank(bytes).tones[0].name).toBe(expectedName);
  });

  test('stores and reads the complete explicit u32 bank id independently of Song No.', async () => {
    const explicitId = 0xfedc_ba98;
    const bytes = await generatedBank('abcdef', explicitId);
    const binf = sections(bytes).find((section) => section.id === 'BINF')!;
    const throughBinf = bytes.subarray(0, binf.offset + 8 + binf.size);

    expect(readNus3BankId(bytes)).toBe(explicitId);
    // The allocator reads only a small prefix, so the lightweight reader must
    // not require TONE or PACK to be present.
    expect(readNus3BankId(throughBinf)).toBe(explicitId);
  });

  test('defaults the bank id to Song No. when no explicit id is supplied', async () => {
    const bytes = createNus3BankFromTemplate(await templateBytes(), {
      songId: 'abcdef',
      uniqueId: 65_535,
      demoStartMs: 0,
      streamBytes: Uint8Array.of(1, 2, 3, 4),
    });
    expect(readNus3BankId(bytes)).toBe(65_535);
  });
});

describe.skipIf(!HAS_ALL_DUMPS)('nus3bank corpus name fields', () => {
  test.each(DUMPS)('$region song banks count the final NUL inside both declared lengths', async ({ x64 }) => {
    const soundDir = resolve(x64, 'sound');
    const names = (await readdir(soundDir))
      .filter((name) => name.startsWith('song_') && name.endsWith('.nus3bank'))
      .sort();
    expect(names.length).toBeGreaterThan(1_000);

    const offenders: string[] = [];
    for (const filename of names) {
      const file = await readFile(resolve(soundDir, filename));
      const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
      for (const [field, offset] of [
        ['BINF', binfNameOffset(bytes)],
        ['TONE', toneNameOffset(bytes)],
      ] as const) {
        const declaredLength = bytes[offset];
        const body = bytes.subarray(offset + 1, offset + 1 + declaredLength);
        if (body.indexOf(0) !== declaredLength - 1) {
          offenders.push(`${filename} ${field}: NUL at ${body.indexOf(0)}, expected ${declaredLength - 1}`);
          continue;
        }
        if (!/^song_[a-z0-9_]+$/.test(gameReadsName(bytes, offset) ?? '')) {
          offenders.push(`${filename} ${field}: game reads ${JSON.stringify(gameReadsName(bytes, offset))}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every JPN BINF name resolves to its own file stem', async () => {
    const jpn = DUMPS.find((dump) => dump.region === 'JPN');
    if (!jpn) throw new Error('JPN dump is not configured');
    const soundDir = resolve(jpn.x64, 'sound');
    const names = (await readdir(soundDir))
      .filter((name) => name.startsWith('song_') && name.endsWith('.nus3bank'));
    const mismatches: string[] = [];
    for (const filename of names) {
      const file = await readFile(resolve(soundDir, filename));
      const bytes = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
      const stem = filename.slice(0, -'.nus3bank'.length);
      if (gameReadsName(bytes, binfNameOffset(bytes)) !== stem) mismatches.push(filename);
    }
    expect(mismatches).toEqual([]);
  });
});
