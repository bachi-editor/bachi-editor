// Authoring helpers for scaffolding a *new* fumen chart — the difficulty-keyed
// header fields and the derived `dummyData` score ceiling. These encode the
// findings documented in spec.md ("Timing windows" and "Scoring model"); the
// corpus-verification test (test/codec/fumen-scoring.test.ts) pins them against
// the real files. Pure functions, no I/O — safe to call from the model/UI layer.

import { Fumen, FUMEN_TIMING_WINDOW_COUNT } from './types';

/** The five playable difficulties (structurally identical to fs `FumenDifficulty`). */
export type FumenChartDifficulty = 'easy' | 'normal' | 'hard' | 'oni' | 'ura';

// ── Timing windows (header bytes 0..431) ───────────────────────────────────
//
// 108 f32 = one (良 GOOD, 可 OK, 不可 BAD) hit-window triple in ms, repeated 36×.
// Every value is a half-frame multiple at the NTSC 59.94 Hz frame rate
// (1 frame = 1000/59.94 ≈ 16.6833 ms). The literals below are the exact f32
// doubles from the corpus, so an encoded header is byte-identical to a shipped one.
const TIMING_STRICT = [
  25.025001525878906, // GOOD 1.5 frames  (0x41c83334)
  75.07500457763672, //  OK   4.5 frames  (0x42962667)
  108.44166564941406, // BAD   6.5 frames  (0x42d8e222)
] as const;
const TIMING_LENIENT = [
  41.708335876464844, // GOOD 2.5 frames  (0x4226d556)
  108.44166564941406, // OK   6.5 frames  (0x42d8e222)
  125.125, //            BAD   7.5 frames  (0x42fa4000)
] as const;
// A third, wider Easy profile (OK widened to 7.5 frames) exists on ~444 of the
// easiest Easy charts: [41.7083, 125.125, 125.125]. We author the plain lenient
// profile (the corpus majority for Easy).

const TIMING_WINDOW_TRIPLE: Record<FumenChartDifficulty, readonly [number, number, number]> = {
  easy: TIMING_LENIENT,
  normal: TIMING_LENIENT,
  hard: TIMING_STRICT,
  oni: TIMING_STRICT,
  ura: TIMING_STRICT,
};

/** The 108-float timing-window block for a difficulty: its (GOOD, OK, BAD) triple ×36. */
export function timingWindowsForDifficulty(difficulty: FumenChartDifficulty): number[] {
  const triple = TIMING_WINDOW_TRIPLE[difficulty];
  const out = new Array<number>(FUMEN_TIMING_WINDOW_COUNT);
  for (let i = 0; i < FUMEN_TIMING_WINDOW_COUNT; i++) out[i] = triple[i % 3];
  return out;
}

// ── Score ceiling (header byte 508, `dummyData`) ───────────────────────────

const DRUMROLL_TYPES = new Set<number>([0x6, 0x9]);
const BALLOON_TYPES = new Set<number>([0xa, 0xc]);

/** Legacy-scoring combo-tier multiplier: +1 step every 10 combo, capped at combo 100. */
function comboTier(combo: number): number {
  return Math.min(Math.floor(combo / 10), 10);
}

/**
 * The branch index whose notes define a chart's score/metadata: Master (2) when the
 * chart carries any Master-branch notes, else the flat Normal track (0). Mirrors the
 * "highest non-empty branch" rule that reproduces `dummyData` on 99.6% of the corpus.
 */
export function scoreBranchIndex(fumen: Fumen): 0 | 1 | 2 {
  let idx: 0 | 1 | 2 = 0;
  for (const measure of fumen.measures) {
    if (measure.branches[2].notes.length > 0) return 2;
    if (measure.branches[1].notes.length > 0) idx = 1;
  }
  return idx;
}

/**
 * Compute the legacy (旧配点) theoretical maximum score of the master branch — the
 * value the corpus stores in `header.dummyData`. Sum over tap notes, in combo order,
 * of `scoreInit + scoreDiff × min(floor(combo/10), 10)`. Balloons and drumrolls
 * contribute 0 and do **not** tick combo. Reproduces the stored `dummyData`
 * byte-exact on 15,013 / 15,075 corpus charts (see spec.md "Scoring model").
 */
export function computeScoreCeiling(fumen: Fumen): number {
  const bi = scoreBranchIndex(fumen);
  let combo = 0;
  let total = 0;
  for (const measure of fumen.measures) {
    for (const note of measure.branches[bi].notes) {
      if (BALLOON_TYPES.has(note.type) || DRUMROLL_TYPES.has(note.type)) continue;
      combo++;
      total += note.scoreInit + note.scoreDiff * comboTier(combo);
    }
  }
  return total;
}

// ── Soul gauge (header bytes 440..452) ─────────────────────────────────────

/** `hpMax` in every one of the 15,075 corpus charts. */
const HP_MAX = 10000;

/** Exact per-difficulty clear norma (no corpus chart deviates). */
const HP_CLEAR: Record<FumenChartDifficulty, number> = {
  easy: 6000,
  normal: 7000,
  hard: 7000,
  oni: 8000,
  ura: 8000,
};

