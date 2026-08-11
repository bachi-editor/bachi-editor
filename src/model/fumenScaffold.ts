// Build a fumen chart from scratch and keep its derived header consistent as
// notes are authored — the foundation for "create a new song / chart from
// scratch" (see NEW_SONG_PLAN.md). All difficulty-keyed field values come from
// the corpus-verified codec helpers (codec/fumen/authoring.ts); the byte format
// they satisfy is documented in codec/fumen/spec.md. Pure functions, no store or
// I/O — the store action and UI dialog call these.

import {
  computeScoreCeiling,
  Fumen,
  FumenBranch,
  FumenHeader,
  FumenMeasure,
  FumenNote,
  makeFumenHeader,
  scoreBranchIndex,
  soulGaugeDefaults,
  timingWindowsForDifficulty,
} from '../codec';
import { FumenDifficulty, FumenSlot, fumenFilename, PLAYER_ORDER } from '../fs/fumens';
import type { CreatedFumen } from './fumenSlots';

const DEFAULT_BPM = 120;
const DEFAULT_MEASURE_COUNT = 1;

/** Notes that carry no legacy score of their own (see spec.md "Scoring model"). */
const BALLOON_TYPES = new Set<number>([0xa, 0xc]);
const DRUMROLL_TYPES = new Set<number>([0x6, 0x9]);

/**
 * Default legacy score parameters stamped on a fresh chart's combo notes. They are
 * uniform per chart; the live Shinuchi engine ignores them, so any sane pair of
 * multiples-of-10 works (they only feed the derived `dummyData` ceiling).
 */
export const DEFAULT_SCORE_BASE = 100; // 初項
export const DEFAULT_SCORE_DIFF = 100; // 公差

export interface ChartScoring {
  /** 初項 — base score per combo note. */
  base: number;
  /** 公差 — per-10-combo increment. */
  diff: number;
}

export const DEFAULT_CHART_SCORING: ChartScoring = { base: DEFAULT_SCORE_BASE, diff: DEFAULT_SCORE_DIFF };

function makeBlankBranch(): FumenBranch {
  return { padding: 0, speed: 1, notes: [] };
}

/** One empty measure: no notes, barline drawn, no go-go, not a branch point. */
export function makeBlankMeasure(bpm = DEFAULT_BPM): FumenMeasure {
  return {
    bpm,
    offset: 0,
    gogo: 0,
    barline: 1,
    padding1: 0,
    branchInfo: [-1, -1, -1, -1, -1, -1],
    padding2: 0,
    branches: [makeBlankBranch(), makeBlankBranch(), makeBlankBranch()],
  };
}

export interface BlankFumenOptions {
  bpm?: number;
  measureCount?: number;
  /** Star rating, which keys the soul gauge. Defaults to the difficulty's norm. */
  star?: number;
}

/**
 * A blank, playable chart for one difficulty: a header with the difficulty's exact
 * timing windows and a note-count-scaled soul gauge (empty → gauge for 0 notes,
 * refreshed as notes are added), plus `measureCount` empty measures. `dummyData`
 * starts at 0 (no notes). Encodes byte-clean — round-trips through the codec.
 */
export function makeBlankFumen(difficulty: FumenDifficulty, opts: BlankFumenOptions = {}): Fumen {
  const bpm = opts.bpm ?? DEFAULT_BPM;
  const measureCount = Math.max(1, Math.floor(opts.measureCount ?? DEFAULT_MEASURE_COUNT));
  const header = makeFumenHeader({
    timingWindows: timingWindowsForDifficulty(difficulty),
    ...soulGaugeDefaults(difficulty, 0, opts.star),
    measureCount,
  });
  const measures: FumenMeasure[] = [];
  for (let i = 0; i < measureCount; i++) measures.push(makeBlankMeasure(bpm));
  return { header, measures, trailer: new Uint8Array(0) };
}

/** Tap (combo) notes on the score branch — the count the soul gauge scales to. */
export function tapNoteCount(fumen: Fumen): number {
  const bi = scoreBranchIndex(fumen);
  let n = 0;
  for (const measure of fumen.measures) {
    for (const note of measure.branches[bi].notes) {
      if (!BALLOON_TYPES.has(note.type) && !DRUMROLL_TYPES.has(note.type)) n++;
    }
  }
  return n;
}

/**
 * Read the chart-wide legacy score params (初項 base / 公差 step) off the notes.
 * Uniform per chart, so the first note carrying each is representative; balloons
 * (whose `scoreInit` is a hit count) and fresh 0-value notes are skipped. A field
 * is `undefined` when no note carries it (an empty or all-fresh chart).
 */
