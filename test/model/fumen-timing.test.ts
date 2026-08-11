import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  decodeFumen,
  makeFumenHeader,
  openEnvelope,
  type Fumen,
  type FumenBranch,
  type FumenMeasure,
} from '../../src/codec';
import { FUMEN_KEY_HEX } from '../helpers/keys';
import {
  beatMs,
  chartIntroDelayMs,
  measureDurationAt,
  measureTimings,
  synthesizeOffsets,
} from '../../src/model/fumenTiming';

const REPO = resolve(__dirname, '../../..');
const FUMEN_DIR = resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen');

async function loadChart(rel: string): Promise<Fumen> {
  const buf = await readFile(resolve(FUMEN_DIR, rel));
  const { payload } = await openEnvelope(
    new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
    FUMEN_KEY_HEX,
  );
  return decodeFumen(payload);
}

function branch(): FumenBranch {
  return { padding: 0, speed: 1, notes: [] };
}

function measure(offset: number, bpm = 120): FumenMeasure {
  return {
    bpm,
    offset,
    gogo: 0,
    barline: 1,
    padding1: 0,
    branchInfo: [0, 0, 0, 0, 0, 0],
    padding2: 0,
    branches: [branch(), branch(), branch()],
  };
}

function fumen(measures: FumenMeasure[]): Fumen {
  return {
    header: makeFumenHeader({ measureCount: measures.length }),
    measures,
    trailer: new Uint8Array(),
  };
}

describe('fumen timing map', () => {
  test('derives constant-BPM durations, starts, and sources from consecutive offsets', () => {
    const chart = fumen([
      measure(0),
      measure(1500),
      measure(3000),
      measure(4000),
    ]);

    const timing = measureTimings(chart);

    expect(timing.derived).toBe(true);
    expect(timing.durations).toEqual([1500, 1500, 1000, 2000]);
    expect(timing.starts).toEqual([0, 1500, 3000, 4000]);
    expect(timing.sources).toEqual(['offset', 'offset', 'offset', 'fallback']);
    expect(timing.totalDurationMs).toBe(6000);
    expect(measureDurationAt(chart, 2)).toBe(1000);
  });

  test('falls back to nominal BPM timing when the offset column is unusable', () => {
    const timing = measureTimings(fumen([measure(0), measure(0)]));

    expect(timing.derived).toBe(false);
    expect(timing.durations).toEqual([2000, 2000]);
    expect(timing.starts).toEqual([0, 2000]);
    expect(timing.sources).toEqual(['fallback', 'fallback']);
  });

  test('undoes the stored-offset BPM-change bias at boundaries', () => {
    const timing = measureTimings(fumen([
      measure(0, 120),
      measure(3000, 240),
      measure(3500, 240),
    ]));

    expect(timing.durations).toEqual([2000, 500, 1000]);
    expect(timing.starts).toEqual([0, 2000, 2500]);
  });

  test('locks doncam short gimmick measures to their real 0.25/0.75 beat lengths', async () => {
    const timing = measureTimings(await loadChart('doncam/doncam_m.bin'));

    expect(timing.durations[0]).toBeCloseTo(125, 3);
    expect(timing.durations[1]).toBeCloseTo(375, 3);
    expect(timing.sources[0]).toBe('offset');
  });

  test('locks butou6 pickup timing and first-downbeat audio delay', async () => {
    const chart = await loadChart('butou6/butou6_m.bin');
    const timing = measureTimings(chart);

    expect(timing.durations[0]).toBeCloseTo(416.667, 2);
    expect(timing.durations[1]).toBeCloseTo(1666.668, 2);
    expect(timing.starts[1]).toBeCloseTo(timing.durations[0], 3);
    expect(chartIntroDelayMs(chart)).toBeCloseTo(1948, 0);
  });

  test('locks clsdnu waltz measures as three-beat spans with a two-beat break', async () => {
    const chart = await loadChart('clsdnu/clsdnu_m.bin');
    const timing = measureTimings(chart);
    const firstBeat = beatMs(chart.measures[0].bpm);

    expect(timing.durations[0]).toBeCloseTo(857.142, 2);
    expect(timing.durations[0] / firstBeat).toBeCloseTo(3, 3);
    expect(timing.durations[8]).toBeCloseTo(571.428, 2);
    expect(timing.durations[8] / firstBeat).toBeCloseTo(2, 3);
  });

  test('returns zero intro delay and duration for an empty chart', () => {
    const chart = fumen([]);
    expect(chartIntroDelayMs(chart)).toBe(0);
    expect(measureDurationAt(chart, 0)).toBe(0);
  });
});

describe('synthesizeOffsets (Phase 12.2 inverse)', () => {
  test('round-trips with measureTimings on a BPM-change chart', () => {
    const chart = fumen([
      measure(0, 120),
      measure(3000, 240),
      measure(3500, 240),
      measure(4000, 180),
    ]);
    const timing = measureTimings(chart);
    const bpms = chart.measures.map((m) => m.bpm);

    const offsets = synthesizeOffsets(timing.durations, bpms, chart.measures[0].offset);

    // Re-deriving from the synthesized column reproduces the same durations
    // (the final measure has no boundary, so only non-final durations are fixed).
    const rebuilt = fumen(offsets.map((o, i) => measure(o, bpms[i])));
    const rebuiltTiming = measureTimings(rebuilt);
    for (let i = 0; i < chart.measures.length - 1; i++) {
      expect(rebuiltTiming.durations[i]).toBeCloseTo(timing.durations[i], 6);
    }
    // The anchor (chart/audio offset) is preserved exactly.
    expect(offsets[0]).toBe(chart.measures[0].offset);
  });

  test('reproduces the stored offset column of a real corpus chart', async () => {
    const chart = await loadChart('doncam/doncam_m.bin');
    const timing = measureTimings(chart);
    const bpms = chart.measures.map((m) => m.bpm);

    const offsets = synthesizeOffsets(timing.durations, bpms, chart.measures[0].offset);

    // The official tools used the same bias model, so synthesis recovers the
    // disk offsets to within float-32 epsilon.
    for (let i = 0; i < chart.measures.length; i++) {
      expect(offsets[i]).toBeCloseTo(chart.measures[i].offset, 1);
    }
  });

  test('returns an empty column for an empty chart', () => {
    expect(synthesizeOffsets([], [], 0)).toEqual([]);
  });
});
