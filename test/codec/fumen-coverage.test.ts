// Phase 8.6 — 100%-data coverage assertion (the acceptance gate).
//
// Proves that for every corpus fumen payload, *every byte* belongs to either a
// typed field or a documented-constant reserved region — i.e. no byte lands in an
// undocumented opaque slice. This is stronger than the Phase 0 round-trip (which
// only proves bytes are *preserved*, not that they are *understood*): here a second,
// independent parser re-walks each payload, classifies every byte into a named
// category, and asserts:
//
//   (1) the categories tile the whole payload with no gap and no leftover
//       (final cursor === payload.length ⇒ no opaque trailing blob), and
//   (2) every byte in a `*-reserved` region is actually zero on disk (so calling
//       those regions "reserved padding" is true, not a place we silently drop data).
//
// The walker is deliberately independent of decode.ts / encode.ts so the test is a
// real second opinion, not a restatement of the codec. It is cross-checked against
// the real decoder (measure count + total size) per file.
//
// See codec/fumen/spec.md "Reserved fields — confirmed always zero".

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decodeFumen, fumenEncodedSize } from '../../src/codec/fumen/decode';
import {
  DRUMROLL_NOTE_TYPES,
  FUMEN_DRUMROLL_SUFFIX_SIZE,
  FUMEN_HEADER_SIZE,
} from '../../src/codec/fumen/types';
import { encodeFumen } from '../../src/codec/fumen/encode';
import { makeFumenHeader } from '../../src/codec/fumen/header';
import { openEnvelope } from '../../src/codec/envelope';
import { FUMEN_KEY_HEX } from '../helpers/keys';
import { CHN_X64, HAS_CORPUS } from '../helpers/resources';

const FUMEN_DIR = resolve(CHN_X64, 'fumen');

type Category =
  | 'header' // 520-byte typed FumenHeader (proven byte-perfect in Phase 8.4)
  | 'measureTyped' // bpm, offset, gogo, barline, branchInfo[6]
  | 'measureReserved' // padding1 (u16), padding2 (i32)
  | 'branchTyped' // totalNotes (u16), speed (f32)
  | 'branchReserved' // padding (u16)
  | 'noteTyped' // type, position, item, scoreInit, scoreDiff, duration
  | 'noteReserved' // padding (f32)
  | 'drumrollReserved'; // 8-byte drumroll suffix

const RESERVED: ReadonlySet<Category> = new Set<Category>([
  'measureReserved',
  'branchReserved',
  'noteReserved',
  'drumrollReserved',
]);

interface Coverage {
  /** Final cursor; must equal payload.length for full coverage. */
  end: number;
  /** Total bytes classified per category. */
  byCategory: Record<Category, number>;
  /** Bytes in a reserved region whose on-disk value is non-zero (must be 0). */
  nonZeroReservedBytes: number;
  /** Measures the walker found (cross-checked against the real decoder). */
  measureCount: number;
}

function newByCategory(): Record<Category, number> {
  return {
    header: 0,
    measureTyped: 0,
    measureReserved: 0,
    branchTyped: 0,
    branchReserved: 0,
    noteTyped: 0,
    noteReserved: 0,
    drumrollReserved: 0,
  };
}

/**
 * Independent second parser. Walks `payload` with its own cursor, attributing
 * every byte to a category. Reads structural counts (measureCount, per-branch
 * note count, note type) straight from the bytes — it never calls decodeFumen.
 */
function walkCoverage(payload: Uint8Array): Coverage {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const byCategory = newByCategory();
  let pos = 0;
  let nonZeroReservedBytes = 0;

  function take(cat: Category, n: number): void {
    if (pos + n > payload.length) {
      throw new Error(`coverage walk overran payload at pos ${pos} (+${n} > ${payload.length})`);
    }
    if (RESERVED.has(cat)) {
      for (let i = 0; i < n; i++) if (payload[pos + i] !== 0) nonZeroReservedBytes++;
    }
    byCategory[cat] += n;
    pos += n;
  }

  // Header: 520 typed bytes. measureCount lives at byte 512 (u32 LE).
  const measureCount = view.getUint32(512, true);
  take('header', FUMEN_HEADER_SIZE);

  for (let m = 0; m < measureCount; m++) {
    take('measureTyped', 4 + 4 + 1 + 1); // bpm, offset, gogo, barline
    take('measureReserved', 2); // padding1
    take('measureTyped', 24); // branchInfo[6]
    take('measureReserved', 4); // padding2
    for (let b = 0; b < 3; b++) {
      const totalNotes = view.getUint16(pos, true);
      take('branchTyped', 2); // totalNotes
      take('branchReserved', 2); // padding
      take('branchTyped', 4); // speed
      for (let n = 0; n < totalNotes; n++) {
        const type = view.getInt32(pos, true);
        take('noteTyped', 4); // type
        take('noteTyped', 4); // position
        take('noteTyped', 4); // item
        take('noteReserved', 4); // padding (f32)
        take('noteTyped', 2); // scoreInit
        take('noteTyped', 2); // scoreDiff
        take('noteTyped', 4); // duration
        if (DRUMROLL_NOTE_TYPES.has(type)) take('drumrollReserved', FUMEN_DRUMROLL_SUFFIX_SIZE);
      }
    }
  }

  return { end: pos, byCategory, nonZeroReservedBytes, measureCount };
}