export function readChartScoring(fumen: Fumen): { base?: number; step?: number } {
  let base: number | undefined;
  let step: number | undefined;
  for (const measure of fumen.measures) {
    for (const branch of measure.branches) {
      for (const note of branch.notes) {
        if (BALLOON_TYPES.has(note.type)) continue;
        if (base === undefined && note.scoreInit > 0) base = note.scoreInit;
        if (step === undefined && note.scoreDiff > 0 && !DRUMROLL_TYPES.has(note.type)) step = note.scoreDiff;
        if (base !== undefined && step !== undefined) return { base, step };
      }
    }
  }
  return { base, step };
}

/** The chart's scoring with the authoring defaults filled in — for stamping notes. */
export function chartScoringOrDefault(fumen: Fumen): ChartScoring {
  const { base, step } = readChartScoring(fumen);
  return { base: base ?? DEFAULT_SCORE_BASE, diff: step ?? DEFAULT_SCORE_DIFF };
}

function stampNote(note: FumenNote, base: number, diff: number): FumenNote {
  // Balloons keep their hit count in scoreInit and carry no diff (0 on all 7,088
  // corpus balloons). Every other note — drumrolls included — carries the same
  // base+diff pair as the taps: 2,786 of the 2,798 corpus charts with drumrolls
  // stamp them exactly like taps, and none of the 16,401 drumrolls carries a value
  // that isn't a multiple of ten.
  if (BALLOON_TYPES.has(note.type)) {
    return note.scoreDiff === 0 ? note : { ...note, scoreDiff: 0 };
  }
  if (note.scoreInit === base && note.scoreDiff === diff) return note;
  return { ...note, scoreInit: base, scoreDiff: diff };
}

/**
 * Stamp the chart's uniform legacy score base/diff onto every note across all
 * branches (matching the corpus, where they are chart-wide constants). Returns a
 * new Fumen; the input is not mutated.
 */
export function stampChartScoring(fumen: Fumen, scoring: ChartScoring = DEFAULT_CHART_SCORING): Fumen {
  const { base, diff } = scoring;
  const measures = fumen.measures.map((measure) => ({
    ...measure,
    branches: measure.branches.map((branch) => ({
      ...branch,
      notes: branch.notes.map((note) => stampNote(note, base, diff)),
    })) as [FumenBranch, FumenBranch, FumenBranch],
  }));
  return { ...fumen, measures };
}

/** Header with `dummyData` (+`measureCount`) resynced to the current notes. Safe
 *  for any chart — `dummyData` is a derived value, so this only ever corrects it. */
export function withScoreCeiling(fumen: Fumen): Fumen {
  const header: FumenHeader = {
    ...fumen.header,
    dummyData: computeScoreCeiling(fumen),
    measureCount: fumen.measures.length,
  };
  return { ...fumen, header };
}

/**
 * Full authoring refresh for a chart being built from scratch: (re)stamp the score
 * base/diff, rescale the soul gauge to the tap count and `star` rating, and resync
 * `dummyData` / `measureCount`. Intended for authored charts — it recomputes the
 * gauge, so do **not** run it on a shipped chart whose hand-tuned gauge should be
 * preserved (use `withScoreCeiling` there).
 */
export function refreshChartDerivedHeader(
  fumen: Fumen,
  difficulty: FumenDifficulty,
  scoring: ChartScoring = DEFAULT_CHART_SCORING,
  star?: number,
): Fumen {
  const stamped = stampChartScoring(fumen, scoring);
  const header: FumenHeader = {
    ...stamped.header,
    ...soulGaugeDefaults(difficulty, tapNoteCount(stamped), star),
    dummyData: computeScoreCeiling(stamped),
    measureCount: stamped.measures.length,
  };
  return { ...stamped, header };
}

/**
 * The full set of created-chart records for a brand-new difficulty: one blank
 * chart per player variant (`single`, `p1`, `p2`), upholding the corpus invariant
 * that every present difficulty carries all three variants. Mirrors the Ura clone
 * path (fumenSlots.ts) but builds blank charts instead of cloning.
 */
export function blankFumenSlotSet(
  songId: string,
  difficulty: FumenDifficulty,
  opts: BlankFumenOptions = {},
): CreatedFumen[] {
  return PLAYER_ORDER.map((player) => {
    const slot: FumenSlot = { difficulty, player, filename: fumenFilename(songId, difficulty, player) };
    return { songId, slot, fumen: makeBlankFumen(difficulty, opts) };
  });
}
