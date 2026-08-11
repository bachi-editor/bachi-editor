// Foundation for authoring a chart from scratch — see NEW_SONG_PLAN.md.
// Proves blank charts encode byte-clean and that the derived header (dummyData +
// soul gauge) stays consistent as notes are stamped/added.

import { describe, expect, test } from 'vitest';
import { decodeFumen, encodeFumen, verifyEncoderSelfConsistent, computeScoreCeiling } from '../../src/codec';
import { timingWindowsForDifficulty } from '../../src/codec/fumen/authoring';
import type { Fumen, FumenNote } from '../../src/codec';
import {
  blankFumenSlotSet,
  chartScoringOrDefault,
  makeBlankFumen,
  makeBlankMeasure,
  readChartScoring,
  refreshChartDerivedHeader,
  stampChartScoring,
  tapNoteCount,
  withScoreCeiling,
  DEFAULT_CHART_SCORING,
  DEFAULT_SCORE_BASE,
  DEFAULT_SCORE_DIFF,
} from '../../src/model/fumenScaffold';

const HP_CLEAR = { easy: 6000, normal: 7000, hard: 7000, oni: 8000, ura: 8000 } as const;

function tap(position: number): FumenNote {
  return { type: 0x1, position, item: 0, padding: 0, scoreInit: 0, scoreDiff: 0, duration: 0 };
}
function balloon(position: number, hits: number): FumenNote {
  return { type: 0xa, position, item: 0, padding: 0, scoreInit: hits, scoreDiff: 0, duration: 500 };
}
function drumroll(position: number): FumenNote {
  return { type: 0x6, position, item: 0, padding: 0, scoreInit: 0, scoreDiff: 0, duration: 800 };
}
/** Put notes on the flat (branch 0) track of measure 0. */
function withNotes(fumen: Fumen, notes: FumenNote[]): Fumen {
  const measures = fumen.measures.slice();
  const m0 = measures[0];
  const branches = m0.branches.slice() as Fumen['measures'][0]['branches'];
  branches[0] = { ...branches[0], notes };
  measures[0] = { ...m0, branches };
  return { ...fumen, measures };
}

