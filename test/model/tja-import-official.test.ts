import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decodeFumen, decodeJsonPayload } from '../../src/codec';
import { openEnvelope } from '../../src/codec/envelope';
import type { Fumen, MusicInfoFile } from '../../src/codec';
import { readChartScoring } from '../../src/model/fumenScaffold';
import { measureTimings } from '../../src/model/fumenTiming';
import { convertTjaForImport, decodeTjaBytes, shinutiPatch } from '../../src/model/tjaImport';
import { SHINUCHI_ABSENT } from '../../src/model/shinuchi';
import { DATATABLE_KEY_HEX, FUMEN_KEY_HEX } from '../helpers/keys';
import { CHN_X64, HAS_CORPUS, TJA_CORPUS_DIR } from '../helpers/resources';

const ESE_TJA = resolve(TJA_CORPUS_DIR, '01 Pop/365 Nichi no Kamihikouki/365 Nichi no Kamihikouki.tja');
const OFFICIAL = resolve(CHN_X64, 'fumen/akb365');
const MUSICINFO = resolve(CHN_X64, 'datatable/musicinfo.bin');
const SUFFIX = { easy: 'e', normal: 'n', hard: 'h', oni: 'm', ura: 'x' } as const;

function baseNoteType(type: number): number {
  if ([0x1, 0x2, 0x3].includes(type)) return 1; // Don text variants
  if ([0x4, 0x5].includes(type)) return 2; // Ka text variants
  if ([0x7, 0xb].includes(type)) return 3; // big Don text variants
  if ([0x8, 0xd].includes(type)) return 4; // big Ka text variants
  return type;
}

function routeNotes(fumen: Fumen) {
  const branch = fumen.header.hasBranches ? 2 : 0;
  const timing = measureTimings(fumen);
  return fumen.measures.flatMap((measure, measureIndex) =>
    measure.branches[branch].notes.map((note) => ({
      type: baseNoteType(note.type),
      time: timing.starts[measureIndex] + note.position,
    })));
}

describe.skipIf(!HAS_CORPUS)('TJA cross-examination against an overlapping official song', () => {
  test('matches chart structure and relative note timing across all four courses', async () => {
    const imported = convertTjaForImport(decodeTjaBytes(await readFile(ESE_TJA)));
    const charts = imported.charts.filter((chart) => chart.slot.player === 'single');
    expect(charts.map((chart) => chart.slot.difficulty)).toEqual(['easy', 'normal', 'hard', 'oni']);

    for (const chart of charts) {
      const encrypted = await readFile(resolve(OFFICIAL, `akb365_${SUFFIX[chart.slot.difficulty]}.bin`));
      const { payload } = await openEnvelope(encrypted, FUMEN_KEY_HEX);
      const official = decodeFumen(payload);
      const actual = routeNotes(chart.fumen);
      const expected = routeNotes(official);

      expect(chart.fumen.measures.length, chart.slot.difficulty).toBe(official.measures.length);
      expect(actual.map((note) => note.type), chart.slot.difficulty).toEqual(expected.map((note) => note.type));

      const actualStart = actual[0]?.time ?? 0;
      const expectedStart = expected[0]?.time ?? 0;
      const drift = actual.map((note, index) =>
        Math.abs((note.time - actualStart) - (expected[index].time - expectedStart)))
        .sort((a, b) => a - b);
      expect(drift[Math.floor(drift.length / 2)], chart.slot.difficulty).toBeLessThan(0.1);
    }
  });

  test('routes each half of SCOREINIT where the official files keep it', async () => {
    const imported = convertTjaForImport(decodeTjaBytes(await readFile(ESE_TJA)));

    // akb365 ships `SCOREINIT:a,b` on all four courses: `a` is the note base in
    // the official fumen, `b` is musicinfo's Shin-uchi score.
    for (const chart of imported.charts.filter((c) => c.slot.player === 'single')) {
      const encrypted = await readFile(resolve(OFFICIAL, `akb365_${SUFFIX[chart.slot.difficulty]}.bin`));
      const official = decodeFumen((await openEnvelope(encrypted, FUMEN_KEY_HEX)).payload);
      const label = chart.slot.difficulty;
      expect(chart.scoreBase, label).toBe(readChartScoring(official).base);
      // SCOREDIFF is a quarter of the stored step, rounded, so scaling it back up
      // has to snap to a multiple of ten to recover the shipped value.
      expect(chart.scoreStep, label).toBe(readChartScoring(official).step);

      // With the base/step right, every note — taps and drumrolls alike — carries
      // the same legacy score the official file does, so the derived ceiling agrees.
      const flatten = (f: Fumen) => f.measures.flatMap((m) => m.branches[0].notes);
      const mine = flatten(chart.fumen);
      const theirs = flatten(official);
      expect(mine.map((n) => [n.scoreInit, n.scoreDiff]), label)
        .toEqual(theirs.map((n) => [n.scoreInit, n.scoreDiff]));
      expect(chart.fumen.header.dummyData, label).toBe(official.header.dummyData);

      // The soul gauge is estimated from the tap count and the course's LEVEL, so
      // it lands on or beside the shipped one (Normal and Oni match exactly here).
      for (const field of ['hpMax', 'hpClear', 'hpGainGood', 'hpGainOk', 'hpLossBad'] as const) {
        expect(Math.abs(chart.fumen.header[field] - official.header[field]), `${label}.${field}`)
          .toBeLessThanOrEqual(1);
      }
    }

    const musicinfo = decodeJsonPayload(
      (await openEnvelope(await readFile(MUSICINFO), DATATABLE_KEY_HEX)).payload,
    ) as MusicInfoFile;
    const song = musicinfo.items.find((item) => item.id === 'akb365');
    const patch = shinutiPatch(imported);
    expect(patch).toMatchObject({
      shinutiEasy: song?.shinutiEasy, shinutiEasyDuet: song?.shinutiEasy,
      shinutiNormal: song?.shinutiNormal, shinutiNormalDuet: song?.shinutiNormal,
      shinutiHard: song?.shinutiHard, shinutiHardDuet: song?.shinutiHard,
      shinutiMania: song?.shinutiMania, shinutiManiaDuet: song?.shinutiMania,
      // akb365 has no Ura course, so Ura takes the absent-chart sentinel.
      shinutiUra: SHINUCHI_ABSENT, shinutiUraDuet: SHINUCHI_ABSENT,
      shinutiScoreUra: SHINUCHI_ABSENT, shinutiScoreUraDuet: SHINUCHI_ABSENT,
    });

    // The target follows from that base and the chart's own bonus. The bonus is an
    // estimate of how many drumroll hits a player lands, so it can differ from the
    // shipped value by a hit — Normal and Hard land exactly, Easy and Oni by +100.
    for (const field of ['Easy', 'Normal', 'Hard', 'Mania'] as const) {
      const shipped = song?.[`shinutiScore${field}`] as number;
      expect(shipped).toBeGreaterThanOrEqual(1_000_000);
      for (const key of [`shinutiScore${field}`, `shinutiScore${field}Duet`] as const) {
        expect(patch[key], key).toBeGreaterThanOrEqual(1_000_000);
        expect(Math.abs(patch[key] - shipped), key).toBeLessThanOrEqual(100);
      }
    }
  });
});
