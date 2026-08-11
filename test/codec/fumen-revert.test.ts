// Phase 7.1 — edit→revert byte-equality (the safety contract).
//
// The operator's guarantee: open a chart, edit it, undo the edits, save — and
// the saved plaintext is byte-identical to the original. This file proves the
// transform layer is a clean inverse at the byte level: applying an edit and
// then its inverse re-encodes to the exact on-disk plaintext, and isFumenDirty
// correctly reports "no change". (The store/undo path is covered in 7.2; the
// "unchanged charts are never written" save invariant in 7.3.)

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decodeFumen } from '../../src/codec/fumen/decode';
import { encodeFumen } from '../../src/codec/fumen/encode';
import { openEnvelope } from '../../src/codec/envelope';
import { FUMEN_KEY_HEX } from '../helpers/keys';
import { isFumenDirty } from '../../src/model/fumenDrafts';
import {
  canEditMeasureDuration,
  getChartNote,
  insertChartNote,
  measureDurationMs,
  removeChartNote,
  setMeasureBpmOverride,
  setMeasureDuration,
  setMeasureGogo,
  updateChartNote,
} from '../../src/model/fumenEdits';
import { measureTimings } from '../../src/model/fumenTiming';
import { cloneFumen } from '../../src/model/fumenSlots';
import type { Fumen } from '../../src/codec';
import { HAS_CORPUS } from '../helpers/resources';

const REPO = resolve(__dirname, '../../..');
const FUMEN_DIR = resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen');

async function loadChart(rel: string): Promise<{ payload: Uint8Array; fumen: Fumen }> {
  const buf = await readFile(resolve(FUMEN_DIR, rel));
  const { payload } = await openEnvelope(
    new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    FUMEN_KEY_HEX,
  );
  return { payload, fumen: decodeFumen(payload) };
}

