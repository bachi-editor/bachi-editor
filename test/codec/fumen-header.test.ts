// Phase 8.4 — typed fumen header. Proves the 520-byte header decodes into a
// typed FumenHeader and re-encodes byte-perfectly across the whole corpus (the
// round-trip contract), and cross-checks the field mapping against tja2fumen's
// FumenHeader using values the rest of the chart independently determines
// (measureCount). See codec/fumen/spec.md for the byte layout.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decodeFumen } from '../../src/codec/fumen/decode';
import {
  decodeHeader,
  encodeHeader,
  makeFumenHeader,
} from '../../src/codec/fumen/header';
import { FUMEN_HEADER_SIZE, FUMEN_TIMING_WINDOW_COUNT } from '../../src/codec/fumen/types';
import { openEnvelope } from '../../src/codec/envelope';
import { FUMEN_KEY_HEX } from '../helpers/keys';

const REPO = resolve(__dirname, '../../..');
const FUMEN_DIR = resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen');

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

describe('Phase 8.4 — typed fumen header', () => {
  test('decodeHeader / encodeHeader round-trips a synthetic header', () => {
    const h = makeFumenHeader({ measureCount: 42, hasBranches: 1, hpClear: 7000 });
    const bytes = encodeHeader(h);
    expect(bytes.length).toBe(FUMEN_HEADER_SIZE);
    expect(decodeHeader(bytes)).toEqual(h);

    // Field offsets land where tja2fumen says (sample a few i32 fields).
    const view = new DataView(bytes.buffer);
    expect(view.getInt32(432, true)).toBe(1); // hasBranches
    expect(view.getInt32(436, true)).toBe(10000); // hpMax
    expect(view.getInt32(440, true)).toBe(7000); // hpClear
    expect(view.getInt32(456, true)).toBe(65536); // normalNormalRatio
    expect(view.getInt32(512, true)).toBe(42); // measureCount
  });

  test('encodeHeader rejects a wrong-length timing-window array', () => {
    const h = makeFumenHeader();
    h.timingWindows = [1, 2, 3];
    expect(() => encodeHeader(h)).toThrow(/timingWindows must be/);
  });

  test('decodeHeader rejects a too-small buffer', () => {
    expect(() => decodeHeader(new Uint8Array(FUMEN_HEADER_SIZE - 1))).toThrow(/too small/);
  });

  test('every corpus header round-trips byte-perfect and maps cleanly', async () => {
    const all: string[] = [];
    for await (const p of walkBins(FUMEN_DIR)) all.push(p);
    all.sort();
    expect(all.length).toBeGreaterThan(10000);

    let mismatches = 0;
    const examples: string[] = [];
    for (const file of all) {
      const payload = await payloadOf(file);
      const fumen = decodeFumen(payload);
      const h = fumen.header;

      // (1) byte-perfect re-encode of the header region.
      const reencoded = encodeHeader(h);
      let eq = reencoded.length === FUMEN_HEADER_SIZE;
      if (eq) {
        for (let b = 0; b < FUMEN_HEADER_SIZE; b++) {
          if (reencoded[b] !== payload[b]) {
            eq = false;
            break;
          }
        }
      }
      if (!eq) {
        mismatches++;
        if (examples.length < 8) examples.push(relative(FUMEN_DIR, file));
      }

      // (2) typed-field sanity that the layout is right, not random bytes.
      expect(h.timingWindows.length).toBe(FUMEN_TIMING_WINDOW_COUNT);
      expect(h.measureCount).toBe(fumen.measures.length); // byte 512 drives decode
      expect(h.hasBranches === 0 || h.hasBranches === 1).toBe(true);
      expect(h.hpMax).toBe(10000); // constant across the CHN corpus
      expect(h.normalNormalRatio).toBe(65536); // constant across the CHN corpus
      expect(h.unknownData).toBe(0); // constant across the CHN corpus
    }
    expect({ mismatches, examples }).toEqual({ mismatches: 0, examples: [] });
  }, 300_000);
});
