// The executable proof of model/shinuchi.ts: re-derives the Shin-uchi scoring law
// from every shipped chart in both dumps, so a regression in the derivation fails
// here rather than silently mis-scoring an imported song.
//
// Two claims are checked, in order:
//   1. Given a chart's *shipped* bonus (target − base × notes), the base is the
//      smallest multiple of 10 that carries an all-Good clear to 1,000,000.
//   2. That bonus is reconstructible from the fumen alone as
//      100 × (balloon hits + round(rendaSeconds × rate)).
// Claim 2 is an estimate of player tapping speed, so it is asserted at the corpus
// pass rates rather than exactly.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decodeFumen, decodeJsonPayload } from '../../src/codec';
import type { Fumen, MusicInfoFile, MusicInfoItem } from '../../src/codec';
import { openEnvelope } from '../../src/codec/envelope';
import type { FumenDifficulty } from '../../src/fs/fumens';
import { summarizeFumenMetadata } from '../../src/model/fumenMetadata';
import {
  SHINUCHI_HIT_POINTS,
  SHINUCHI_TARGET,
  shinuchiBonus,
  shinuchiScoring,
} from '../../src/model/shinuchi';
import { DUMPS, loadBytes } from '../helpers/dumps';
import { DATATABLE_KEY_HEX, FUMEN_KEY_HEX } from '../helpers/keys';
import { HAS_CORPUS } from '../helpers/resources';

interface DifficultyFields {
  difficulty: FumenDifficulty;
  letter: string;
  base: keyof MusicInfoItem;
  target: keyof MusicInfoItem;
  notes: keyof MusicInfoItem;
  renda: keyof MusicInfoItem;
  fuusen: keyof MusicInfoItem;
}

const DIFFICULTIES: DifficultyFields[] = [
  { difficulty: 'easy', letter: 'e', base: 'shinutiEasy', target: 'shinutiScoreEasy', notes: 'easyOnpuNum', renda: 'rendaTimeEasy', fuusen: 'fuusenTotalEasy' },
  { difficulty: 'normal', letter: 'n', base: 'shinutiNormal', target: 'shinutiScoreNormal', notes: 'normalOnpuNum', renda: 'rendaTimeNormal', fuusen: 'fuusenTotalNormal' },
  { difficulty: 'hard', letter: 'h', base: 'shinutiHard', target: 'shinutiScoreHard', notes: 'hardOnpuNum', renda: 'rendaTimeHard', fuusen: 'fuusenTotalHard' },
  { difficulty: 'oni', letter: 'm', base: 'shinutiMania', target: 'shinutiScoreMania', notes: 'maniaOnpuNum', renda: 'rendaTimeMania', fuusen: 'fuusenTotalMania' },
  { difficulty: 'ura', letter: 'x', base: 'shinutiUra', target: 'shinutiScoreUra', notes: 'uraOnpuNum', renda: 'rendaTimeUra', fuusen: 'fuusenTotalUra' },
];

