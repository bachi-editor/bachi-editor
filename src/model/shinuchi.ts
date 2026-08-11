// Shin-uchi (真打) scoring: musicinfo's per-difficulty `shinuti*` base score and
// the `shinutiScore*` target the chart is tuned against.
//
// The two are not independent — the corpus pins the whole relationship, and
// test/model/shinuchi-corpus.test.ts re-derives every claim below over both dumps:
//
//   bonus  = 100 × (balloon hits + estimated drumroll hits)
//   base   = ceil10((1_000_000 − bonus) / notes)   → `shinuti*`
//   target = base × notes + bonus                  → `shinutiScore*`
//
// So an all-Good clear is designed to land *just above* 1,000,000: every one of
// the 8,666 shipped charts does, and `base` is the smallest multiple of 10 that
// gets there. Given a chart's shipped bonus, that `base` rule reproduces the
// shipped value on 4,342/4,345 (CHN) and 4,318/4,321 (JPN) charts.
//
// Drumroll points are an *estimate*, not a count: the designers assume a fixed
// tapping speed per difficulty (SHINUCHI_RENDA_RATE) over the chart's total
// drumroll seconds. Reconstructed from the fumen alone the estimate is within one
// hit (±100 points) of the shipped bonus on 97% of charts, which lands `base`
// exactly on 97.8% and the target within ±500 points on 98%.

import type { FumenDifficulty } from '../fs/fumens';
import type { FumenMetadataSummary } from './fumenMetadata';

/** The score an all-Good clear is tuned to reach (真打 is normalized to 1,000,000). */
export const SHINUCHI_TARGET = 1_000_000;

/** Points one drumroll or balloon hit is worth. */
export const SHINUCHI_HIT_POINTS = 100;

/**
 * What official songs write into `shinuti*` / `shinutiScore*` for a difficulty
 * that has no chart — 852/858 (CHN) and 842/842 (JPN) Ura-less songs use it.
 * The chart-derived fields (`*OnpuNum`, `rendaTime*`, `fuusenTotal*`) use 1000 in
 * older songs but 0 from uniqueId 921 on, so those stay at 0.
 */
export const SHINUCHI_ABSENT = 1000;

/**
 * Assumed drumroll tapping speed in hits per second. The corpus pins the family
 * exactly: one hit every `d / 33.75` seconds with d = 5, 4, 3, 2 for Easy, Normal,
 * Hard and Oni/Ura — 6.75, 8.4375, 11.25 and 16.875 hits per second.
 */
export const SHINUCHI_RENDA_RATE: Record<FumenDifficulty, number> = {
  easy: 33.75 / 5,
  normal: 33.75 / 4,
  hard: 33.75 / 3,
  oni: 33.75 / 2,
  ura: 33.75 / 2,
};

/** Drumroll hits the scoring model expects over `rendaSeconds` of rolls. */
export function estimateRendaHits(rendaSeconds: number, difficulty: FumenDifficulty): number {
  if (!Number.isFinite(rendaSeconds) || rendaSeconds <= 0) return 0;
  return Math.round(rendaSeconds * SHINUCHI_RENDA_RATE[difficulty]);
}

export interface ShinuchiScoring {
  /** musicinfo `shinuti*` — points per Good. */
  base: number;
  /** musicinfo `shinutiScore*` — the all-Good total the base is tuned against. */
  target: number;
}

/** Points a full clear collects outside the taps: balloons plus expected roll hits. */
export function shinuchiBonus(
  chart: Pick<FumenMetadataSummary, 'renda' | 'fuusen'>,
  difficulty: FumenDifficulty,
): number {
  return SHINUCHI_HIT_POINTS * (Math.max(0, Math.round(chart.fuusen)) + estimateRendaHits(chart.renda, difficulty));
}

/**
 * The `shinuti*` / `shinutiScore*` pair for one chart.
 *
 * `base` is derived unless the source supplies one (a TJA's `SCOREINIT:a,b` carries
 * the authored Shin-uchi base as `b`), in which case the target follows from it so
 * the two stay consistent. A chart with no tap notes — a branch route holding only
 * a balloon, say — has no meaningful per-Good value, so its base is 0 and the whole
 * target is the bonus.
 */
export function shinuchiScoring(
  chart: Pick<FumenMetadataSummary, 'notes' | 'renda' | 'fuusen'>,
  difficulty: FumenDifficulty,
  authoredBase?: number,
): ShinuchiScoring {
  const bonus = shinuchiBonus(chart, difficulty);
  const notes = Math.max(0, Math.round(chart.notes));
  if (notes === 0) return { base: 0, target: bonus };
  const base = authoredBase !== undefined && authoredBase > 0
    ? Math.round(authoredBase)
    : Math.ceil((SHINUCHI_TARGET - bonus) / notes / 10) * 10;
  return { base, target: base * notes + bonus };
}