describe('fumen scaffold', () => {
  test('makeBlankMeasure is empty and reserved-clean', () => {
    const m = makeBlankMeasure(150);
    expect(m.bpm).toBe(150);
    expect(m.barline).toBe(1);
    expect(m.gogo).toBe(0);
    expect(m.padding1).toBe(0);
    expect(m.padding2).toBe(0);
    expect(m.branchInfo).toEqual([-1, -1, -1, -1, -1, -1]);
    expect(m.branches).toHaveLength(3);
    for (const b of m.branches) {
      expect(b.notes).toHaveLength(0);
      expect(b.speed).toBe(1);
      expect(b.padding).toBe(0);
    }
  });

  test('makeBlankFumen: correct difficulty fields and byte-clean round-trip', () => {
    for (const d of ['easy', 'normal', 'hard', 'oni', 'ura'] as const) {
      const fumen = makeBlankFumen(d, { bpm: 180, measureCount: 4 });
      expect(fumen.measures).toHaveLength(4);
      expect(fumen.header.measureCount).toBe(4);
      expect(fumen.header.timingWindows).toEqual(timingWindowsForDifficulty(d));
      expect(fumen.header.hpMax).toBe(10000);
      expect(fumen.header.hpClear).toBe(HP_CLEAR[d]);
      expect(fumen.header.unknownData).toBe(0);
      expect(fumen.header.dummyData).toBe(0); // no notes yet
      expect(fumen.header.hasBranches).toBe(0);

      // Encodes and decodes byte-identically (the round-trip contract).
      const bytes = encodeFumen(fumen);
      const back = encodeFumen(decodeFumen(bytes));
      expect(back).toEqual(bytes);
      expect(verifyEncoderSelfConsistent(fumen).ok).toBe(true);
    }
  });

  test('stampChartScoring writes uniform base/diff; balloons keep their count', () => {
    const chart = withNotes(makeBlankFumen('oni'), [tap(0), tap(100), balloon(200, 7), drumroll(300)]);
    const stamped = stampChartScoring(chart, { base: 500, diff: 300 });
    const notes = stamped.measures[0].branches[0].notes;
    expect(notes[0]).toMatchObject({ type: 0x1, scoreInit: 500, scoreDiff: 300 });
    expect(notes[1]).toMatchObject({ type: 0x1, scoreInit: 500, scoreDiff: 300 });
    // balloon: hit count preserved in scoreInit, no diff
    expect(notes[2]).toMatchObject({ type: 0xa, scoreInit: 7, scoreDiff: 0 });
    // drumroll: stamped exactly like a tap, as the corpus does
    expect(notes[3]).toMatchObject({ type: 0x6, scoreInit: 500, scoreDiff: 300 });
    // input untouched
    expect(chart.measures[0].branches[0].notes[0].scoreInit).toBe(0);
  });

  test('tapNoteCount excludes balloons and drumrolls', () => {
    const chart = withNotes(makeBlankFumen('oni'), [tap(0), tap(50), balloon(100, 5)]);
    expect(tapNoteCount(chart)).toBe(2);
  });

  test('withScoreCeiling matches computeScoreCeiling and the manual formula', () => {
    // 12 taps, base 500 diff 300: combo 1..9 add base; combo 10..12 add base+diff*1.
    const notes = Array.from({ length: 12 }, (_v, i) => tap(i * 40));
    const chart = stampChartScoring(withNotes(makeBlankFumen('oni'), notes), { base: 500, diff: 300 });
    const expected = 12 * 500 + 3 * (300 * 1); // notes 10,11,12 → tier 1
    const synced = withScoreCeiling(chart);
    expect(synced.header.dummyData).toBe(expected);
    expect(synced.header.dummyData).toBe(computeScoreCeiling(chart));
  });

  test('refreshChartDerivedHeader stamps, syncs dummyData, and scales the gauge', () => {
    const notes = Array.from({ length: 50 }, (_v, i) => tap(i * 20));
    const chart = withNotes(makeBlankFumen('oni', { measureCount: 2 }), notes);
    const refreshed = refreshChartDerivedHeader(chart, 'oni', DEFAULT_CHART_SCORING);

    expect(refreshed.header.dummyData).toBe(computeScoreCeiling(refreshed));
    expect(refreshed.header.dummyData).toBeGreaterThan(0);
    // gauge scaled to 50 taps: all-good overfills past the clear norma
    expect(refreshed.header.hpGainGood).toBeGreaterThan(0);
    expect(refreshed.header.hpGainGood * 50).toBeGreaterThan(refreshed.header.hpClear);
    expect(refreshed.header.hpGainOk).toBeLessThan(refreshed.header.hpGainGood); // oni ≈ half
    expect(refreshed.header.measureCount).toBe(2);
    expect(verifyEncoderSelfConsistent(refreshed).ok).toBe(true);

    // The star rating reaches the gauge: a 10★ Oni fills over more notes than a 5★.
    const rated10 = refreshChartDerivedHeader(chart, 'oni', DEFAULT_CHART_SCORING, 10);
    const rated5 = refreshChartDerivedHeader(chart, 'oni', DEFAULT_CHART_SCORING, 5);
    expect(rated10.header.hpGainGood).toBeLessThan(rated5.header.hpGainGood);
  });

  test('blankFumenSlotSet builds all three player variants', () => {
    const set = blankFumenSlotSet('newsng', 'oni');
    expect(set.map((c) => c.slot.player)).toEqual(['single', 'p1', 'p2']);
    expect(set.map((c) => c.slot.filename)).toEqual(['newsng_m.bin', 'newsng_m_1.bin', 'newsng_m_2.bin']);
    for (const c of set) {
      expect(c.songId).toBe('newsng');
      expect(c.slot.difficulty).toBe('oni');
      expect(verifyEncoderSelfConsistent(c.fumen).ok).toBe(true);
    }
  });

  test('readChartScoring reads the chart-wide base/step; chartScoringOrDefault fills defaults', () => {
    const blank = makeBlankFumen('oni');
    expect(readChartScoring(blank)).toEqual({ base: undefined, step: undefined });
    expect(chartScoringOrDefault(blank)).toEqual({ base: DEFAULT_SCORE_BASE, diff: DEFAULT_SCORE_DIFF });

    // Balloons carry a hit count in scoreInit, not the base — they must be skipped.
    const stamped = stampChartScoring(withNotes(makeBlankFumen('oni'), [tap(0), balloon(50, 5)]), { base: 640, diff: 720 });
    expect(readChartScoring(stamped)).toEqual({ base: 640, step: 720 });
    expect(chartScoringOrDefault(stamped)).toEqual({ base: 640, diff: 720 });
  });

  test('a fresh 0-value note inherits the chart base/step on refresh (not the default)', () => {
    const base = stampChartScoring(withNotes(makeBlankFumen('oni'), [tap(0), tap(100)]), { base: 640, diff: 720 });
    // Add a note carrying the makeNote default (0/0), as note placement would.
    const withFresh = withNotes(base, [...base.measures[0].branches[0].notes, tap(200)]);
    // The store refreshes with the chart's OWN scoring (read off the pre-edit chart).
    const refreshed = refreshChartDerivedHeader(withFresh, 'oni', chartScoringOrDefault(base));
    const notes = refreshed.measures[0].branches[0].notes;
    expect(notes.every((n) => n.scoreInit === 640 && n.scoreDiff === 720)).toBe(true);
    expect(readChartScoring(refreshed)).toEqual({ base: 640, step: 720 });
    // ceiling recomputes from the chart's base/step: 3 taps, all tier 0 → 3 × 640.
    expect(refreshed.header.dummyData).toBe(3 * 640);
  });
});
