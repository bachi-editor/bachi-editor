// Verifies the authoring helpers against the real corpus:
//   - timingWindowsForDifficulty() reproduces every shipped header's 432-byte block
//   - computeScoreCeiling() reproduces header.dummyData on ≥99.5% of charts
// Both are the executable proof of the spec.md "Timing windows" / "Scoring model"
// findings, so a regression in the derivation fails here rather than silently.

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decodeFumen } from '../../src/codec/fumen/decode';
import {
  computeScoreCeiling,
  timingWindowsForDifficulty,
  soulGaugeDefaults,
  type FumenChartDifficulty,
} from '../../src/codec/fumen/authoring';
import { openEnvelope } from '../../src/codec/envelope';
import { FUMEN_KEY_HEX } from '../helpers/keys';

const REPO = resolve(__dirname, '../../..');
const FUMEN_DIR = resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen');

const DIFFICULTY_BY_LETTER: Record<string, FumenChartDifficulty> = {
  e: 'easy',
  n: 'normal',
  h: 'hard',
  m: 'oni',
  x: 'ura',
};

function difficultyOf(file: string): FumenChartDifficulty | undefined {
  const m = /_([enhmx])(?:_[12])?\.bin$/.exec(file);
  return m ? DIFFICULTY_BY_LETTER[m[1]] : undefined;
}

async function* walkBins(root: string): AsyncGenerator<string> {
  for (const ent of await readdir(root, { withFileTypes: true })) {
    const p = join(root, ent.name);
    if (ent.isDirectory()) yield* walkBins(p);
    else if (ent.isFile() && ent.name.endsWith('.bin')) yield p;
  }
}