function byteDiffOffset(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** Assert a reverted chart re-encodes to the exact original plaintext. */
function expectByteIdentical(original: Uint8Array, reverted: Fumen): void {
  const got = encodeFumen(reverted);
  expect(byteDiffOffset(got, original)).toBe(-1);
}

/** A measure index + branch whose notes are already in (position,type) order, so
 *  an insert's re-sort is a no-op on the existing notes and add+remove is a true
 *  inverse. Returns the first branch-0 measure that has notes and is sorted. */
function firstSortedNoteMeasure(fumen: Fumen): number {
  for (let i = 0; i < fumen.measures.length; i++) {
    const notes = fumen.measures[i].branches[0].notes;
    if (notes.length === 0) continue;
    let sorted = true;
    for (let j = 1; j < notes.length; j++) {
      const a = notes[j - 1];
      const b = notes[j];
      if (a.position > b.position + 1e-4 || (Math.abs(a.position - b.position) <= 1e-4 && a.type > b.type)) {
        sorted = false;
        break;
      }
    }
    if (sorted) return i;
  }
  return -1;
}

/** A position inside the measure not occupied by any existing branch-0 note. */
function freePosition(fumen: Fumen, mi: number): number {
  const measure = fumen.measures[mi];
  const dur = measureDurationMs(measure);
  const taken = new Set(measure.branches[0].notes.map((n) => Math.round(n.position)));
  for (let frac = 1; frac < 16; frac++) {
    const pos = (dur * frac) / 16 + 0.137;
    if (!taken.has(Math.round(pos))) return pos;
  }
  return dur / 2 + 0.137;
}

const CHART = '10binz/10binz_m.bin';

describe.skipIf(!HAS_CORPUS)('Phase 7.1 — edit then revert is byte-perfect', () => {
  test('decoded baseline re-encodes to its on-disk plaintext', async () => {
    const { payload, fumen } = await loadChart(CHART);
    expectByteIdentical(payload, fumen);
  });

  test('note add + delete restores the original bytes', async () => {
    const { payload, fumen } = await loadChart(CHART);
    const mi = firstSortedNoteMeasure(fumen);
    expect(mi).toBeGreaterThanOrEqual(0);
    const ins = insertChartNote(fumen, {
      measureIndex: mi,
      branchIndex: 0,
      position: freePosition(fumen, mi),
      tool: 'don',
    });
    expect(isFumenDirty(fumen, ins.fumen)).toBe(true);
    expect(ins.selection).toBeDefined();

    const rev = removeChartNote(ins.fumen, ins.selection!);
    expect(isFumenDirty(fumen, rev.fumen)).toBe(false);
    expectByteIdentical(payload, rev.fumen);
  });

  test('note move (position) and move back restores the original bytes', async () => {
    const { payload, fumen } = await loadChart(CHART);
    const mi = firstSortedNoteMeasure(fumen);
    const ref = { measureIndex: mi, branchIndex: 0 as const, noteIndex: 0 };
    const original = getChartNote(fumen, ref)!;
    const newPos = freePosition(fumen, mi);

    const moved = updateChartNote(fumen, ref, { position: newPos });
    expect(isFumenDirty(fumen, moved.fumen)).toBe(true);

    const back = updateChartNote(moved.fumen, moved.selection!, { position: original.position });
    expect(isFumenDirty(fumen, back.fumen)).toBe(false);
    expectByteIdentical(payload, back.fumen);
  });

  test('big upgrade + downgrade restores the original bytes', async () => {
    const { payload, fumen } = await loadChart(CHART);
    const mi = firstSortedNoteMeasure(fumen);
    // Find a small Don/Ka note to up/downgrade.
    const notes = fumen.measures[mi].branches[0].notes;
    const idx = notes.findIndex((n) => n.type === 0x1 || n.type === 0x4);
    expect(idx).toBeGreaterThanOrEqual(0);
    const ref = { measureIndex: mi, branchIndex: 0 as const, noteIndex: idx };
    const smallType = notes[idx].type;
    const bigType = smallType === 0x1 ? 0x7 : 0x8;

    const up = updateChartNote(fumen, ref, { type: bigType });
    expect(isFumenDirty(fumen, up.fumen)).toBe(true);

    const down = updateChartNote(up.fumen, up.selection!, { type: smallType });
    expect(isFumenDirty(fumen, down.fumen)).toBe(false);
    expectByteIdentical(payload, down.fumen);
  });

  test('measure BPM edit + revert restores the original bytes', async () => {
    const { payload, fumen } = await loadChart(CHART);
    const originalBpm = fumen.measures[0].bpm;

    const edited = setMeasureBpmOverride(fumen, 0, true, originalBpm + 13);
    expect(isFumenDirty(fumen, edited.fumen)).toBe(true);

    const reverted = setMeasureBpmOverride(edited.fumen, 0, true, originalBpm);
    expect(isFumenDirty(fumen, reverted.fumen)).toBe(false);
    expectByteIdentical(payload, reverted.fumen);
  });

  test('measure GO-GO toggle + revert restores the original bytes', async () => {
    const { payload, fumen } = await loadChart(CHART);
    const originalGogo = fumen.measures[0].gogo;

    const edited = setMeasureGogo(fumen, 0, !originalGogo);
    expect(isFumenDirty(fumen, edited.fumen)).toBe(true);

    const reverted = setMeasureGogo(edited.fumen, 0, !!originalGogo);
    expect(isFumenDirty(fumen, reverted.fumen)).toBe(false);
    expectByteIdentical(payload, reverted.fumen);
  });

  test('measure duration edit + revert restores the original bytes (Phase 12)', async () => {
    const { payload, fumen } = await loadChart(CHART);
    // First non-last measure of a derived chart whose length is editable.
    const mi = fumen.measures.findIndex((_m, i) => canEditMeasureDuration(fumen, i).ok);
    expect(mi).toBeGreaterThanOrEqual(0);
    const originalDur = measureTimings(fumen).durations[mi];

    // Grow by 250 ms (never overflows existing notes), then set it back exactly.
    const edited = setMeasureDuration(fumen, mi, originalDur + 250);
    expect(isFumenDirty(fumen, edited.fumen)).toBe(true);

    const reverted = setMeasureDuration(edited.fumen, mi, originalDur);
    expect(isFumenDirty(fumen, reverted.fumen)).toBe(false);
    expectByteIdentical(payload, reverted.fumen);
  });

  test('a cloned chart (Ura create seed) is byte-identical to its source', async () => {
    const { payload, fumen } = await loadChart(CHART);
    // createUraChart clones the Oni slot via cloneFumen; the created file must equal the
    // source byte-for-byte (and deleting it before save leaves nothing behind).
    const clone = cloneFumen(fumen);
    expect(clone).not.toBe(fumen); // independent copy
    expect(isFumenDirty(fumen, clone)).toBe(false);
    expectByteIdentical(payload, clone);
  });
});
