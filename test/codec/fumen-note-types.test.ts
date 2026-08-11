// Phase 8.1 — note-type coverage. Proves every note-type id present in the whole
// corpus is accounted for (a named type or a documented `wii5op` special), so no
// note renders as a truly-unknown blob, and that the special set stays honest
// (exactly the corpus's unnamed ids, all structurally tap-type).

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decodeFumen } from '../../src/codec/fumen/decode';
import { openEnvelope } from '../../src/codec/envelope';
import { FUMEN_KEY_HEX } from '../helpers/keys';
import {
  DRUMROLL_NOTE_TYPES,
  FUMEN_NOTE_TYPE_NAMES,
  SPECIAL_NOTE_TYPES,
  fumenNoteTypeLabel,
  isKnownNoteType,
} from '../../src/codec/fumen/types';
import { HAS_CORPUS } from '../helpers/resources';

const REPO = resolve(__dirname, '../../..');
const FUMEN_DIR = resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen');

async function* walkBins(root: string): AsyncGenerator<string> {
  for (const ent of await readdir(root, { withFileTypes: true })) {
    const p = join(root, ent.name);
    if (ent.isDirectory()) yield* walkBins(p);
    else if (ent.isFile() && ent.name.endsWith('.bin')) yield p;
  }
}

describe('Phase 8.1 — note-type coverage', () => {
  test('helpers: labels and known-type classification', () => {
    expect(fumenNoteTypeLabel(0x1)).toBe('Don');
    expect(fumenNoteTypeLabel(0xc)).toBe('Kusudama');
    expect(fumenNoteTypeLabel(0x0e)).toBe('Special 0xe');
    expect(fumenNoteTypeLabel(0x19)).toBe('Special 0x19');
    expect(fumenNoteTypeLabel(0x99)).toBe('Unknown 0x99');

    expect(isKnownNoteType(0x1)).toBe(true);
    expect(isKnownNoteType(0x0e)).toBe(true);
    expect(isKnownNoteType(0x99)).toBe(false);

    // The special set must not overlap the named map (every id has one label).
    for (const t of SPECIAL_NOTE_TYPES) expect(FUMEN_NOTE_TYPE_NAMES[t]).toBeUndefined();
  });

  test.skipIf(!HAS_CORPUS)('every note-type id in the corpus is named or a documented special', async () => {
    const present = new Set<number>();
    const specialNonZeroDuration = new Set<number>();
    const specialWithSuffix = new Set<number>();

    for await (const file of walkBins(FUMEN_DIR)) {
      const buf = await readFile(file);
      const { payload } = await openEnvelope(
        new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
        FUMEN_KEY_HEX,
      );
      const fumen = decodeFumen(payload);
      for (const m of fumen.measures) {
        for (const br of m.branches) {
          for (const n of br.notes) {
            present.add(n.type);
            if (SPECIAL_NOTE_TYPES.has(n.type)) {
              if (n.duration !== 0) specialNonZeroDuration.add(n.type);
              if (n.drumrollSuffix) specialWithSuffix.add(n.type);
            }
          }
        }
      }
    }

    // (1) No truly-unknown id: every present type is named or a documented special.
    const unknown = [...present].filter((t) => !isKnownNoteType(t)).sort((a, b) => a - b);
    expect(unknown.map((t) => `0x${t.toString(16)}`)).toEqual([]);

    // (2) The special set is exactly the corpus's unnamed ids — no stale entries,
    //     no missing ones.
    const named = new Set(Object.keys(FUMEN_NOTE_TYPE_NAMES).map(Number));
    const presentUnnamed = [...present].filter((t) => !named.has(t)).sort((a, b) => a - b);
    expect(presentUnnamed).toEqual([...SPECIAL_NOTE_TYPES].sort((a, b) => a - b));

    // (3) Special types are structurally tap-type: duration 0, no drumroll suffix.
    expect([...specialNonZeroDuration]).toEqual([]);
    expect([...specialWithSuffix]).toEqual([]);

    // Drumroll types stay a subset of the named set (sanity on the constant).
    for (const t of DRUMROLL_NOTE_TYPES) expect(FUMEN_NOTE_TYPE_NAMES[t]).toBeDefined();
  }, 180_000);
});