async function* walkBins(root: string): AsyncGenerator<string> {
  for (const ent of await readdir(root, { withFileTypes: true })) {
    const p = join(root, ent.name);
    if (ent.isDirectory()) yield* walkBins(p);
    else if (ent.isFile() && ent.name.endsWith('.bin')) yield p;
  }
}

async function payloadOf(p: string): Promise<Uint8Array> {
  const buf = await readFile(p);
  const { payload } = await openEnvelope(
    new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    FUMEN_KEY_HEX,
  );
  return payload;
}

describe('Phase 8.6 — fumen byte-coverage', () => {
  test('the coverage walker has teeth (planted defects are caught)', () => {
    // A minimal, valid two-measure chart: one tap note + one drumroll, so the
    // walk exercises the note + drumroll-suffix paths.
    const clean = encodeFumen({
      header: makeFumenHeader({ measureCount: 1 }),
      measures: [
        {
          bpm: 120,
          offset: 0,
          gogo: 0,
          barline: 1,
          padding1: 0,
          branchInfo: [-1, -1, -1, -1, -1, -1],
          padding2: 0,
          branches: [
            {
              padding: 0,
              speed: 1,
              notes: [
                { type: 0x1, position: 0, item: 0, padding: 0, scoreInit: 1000, scoreDiff: 0, duration: 0 },
                {
                  type: 0x6,
                  position: 100,
                  item: 0,
                  padding: 0,
                  scoreInit: 0,
                  scoreDiff: 0,
                  duration: 500,
                  drumrollSuffix: new Uint8Array(FUMEN_DRUMROLL_SUFFIX_SIZE),
                },
              ],
            },
            { padding: 0, speed: 1, notes: [] },
            { padding: 0, speed: 1, notes: [] },
          ],
        },
      ],
      trailer: new Uint8Array(0),
    });

    const ok = walkCoverage(clean);
    expect(ok.end).toBe(clean.length);
    expect(ok.nonZeroReservedBytes).toBe(0);
    expect(ok.byCategory.drumrollReserved).toBe(FUMEN_DRUMROLL_SUFFIX_SIZE);

    // Defect 1: a non-zero byte in a reserved region (measure padding2 @ header+36).
    const dirtyReserved = clean.slice();
    dirtyReserved[FUMEN_HEADER_SIZE + 36] = 0xff;
    expect(walkCoverage(dirtyReserved).nonZeroReservedBytes).toBeGreaterThan(0);

    // Defect 2: an extra trailing byte (an undocumented opaque slice) is detected
    // as leftover — the cursor no longer reaches the end of the payload.
    const withTrailer = new Uint8Array(clean.length + 1);
    withTrailer.set(clean, 0);
    expect(walkCoverage(withTrailer).end).toBe(clean.length);
    expect(walkCoverage(withTrailer).end).not.toBe(withTrailer.length);
  });

  test.skipIf(!HAS_CORPUS)('every corpus payload is 100% typed-or-documented-reserved bytes', async () => {
    const all: string[] = [];
    for await (const p of walkBins(FUMEN_DIR)) all.push(p);
    all.sort();
    expect(all.length).toBeGreaterThan(10000);

    let totalBytes = 0;
    let reservedBytes = 0;
    let typedBytes = 0;
    let nonZeroReserved = 0;
    const coverageFailures: string[] = [];
    const nonZeroReservedFiles: string[] = [];

    for (const file of all) {
      const payload = await payloadOf(file);
      const cov = walkCoverage(payload);

      // (1) The categories tile the whole payload — no gap, no opaque leftover.
      const sum = Object.values(cov.byCategory).reduce((a, b) => a + b, 0);
      if (cov.end !== payload.length || sum !== payload.length) {
        if (coverageFailures.length < 8) {
          coverageFailures.push(`${relative(FUMEN_DIR, file)}: end=${cov.end} sum=${sum} len=${payload.length}`);
        }
      }

      // (2) Reserved regions are genuinely zero on disk.
      if (cov.nonZeroReservedBytes > 0 && nonZeroReservedFiles.length < 8) {
        nonZeroReservedFiles.push(`${relative(FUMEN_DIR, file)} (${cov.nonZeroReservedBytes}B)`);
      }
      nonZeroReserved += cov.nonZeroReservedBytes;

      // (3) Cross-check the independent walk against the real decoder.
      const fumen = decodeFumen(payload);
      expect(cov.measureCount).toBe(fumen.measures.length);
      expect(cov.end).toBe(fumenEncodedSize(fumen));

      totalBytes += payload.length;
      reservedBytes +=
        cov.byCategory.measureReserved +
        cov.byCategory.branchReserved +
        cov.byCategory.noteReserved +
        cov.byCategory.drumrollReserved;
      typedBytes +=
        cov.byCategory.header +
        cov.byCategory.measureTyped +
        cov.byCategory.branchTyped +
        cov.byCategory.noteTyped;
    }

    console.log(
      `\nFumen byte coverage over ${all.length} files: ${totalBytes} bytes` +
        ` = ${typedBytes} typed + ${reservedBytes} reserved (0 opaque).`,
    );

    expect({ coverageFailures, nonZeroReservedFiles }).toEqual({
      coverageFailures: [],
      nonZeroReservedFiles: [],
    });
    expect(nonZeroReserved).toBe(0);
    expect(typedBytes + reservedBytes).toBe(totalBytes);
  }, 300_000);
});
