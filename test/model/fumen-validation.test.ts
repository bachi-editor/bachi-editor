// Unit tests for the chart invariants (model/fumenValidation.ts, PLAN 3.7):
// notes inside their measure, long notes with a positive length, balloons with a
// hit count, sane BPM — and that only *dirty* charts are validated.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decodeFumen } from '../../src/codec/fumen/decode';
import { openEnvelope } from '../../src/codec/envelope';
import { FUMEN_KEY_HEX } from '../helpers/keys';
import { makeFumenHeader } from '../../src/codec';
import type { Fumen, FumenBranch, FumenMeasure, FumenNote } from '../../src/codec';
import type { FumenSlot } from '../../src/fs/fumens';
import { fumenKey, type FumenBaseline } from '../../src/model/fumenDrafts';
import { validateDirtyFumens, validateFumenChart } from '../../src/model/fumenValidation';
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

function note(over: Partial<FumenNote> = {}): FumenNote {
  return { type: 0x1, position: 100, item: 0, padding: 0, scoreInit: 0, scoreDiff: 0, duration: 0, ...over };
}

function branch(notes: FumenNote[], speed = 1): FumenBranch {
  return { padding: 0, speed, notes };
}

function measure(bpm: number, notes: FumenNote[], speed = 1, offset = 0): FumenMeasure {
  return {
    bpm,
    offset,
    gogo: 0,
    barline: 1,
    padding1: 0,
    branchInfo: [0, 0, 0, 0, 0, 0],
    padding2: 0,
    branches: [branch(notes, speed), branch([], speed), branch([], speed)],
  };
}

function chart(measures: FumenMeasure[]): Fumen {
  return { header: makeFumenHeader({ measureCount: measures.length }), measures, trailer: new Uint8Array() };
}

const LABEL = 'fumen/test/test_m.bin';
const errorsOf = (issues: { level: string }[]) => issues.filter((i) => i.level === 'error');

describe('validateFumenChart', () => {
  test.skipIf(!HAS_CORPUS)('a real corpus chart has no errors', async () => {
    const f = await loadChart('10binz/10binz_n.bin');
    expect(errorsOf(validateFumenChart(LABEL, f))).toHaveLength(0);
  });

  test('a note past the end of its measure is an error', () => {
    // bpm 120 → measure is 2000ms; a note at 3000ms is outside.
    const issues = validateFumenChart(LABEL, chart([measure(120, [note({ position: 3000 })])]));
    expect(errorsOf(issues)).toHaveLength(1);
    expect(issues[0].message).toMatch(/outside the measure/);
  });

  test('note bounds use offset-derived short measure durations', () => {
    // The first measure is 500 ms long by offset, even though 120 BPM's nominal
    // four-beat fallback would be 2000 ms. A note at 1200 ms must be rejected.
    const issues = validateFumenChart(
      LABEL,
      chart([
        measure(120, [note({ position: 1200 })], 1, 0),
        measure(120, [], 1, 500),
        measure(120, [], 1, 2500),
      ]),
    );
    expect(errorsOf(issues)).toHaveLength(1);
    expect(issues[0].message).toMatch(/0.*500ms/);
  });

  test('a negative note position is an error', () => {
    const issues = validateFumenChart(LABEL, chart([measure(120, [note({ position: -50 })])]));
    expect(errorsOf(issues)).toHaveLength(1);
  });

  test('a roll extending past the measure end is allowed (only the head is bounded)', () => {
    // type 0x6 drumroll at position 1500 with a 1000ms tail spills past 2000ms — legal.
    const issues = validateFumenChart(
      LABEL,
      chart([measure(120, [note({ type: 0x6, position: 1500, duration: 1000 })])]),
    );
    expect(errorsOf(issues)).toHaveLength(0);
  });

  test('a long note with zero duration is an error', () => {
    const issues = validateFumenChart(LABEL, chart([measure(120, [note({ type: 0x6, duration: 0 })])]));
    expect(errorsOf(issues)).toHaveLength(1);
    expect(issues[0].message).toMatch(/no length/);
  });

  test('a balloon with a zero hit count is an error', () => {
    const issues = validateFumenChart(
      LABEL,
      chart([measure(120, [note({ type: 0xa, position: 100, duration: 500, scoreInit: 0 })])]),
    );
    // both "no count" fires; ensure at least the balloon-count error is present.
    expect(issues.some((i) => /hit count/.test(i.message))).toBe(true);
  });

  test('a valid balloon passes', () => {
    const issues = validateFumenChart(
      LABEL,
      chart([measure(120, [note({ type: 0xa, position: 100, duration: 500, scoreInit: 8 })])]),
    );
    expect(errorsOf(issues)).toHaveLength(0);
  });

  test('a non-positive BPM is an error', () => {
    const issues = validateFumenChart(LABEL, chart([measure(0, [note()])]));
    expect(errorsOf(issues)).toHaveLength(1);
    expect(issues[0].message).toMatch(/invalid BPM/);
  });

  test('an extreme BPM is a (non-blocking) warning', () => {
    const issues = validateFumenChart(LABEL, chart([measure(5000, [note({ position: 10 })])]));
    expect(errorsOf(issues)).toHaveLength(0);
    expect(issues.some((i) => i.level === 'warn' && /extreme/.test(i.message))).toBe(true);
  });
});

describe.skipIf(!HAS_CORPUS)('validateDirtyFumens', () => {
  const SLOT: FumenSlot = { filename: 'test_m.bin', difficulty: 'oni', player: 'single' };
  const KEY = fumenKey('test', SLOT.filename);

  test('only validates charts whose draft differs from baseline', () => {
    const clean = chart([measure(120, [note()])]);
    const baselines = new Map<string, FumenBaseline>([
      [KEY, { songId: 'test', slot: SLOT, fumen: clean, bytes: new Uint8Array() }],
    ]);

    // Draft equals baseline content → skipped even though we pass a structural copy.
    const noopDrafts = new Map<string, Fumen>([[KEY, { ...clean, measures: clean.measures.slice() }]]);
    expect(validateDirtyFumens(baselines, noopDrafts)).toHaveLength(0);

    // Draft edited into a broken state → validated and flagged.
    const brokenDrafts = new Map<string, Fumen>([
      [KEY, chart([measure(120, [note({ position: 9999 })])])],
    ]);
    const issues = validateDirtyFumens(baselines, brokenDrafts);
    expect(errorsOf(issues).length).toBeGreaterThan(0);
    expect(issues[0].message).toContain('fumen/test/test_m.bin');
  });

  test('a draft with no baseline is ignored', () => {
    const baselines = new Map<string, FumenBaseline>();
    const drafts = new Map<string, Fumen>([[KEY, chart([measure(120, [note({ position: 9999 })])])]]);
    expect(validateDirtyFumens(baselines, drafts)).toHaveLength(0);
  });
});
