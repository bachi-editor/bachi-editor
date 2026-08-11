// Pure helpers behind Ura `_x` chart create/delete (Phase 3.4): filename
// construction, slot merging with pending create/delete, and the deep-clone
// primitive that seeds a new chart from its Oni counterpart.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  cloneFumen,
  collectCreatedFumens,
  collectRemovedFumens,
  CreatedFumen,
  mergeSongSlots,
  RemovedFumenSlot,
  uraSlotForOni,
} from '../../src/model/fumenSlots';
import { fumenFilename, FumenSlot } from '../../src/fs/fumens';
import { fumenKey } from '../../src/model/fumenDrafts';
import { decodeFumen } from '../../src/codec/fumen/decode';
import { encodeFumen } from '../../src/codec/fumen/encode';
import { openEnvelope } from '../../src/codec/envelope';
import { FUMEN_KEY_HEX } from '../helpers/keys';
import { makeFumenHeader } from '../../src/codec';
import type { Fumen } from '../../src/codec';
import { HAS_CORPUS } from '../helpers/resources';

const REPO = resolve(__dirname, '../../..');

function emptyFumen(): Fumen {
  return { header: makeFumenHeader(), measures: [], trailer: new Uint8Array(0) };
}

function created(songId: string, slot: FumenSlot): [string, CreatedFumen] {
  return [fumenKey(songId, slot.filename), { songId, slot, fumen: emptyFumen() }];
}

describe('fumenFilename', () => {
  test('builds bare / 2P player suffixes per difficulty', () => {
    expect(fumenFilename('abc', 'oni', 'single')).toBe('abc_m.bin');
    expect(fumenFilename('abc', 'oni', 'p1')).toBe('abc_m_1.bin');
    expect(fumenFilename('abc', 'oni', 'p2')).toBe('abc_m_2.bin');
    expect(fumenFilename('abc', 'ura', 'single')).toBe('abc_x.bin');
    expect(fumenFilename('abc', 'easy', 'p2')).toBe('abc_e_2.bin');
  });
});

describe('uraSlotForOni', () => {
  test('mirrors the Oni slot onto the Ura `_x` filename, keeping the player', () => {
    const oniP1: FumenSlot = { difficulty: 'oni', player: 'p1', filename: 'abc_m_1.bin' };
    expect(uraSlotForOni('abc', oniP1)).toEqual({
      difficulty: 'ura',
      player: 'p1',
      filename: 'abc_x_1.bin',
    });
  });
});

describe('mergeSongSlots', () => {
  const disk: FumenSlot[] = [
    { difficulty: 'oni', player: 'single', filename: 'abc_m.bin' },
    { difficulty: 'oni', player: 'p1', filename: 'abc_m_1.bin' },
  ];

  test('adds pending-created slots and keeps display order (oni before ura)', () => {
    const createdMap = new Map([created('abc', { difficulty: 'ura', player: 'single', filename: 'abc_x.bin' })]);
    const merged = mergeSongSlots(disk, 'abc', createdMap, new Map());
    expect(merged.map((s) => s.filename)).toEqual(['abc_m.bin', 'abc_m_1.bin', 'abc_x.bin']);
  });

  test('drops pending-removed slots', () => {
    const removed = new Map<string, RemovedFumenSlot>([
      [fumenKey('abc', 'abc_m_1.bin'), { songId: 'abc', filename: 'abc_m_1.bin' }],
    ]);
    const merged = mergeSongSlots(disk, 'abc', new Map(), removed);
    expect(merged.map((s) => s.filename)).toEqual(['abc_m.bin']);
  });

  test('ignores created slots belonging to other songs', () => {
    const createdMap = new Map([created('other', { difficulty: 'ura', player: 'single', filename: 'other_x.bin' })]);
    const merged = mergeSongSlots(disk, 'abc', createdMap, new Map());
    expect(merged.map((s) => s.filename)).toEqual(['abc_m.bin', 'abc_m_1.bin']);
  });
});

describe('collect created/removed', () => {
  test('collectCreatedFumens / collectRemovedFumens produce stable, tagged rows', () => {
    const createdMap = new Map([
      created('zzz', { difficulty: 'ura', player: 'single', filename: 'zzz_x.bin' }),
      created('aaa', { difficulty: 'ura', player: 'single', filename: 'aaa_x.bin' }),
    ]);
    const rows = collectCreatedFumens(createdMap);
    expect(rows.map((r) => r.songId)).toEqual(['aaa', 'zzz']); // sorted
    expect(rows.every((r) => r.kind === 'created')).toBe(true);

    const removed = new Map<string, RemovedFumenSlot>([
      [fumenKey('aaa', 'aaa_x.bin'), { songId: 'aaa', filename: 'aaa_x.bin' }],
    ]);
    const remRows = collectRemovedFumens(removed);
    expect(remRows).toHaveLength(1);
    expect(remRows[0]).toMatchObject({ songId: 'aaa', filename: 'aaa_x.bin', kind: 'removed' });
  });
});

describe.skipIf(!HAS_CORPUS)('cloneFumen', () => {
  test('produces a byte-identical but independent copy of a real chart', async () => {
    const buf = await readFile(resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_m.bin'));
    const { payload } = await openEnvelope(
      new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
      FUMEN_KEY_HEX,
    );
    const original = decodeFumen(payload);
    const clone = cloneFumen(original);

    // Same bytes…
    expect(encodeFumen(clone)).toEqual(encodeFumen(original));
    // …but independent: editing the clone must not touch the original.
    const before = original.measures[0].branches[0].notes.length;
    clone.measures[0].branches[0].notes.push({
      type: 0x1, position: 10, item: 0, padding: 0, scoreInit: 0, scoreDiff: 0, duration: 0,
    });
    expect(original.measures[0].branches[0].notes.length).toBe(before);
  });
});