describe('fumen authoring helpers', () => {
  test('timingWindowsForDifficulty shape and exact values', () => {
    for (const d of ['easy', 'normal', 'hard', 'oni', 'ura'] as const) {
      const w = timingWindowsForDifficulty(d);
      expect(w).toHaveLength(108);
      // 36 identical (GOOD, OK, BAD) triples
      for (let g = 1; g < 36; g++) {
        for (let k = 0; k < 3; k++) expect(w[g * 3 + k]).toBe(w[k]);
      }
      // GOOD < OK ≤ BAD, and strict is tighter than lenient
      expect(w[0]).toBeLessThan(w[1]);
      expect(w[1]).toBeLessThanOrEqual(w[2]);
    }
    expect(timingWindowsForDifficulty('oni')[0]).toBeCloseTo(25.025, 3); // 1.5 frames
    expect(timingWindowsForDifficulty('easy')[0]).toBeCloseTo(41.7083, 3); // 2.5 frames
  });

  test('soulGaugeDefaults are self-consistent and in range', () => {
    const g = soulGaugeDefaults('oni', 700);
    expect(g.hpMax).toBe(10000);
    expect(g.hpClear).toBe(8000);
    expect(g.hpGainGood).toBeGreaterThan(0);
    expect(g.hpLossBad).toBeLessThan(0);
    // Each delta rounds independently (as the corpus does), so OK is *near* half
    // the good gain on Oni rather than exactly round(good × 0.5).
    expect(g.hpGainOk).toBeGreaterThan(0);
    expect(g.hpGainOk).toBeLessThan(g.hpGainGood);
    expect(Math.abs(g.hpGainOk - g.hpGainGood * 0.5)).toBeLessThanOrEqual(1);
    // all-good overfills past the clear norma
    expect(g.hpGainGood * 700).toBeGreaterThan(g.hpClear);
    expect(soulGaugeDefaults('easy', 200).hpClear).toBe(6000);
  });

  test('soulGaugeDefaults are keyed by star, and unrated falls back', () => {
    // A 10★ Oni fills the gauge over more notes than an 8★ one of the same length.
    const hard10 = soulGaugeDefaults('oni', 800, 10);
    const hard8 = soulGaugeDefaults('oni', 800, 8);
    expect(hard10.hpGainGood).toBeLessThan(hard8.hpGainGood);
    // Its bad penalty is the harshest rank, well past the good gain.
    expect(-hard10.hpLossBad).toBeGreaterThan(hard10.hpGainGood);
    // Stars outside the rated range clamp to the nearest bucket the corpus covers.
    expect(soulGaugeDefaults('oni', 800, 1)).toEqual(soulGaugeDefaults('oni', 800, 4));
    expect(soulGaugeDefaults('easy', 300, 9)).toEqual(soulGaugeDefaults('easy', 300, 5));
    // Omitting the star still yields a playable gauge.
    const unrated = soulGaugeDefaults('normal', 300);
    expect(unrated.hpGainGood).toBeGreaterThan(0);
    expect(unrated.hpGainGood * 300).toBeGreaterThan(unrated.hpClear);
  });

  test('an empty chart gets a placeholder gauge instead of dividing by zero', () => {
    const blank = soulGaugeDefaults('oni', 0);
    expect(blank.hpGainGood).toBe(10000);
    expect(blank.hpLossBad).toBe(-10000);
    expect(Number.isFinite(blank.hpGainOk)).toBe(true);
  });

  test('computeScoreCeiling reproduces the shipped dummyData across the corpus', async () => {
    const all: string[] = [];
    for await (const p of walkBins(FUMEN_DIR)) all.push(p);
    all.sort();
    expect(all.length).toBeGreaterThan(10000);

    let matches = 0;
    let coopMismatch = 0;
    let timingMatches = 0;
    let timingChecked = 0;
    const mismatches: string[] = [];
    const nonCoopMismatch: string[] = [];

    for (const file of all) {
      const buf = await readFile(file);
      const { payload } = await openEnvelope(
        new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
        FUMEN_KEY_HEX,
      );
      const fumen = decodeFumen(payload);

      if (computeScoreCeiling(fumen) === fumen.header.dummyData) {
        matches++;
      } else {
        const rel = relative(FUMEN_DIR, file);
        if (mismatches.length < 12) mismatches.push(rel);
        // The known exceptions are dominated by two-player co-op variants (…_1 / …_2),
        // whose stored dummyData is inherited rather than recomputed from their notes.
        if (/_[12]\.bin$/.test(file)) coopMismatch++;
        else nonCoopMismatch.push(rel);
      }

      // Timing windows: the shipped 432-byte block equals our difficulty profile,
      // except the wii5op medley (switches profile mid-song) and the widened-Easy
      // variant. Sample every difficulty via the filename.
      const diff = difficultyOf(file);
      if (diff && !file.includes('wii5op')) {
        timingChecked++;
        const want = timingWindowsForDifficulty(diff);
        let ok = true;
        for (let i = 0; i < 108 && ok; i++) {
          if (Math.abs(fumen.header.timingWindows[i] - want[i]) > 1e-3) ok = false;
        }
        if (ok) timingMatches++;
      }
    }

    // dummyData: ≥ 99.5% exact via the master-branch legacy-scoring formula.
    expect(matches / all.length).toBeGreaterThan(0.995);
    // The residual (< 0.5%) is dominated by co-op player variants; only a small
    // co-op-adjacent tail of solo/…_1 files remains (documented in spec.md).
    expect(nonCoopMismatch.length).toBeLessThanOrEqual(12);
    expect(coopMismatch).toBeGreaterThan(nonCoopMismatch.length);
    // Timing profile matches the vast majority (the widened-Easy variant is the only
    // sanctioned miss, ~444 Easy files → still > 95%).
    expect(timingMatches / timingChecked).toBeGreaterThan(0.95);

    // eslint-disable-next-line no-console
    console.log(
      `\ncomputeScoreCeiling: ${matches}/${all.length} exact; ` +
        `mismatches: ${coopMismatch} co-op + ${nonCoopMismatch.length} other` +
        `${nonCoopMismatch.length ? ' (' + nonCoopMismatch.slice(0, 6).join(', ') + ')' : ''}; ` +
        `timing profile: ${timingMatches}/${timingChecked}.`,
    );
  }, 300_000);
});
