// The executable proof of `soulGaugeDefaults`: re-measures the estimator against
// every shipped chart in both dumps.
//
// The gauge is an *estimate*, not a reconstruction — the shipped values carry a
// per-chart balancing choice on top of (difficulty, star) — so the assertions are
// accuracy floors, set a few points under the measured rates. Regressing the
// constants or the ceil-per-field shape drops through them immediately.
//
// Measured when the table was fitted (fitted on CHN, unchanged on JPN):
//
//   dump  hpGainGood  hpGainOk  hpLossBad  all three  good within 5%
//   CHN       89.2%     89.2%      90.3%      76.8%        98.5%
//   JPN       89.4%     89.4%      90.5%      77.2%        98.5%

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decodeFumen, decodeJsonPayload } from '../../src/codec';
import type { Fumen, MusicInfoFile, MusicInfoItem } from '../../src/codec';
import { openEnvelope } from '../../src/codec/envelope';
import { soulGaugeDefaults, type FumenChartDifficulty } from '../../src/codec/fumen/authoring';
import { tapNoteCount } from '../../src/model/fumenScaffold';
import { DUMPS, loadBytes } from '../helpers/dumps';
import { DATATABLE_KEY_HEX, FUMEN_KEY_HEX } from '../helpers/keys';
import { HAS_CORPUS } from '../helpers/resources';

const DIFFICULTIES: { difficulty: FumenChartDifficulty; letter: string; star: keyof MusicInfoItem }[] = [
  { difficulty: 'easy', letter: 'e', star: 'starEasy' },
  { difficulty: 'normal', letter: 'n', star: 'starNormal' },
  { difficulty: 'hard', letter: 'h', star: 'starHard' },
  { difficulty: 'oni', letter: 'm', star: 'starMania' },
  { difficulty: 'ura', letter: 'x', star: 'starUra' },
];

interface Chart {
  id: string;
  difficulty: FumenChartDifficulty;
  star: number;
  taps: number;
  header: Fumen['header'];
}

async function loadCharts(x64: string): Promise<Chart[]> {
  const musicinfo = decodeJsonPayload(
    (await openEnvelope(await loadBytes(resolve(x64, 'datatable/musicinfo.bin')), DATATABLE_KEY_HEX)).payload,
  ) as MusicInfoFile;

  const charts: Chart[] = [];
  for (const item of musicinfo.items) {
    const id = item.id as string;
    for (const fields of DIFFICULTIES) {
      const raw = item[fields.star];
      const star = typeof raw === 'number' ? raw : 0;
      if (star <= 0) continue; // difficulty absent
      let fumen: Fumen;
      try {
        const bytes = await readFile(resolve(x64, `fumen/${id}/${id}_${fields.letter}.bin`));
        fumen = decodeFumen((await openEnvelope(
          new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), FUMEN_KEY_HEX,
        )).payload);
      } catch {
        continue;
      }
      const taps = tapNoteCount(fumen);
      if (taps <= 0 || fumen.header.hpGainGood <= 0) continue;
      charts.push({ id, difficulty: fields.difficulty, star, taps, header: fumen.header });
    }
  }
  return charts;
}

describe.skipIf(!HAS_CORPUS).each(DUMPS)('soul gauge over the $region corpus', (dump) => {
  test('hpMax and hpClear are exact', async () => {
    const charts = await loadCharts(dump.x64);
    expect(charts.length).toBeGreaterThan(4000);
    for (const chart of charts) {
      const gauge = soulGaugeDefaults(chart.difficulty, chart.taps, chart.star);
      expect(gauge.hpMax, `${chart.id}/${chart.difficulty}`).toBe(chart.header.hpMax);
      expect(gauge.hpClear, `${chart.id}/${chart.difficulty}`).toBe(chart.header.hpClear);
    }
  });

  test('the estimated deltas reproduce the shipped gauge on ~9 charts in 10', async () => {
    const charts = await loadCharts(dump.x64);
    let good = 0;
    let ok = 0;
    let bad = 0;
    let all3 = 0;
    let near = 0;
    for (const chart of charts) {
      const gauge = soulGaugeDefaults(chart.difficulty, chart.taps, chart.star);
      const hitGood = gauge.hpGainGood === chart.header.hpGainGood;
      const hitOk = gauge.hpGainOk === chart.header.hpGainOk;
      const hitBad = gauge.hpLossBad === chart.header.hpLossBad;
      if (hitGood) good++;
      if (hitOk) ok++;
      if (hitBad) bad++;
      if (hitGood && hitOk && hitBad) all3++;
      if (Math.abs(gauge.hpGainGood - chart.header.hpGainGood) <= Math.max(1, chart.header.hpGainGood * 0.05)) near++;
    }
    const n = charts.length;
    expect(good / n, 'hpGainGood exact').toBeGreaterThan(0.87);
    expect(ok / n, 'hpGainOk exact').toBeGreaterThan(0.87);
    expect(bad / n, 'hpLossBad exact').toBeGreaterThan(0.88);
    expect(all3 / n, 'all three exact').toBeGreaterThan(0.74);
    expect(near / n, 'hpGainGood within 5%').toBeGreaterThan(0.97);
  });

  test('every estimate stays a playable, clearable gauge', async () => {
    const charts = await loadCharts(dump.x64);
    for (const chart of charts) {
      const gauge = soulGaugeDefaults(chart.difficulty, chart.taps, chart.star);
      const label = `${chart.id}/${chart.difficulty}`;
      expect(gauge.hpGainGood, label).toBeGreaterThan(0);
      expect(gauge.hpGainOk, label).toBeGreaterThan(0);
      expect(gauge.hpGainOk, label).toBeLessThanOrEqual(gauge.hpGainGood);
      expect(gauge.hpLossBad, label).toBeLessThan(0);
      // An all-Good clear must reach the norma — with room to spare, as shipped
      // charts have (they fill the gauge on ~70% of the notes).
      expect(gauge.hpGainGood * chart.taps, label).toBeGreaterThan(gauge.hpClear);
    }
  });
});