function number(item: MusicInfoItem, field: keyof MusicInfoItem): number {
  const value = item[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

interface Chart {
  id: string;
  difficulty: FumenDifficulty;
  base: number;
  target: number;
  notes: number;
  /** target − base × notes: the bonus the designers actually budgeted. */
  bonus: number;
  fumen: Fumen;
}

async function loadCharts(x64: string): Promise<Chart[]> {
  const musicinfo = decodeJsonPayload(
    (await openEnvelope(await loadBytes(resolve(x64, 'datatable/musicinfo.bin')), DATATABLE_KEY_HEX)).payload,
  ) as MusicInfoFile;

  const charts: Chart[] = [];
  for (const item of musicinfo.items) {
    const id = item.id as string;
    for (const fields of DIFFICULTIES) {
      const base = number(item, fields.base);
      const target = number(item, fields.target);
      const notes = number(item, fields.notes);
      // 1000 across the board is the sentinel for "this difficulty has no chart".
      if (target <= 1000 || base <= 0 || notes <= 0) continue;
      let fumen: Fumen;
      try {
        const bytes = await readFile(resolve(x64, `fumen/${id}/${id}_${fields.letter}.bin`));
        fumen = decodeFumen((await openEnvelope(
          new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), FUMEN_KEY_HEX,
        )).payload);
      } catch {
        continue;
      }
      charts.push({ id, difficulty: fields.difficulty, base, target, notes, bonus: target - base * notes, fumen });
    }
  }
  return charts;
}

describe.skipIf(!HAS_CORPUS).each(DUMPS)('Shin-uchi scoring over the $region corpus', (dump) => {
  test('every shipped chart is tuned to land just above 1,000,000', async () => {
    const charts = await loadCharts(dump.x64);
    expect(charts.length).toBeGreaterThan(4000);

    let budgeted = 0;
    let ruleHolds = 0;
    for (const chart of charts) {
      expect(chart.target, `${chart.id}/${chart.difficulty}`).toBeGreaterThanOrEqual(SHINUCHI_TARGET);
      expect(chart.bonus, `${chart.id}/${chart.difficulty}`).toBeGreaterThanOrEqual(0);
      // 25 of 4,345 shipped bonuses are not whole hits — hand-tuned leftovers that
      // cannot be expressed as a hit count, so they cannot exercise the rule.
      if (chart.bonus % SHINUCHI_HIT_POINTS !== 0) continue;
      budgeted++;
      // The base is the smallest multiple of 10 that gets the rest of the way.
      const derived = shinuchiScoring(
        { notes: chart.notes, renda: 0, fuusen: chart.bonus / SHINUCHI_HIT_POINTS },
        chart.difficulty,
      );
      if (derived.base === chart.base && derived.target === chart.target) ruleHolds++;
    }
    // Only `linda` deviates (its base sits 10 above the rule) in either dump.
    expect(ruleHolds / budgeted).toBeGreaterThan(0.999);
  });

  test('the bonus is reconstructible from the fumen within one drumroll hit', async () => {
    const charts = await loadCharts(dump.x64);

    let bonusExact = 0;
    let bonusWithinOneHit = 0;
    let baseExact = 0;
    let targetWithin500 = 0;
    let aboveTarget = 0;
    for (const chart of charts) {
      const summary = summarizeFumenMetadata(chart.fumen);
      const bonus = shinuchiBonus(summary, chart.difficulty);
      if (bonus === chart.bonus) bonusExact++;
      if (Math.abs(bonus - chart.bonus) <= SHINUCHI_HIT_POINTS) bonusWithinOneHit++;

      const derived = shinuchiScoring(summary, chart.difficulty);
      if (derived.base === chart.base) baseExact++;
      if (Math.abs(derived.target - chart.target) <= 500) targetWithin500++;
      if (derived.target >= SHINUCHI_TARGET) aboveTarget++;
    }
    const n = charts.length;
    expect(bonusExact / n, 'bonus exact').toBeGreaterThan(0.65);
    expect(bonusWithinOneHit / n, 'bonus within one hit').toBeGreaterThan(0.96);
    expect(baseExact / n, 'base exact').toBeGreaterThan(0.97);
    expect(targetWithin500 / n, 'target within 500').toBeGreaterThan(0.97);
    // The one property a derived target must never break: it is still a clear.
    expect(aboveTarget, 'target at or above 1,000,000').toBe(n);
  });

  test('rendaTime carries a 48th-note tail past each stored drumroll length', async () => {
    const musicinfo = decodeJsonPayload(
      (await openEnvelope(await loadBytes(resolve(dump.x64, 'datatable/musicinfo.bin')), DATATABLE_KEY_HEX)).payload,
    ) as MusicInfoFile;
    const shipped = new Map(musicinfo.items.map((item) => [item.id as string, item]));

    let withRolls = 0;
    let matches = 0;
    for (const chart of await loadCharts(dump.x64)) {
      const fields = DIFFICULTIES.find((d) => d.difficulty === chart.difficulty)!;
      const item = shipped.get(chart.id);
      if (!item) continue;
      const summary = summarizeFumenMetadata(chart.fumen);
      if (summary.renda === 0) continue;
      withRolls++;
      if (Math.abs(summary.renda - number(item, fields.renda)) < 0.002) matches++;
    }
    expect(withRolls).toBeGreaterThan(3500);
    // 2,906 of the 4,009 CHN charts that have drumrolls, against 30 for a plain
    // sum of the stored durations.
    expect(matches / withRolls, 'rendaTime reconstructed to within 2 ms').toBeGreaterThan(0.70);
  });
});
