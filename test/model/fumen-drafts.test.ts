// Unit tests for the fumen draft bookkeeping (model/fumenDrafts.ts): the map
// key, byte-level dirty detection, the semantic diff, and collectFumenDiffs.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decodeFumen } from '../../src/codec/fumen/decode';
import { openEnvelope } from '../../src/codec/envelope';
import { FUMEN_KEY_HEX } from '../helpers/keys';
import type { Fumen } from '../../src/codec';
import type { FumenSlot } from '../../src/fs/fumens';
import {
  collectFumenDiffs,
  diffFumen,
  fumenKey,
  FumenBaseline,
  isFumenDirty,
} from '../../src/model/fumenDrafts';
import { canEditMeasureDuration, setMeasureDuration } from '../../src/model/fumenEdits';
import { measureTimings } from '../../src/model/fumenTiming';
import { CHN_X64, HAS_CORPUS } from '../helpers/resources';

const FUMEN_DIR = resolve(CHN_X64, 'fumen');

async function loadChart(rel: string): Promise<Fumen> {
  const buf = await readFile(resolve(FUMEN_DIR, rel));
  const { payload } = await openEnvelope(
    new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    FUMEN_KEY_HEX,
  );
  return decodeFumen(payload);
}

const SLOT: FumenSlot = { filename: '10binz_n.bin', difficulty: 'normal', player: 'single' };

function withDon(fumen: Fumen): Fumen {
  const measures = fumen.measures.slice();
  const m = measures[0];
  const branches = m.branches.slice() as Fumen['measures'][number]['branches'];
  branches[0] = {
    ...branches[0],
    notes: [
      ...branches[0].notes,
      { type: 0x1, position: 100, item: 0, padding: 0, scoreInit: 0, scoreDiff: 0, duration: 0 },
    ],
  };
  measures[0] = { ...m, branches };
  return { ...fumen, measures };
}

describe.skipIf(!HAS_CORPUS)('fumenKey', () => {
  test('joins songId and filename', () => {
    expect(fumenKey('10binz', '10binz_n.bin')).toBe('10binz/10binz_n.bin');
  });
});

describe.skipIf(!HAS_CORPUS)('isFumenDirty', () => {
  test('a chart is not dirty against itself', async () => {
    const f = await loadChart('10binz/10binz_n.bin');
    expect(isFumenDirty(f, f)).toBe(false);
  });

  test('a structurally-different-but-byte-identical clone is not dirty', async () => {
    const f = await loadChart('10binz/10binz_n.bin');
    const clone = { ...f, measures: f.measures.slice() };
    expect(clone).not.toBe(f);
    expect(isFumenDirty(f, clone)).toBe(false);
  });

  test('adding a note makes it dirty', async () => {
    const f = await loadChart('10binz/10binz_n.bin');
    expect(isFumenDirty(f, withDon(f))).toBe(true);
  });
});

describe.skipIf(!HAS_CORPUS)('diffFumen', () => {
  test('reports the note-count delta and a positive byte delta', async () => {
    const base = await loadChart('10binz/10binz_n.bin');
    const draft = withDon(base);
    const fd = diffFumen('10binz', SLOT, base, draft);
    expect(fd.dirty).toBe(true);
    expect(fd.key).toBe('10binz/10binz_n.bin');
    expect(fd.byteDelta).toBe(24); // one extra 24-byte note record
    const notes = fd.changes.find((c) => c.label === 'notes');
    expect(notes).toBeDefined();
    expect(Number(notes!.to) - Number(notes!.from)).toBe(1);
  });

  test('unchanged chart is reported clean with no changes', async () => {
    const base = await loadChart('10binz/10binz_n.bin');
    const fd = diffFumen('10binz', SLOT, base, base);
    expect(fd.dirty).toBe(false);
    expect(fd.changes).toHaveLength(0);
    expect(fd.byteDelta).toBe(0);
  });

  test('summarizes a measure-duration edit as a length + downstream-offset change', async () => {
    const base = await loadChart('10binz/10binz_n.bin');
    const mi = base.measures.findIndex((_m, i) => canEditMeasureDuration(base, i).ok);
    const dur = measureTimings(base).durations[mi];
    const draft = setMeasureDuration(base, mi, dur + 500).fumen;

    const fd = diffFumen('10binz', SLOT, base, draft);
    expect(fd.dirty).toBe(true);
    const len = fd.changes.find((c) => c.label === `measure ${mi + 1} length`);
    expect(len).toBeDefined();
    expect(len!.to).toMatch(/beats$/);
    const downstream = fd.changes.find((c) => c.label === 'downstream offsets');
    expect(downstream).toBeDefined();
    expect(downstream!.to).toMatch(/^\+\d+ measures$/);
  });
});

describe.skipIf(!HAS_CORPUS)('collectFumenDiffs', () => {
  test('returns only dirty slots, sorted, skipping draft-less and baseline-less keys', async () => {
    const base = await loadChart('10binz/10binz_n.bin');
    const key = fumenKey('10binz', SLOT.filename);
    const baselines = new Map<string, FumenBaseline>([
      [key, { songId: '10binz', slot: SLOT, fumen: base, bytes: new Uint8Array() }],
    ]);

    // draft equal to baseline → not collected
    const cleanDrafts = new Map<string, Fumen>([[key, { ...base, measures: base.measures.slice() }]]);
    expect(collectFumenDiffs(baselines, cleanDrafts)).toHaveLength(0);

    // edited draft → collected
    const dirtyDrafts = new Map<string, Fumen>([[key, withDon(base)]]);
    const got = collectFumenDiffs(baselines, dirtyDrafts);
    expect(got).toHaveLength(1);
    expect(got[0].key).toBe(key);

    // a draft with no recorded baseline is ignored (can't diff it)
    const orphan = new Map<string, Fumen>([['ghost/ghost_n.bin', withDon(base)]]);
    expect(collectFumenDiffs(baselines, orphan)).toHaveLength(0);
  });
});