/**
 * `[good, ok, bad]` gauge constants keyed by difficulty and star rating.
 *
 * All three gauge deltas are `ceil(constant / tapCount)` — each rounded on its own,
 * which is why they are *not* exact multiples of one another in shipped files
 * (`hpGainOk` is sometimes ⌈0.75 × good⌉ and sometimes ⌊0.75 × good⌋). Only the
 * constants sit in a fixed ratio: `ok / good` is 0.75 for Easy–Hard and ~0.49 for
 * Oni/Ura, while `bad / good` climbs by rank through 0.5, 0.75, 1.0, 1.16, 1.25,
 * 1.6 and 2.0.
 *
 * The values are least-squares-free best fits over the CHN corpus (the constant that
 * reproduces the most shipped charts in each bucket), and reproduce the JPN dump
 * equally well — see test/codec/fumen-scoring.test.ts, which pins the accuracy
 * floor on both. Sparse buckets (fewer than ten shipped charts) are omitted and
 * resolved by clamping to the nearest rated neighbour.
 */
const GAUGE_CONSTANTS: Record<FumenChartDifficulty, Record<number, readonly [number, number, number]>> = {
  easy: {
    1: [16639, 12475, 8308],
    2: [15751, 11800, 7855],
    3: [15730, 11777, 7833],
    4: [13571, 10149, 6733],
    5: [13537, 10107, 6721],
  },
  normal: {
    1: [15191, 11389, 7596],
    2: [15190, 11389, 7582],
    3: [14311, 10717, 7126],
    4: [14131, 10594, 10594],
    5: [13207, 9871, 13207],
    6: [13201, 9871, 13201],
    7: [13168, 9845, 13168],
  },
  hard: {
    1: [12845, 9613, 9613],
    2: [12815, 9601, 9601],
    3: [13709, 10276, 13709],
    4: [14397, 10741, 16745],
    5: [14635, 10975, 18388],
    6: [14363, 10721, 17986],
    7: [14320, 10707, 17986],
    8: [14298, 10657, 17918],
  },
  oni: {
    4: [13985, 6913, 22465],
    5: [14026, 6881, 22488],
    6: [13945, 6889, 22446],
    7: [13873, 6843, 22393],
    8: [14001, 6881, 28289],
    9: [12781, 6202, 25851],
    10: [12643, 6121, 25796],
  },
  ura: {
    8: [13945, 6865, 28289],
    9: [12721, 6211, 25917],
    10: [12657, 6121, 25758],
  },
};

/** Star used when the caller has no rating — the busiest bucket per difficulty. */
const DEFAULT_STAR: Record<FumenChartDifficulty, number> = {
  easy: 4, normal: 5, hard: 7, oni: 8, ura: 10,
};

function gaugeConstants(
  difficulty: FumenChartDifficulty,
  star: number,
): readonly [number, number, number] {
  const rated = GAUGE_CONSTANTS[difficulty];
  let nearest = Number.NaN;
  for (const key of Object.keys(rated)) {
    const value = Number(key);
    if (Number.isNaN(nearest) || Math.abs(value - star) < Math.abs(nearest - star)) nearest = value;
  }
  return rated[nearest];
}

export interface SoulGaugeFields {
  hpMax: number;
  hpClear: number;
  hpGainGood: number;
  hpGainOk: number;
  hpLossBad: number;
}

/**
 * Soul-gauge fields for a new chart, estimated the way the corpus builds them:
 * `hpMax` and `hpClear` are exact constants, and each delta is
 * `ceil(constant / tapNoteCount)` for a constant keyed by difficulty and star.
 *
 * `star` is the chart's rating (a TJA's `LEVEL`, musicinfo's `star*`); omitting it
 * falls back to the most common rating for the difficulty. An unrated or
 * out-of-range star clamps to the nearest bucket the corpus covers.
 *
 * This is an **estimate**, not a reconstruction — the shipped values carry a
 * per-chart balancing choice on top of the rating — but it lands on the shipped
 * value for ~89% of charts and within 5% for 98.5% (both dumps).
 */
export function soulGaugeDefaults(
  difficulty: FumenChartDifficulty,
  tapNoteCount: number,
  star = DEFAULT_STAR[difficulty],
): SoulGaugeFields {
  const [cGood, cOk, cBad] = gaugeConstants(difficulty, Math.round(star));
  const taps = Math.max(1, Math.round(tapNoteCount));
  // An empty chart would divide by zero; clamping taps to 1 makes one 良 fill the
  // whole gauge, which is also the sanest placeholder until notes are added.
  const perNote = (constant: number) => Math.min(HP_MAX, Math.max(1, Math.ceil(constant / taps)));
  return {
    hpMax: HP_MAX,
    hpClear: HP_CLEAR[difficulty],
    hpGainGood: perNote(cGood),
    hpGainOk: perNote(cOk),
    hpLossBad: -perNote(cBad),
  };
}
