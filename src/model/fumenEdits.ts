import {
  DRUMROLL_NOTE_TYPES,
  Fumen,
  FumenBranch,
  FumenHeader,
  FumenMeasure,
  FumenNote,
} from '../codec';
import {
  fallbackMeasureDurationMs,
  measureDurationAt,
  measureTimings,
  NOMINAL_MEASURE_BEATS,
} from './fumenTiming';

export type ChartTool =
  | 'select'
  | 'don'
  | 'ka'
  | 'donbig'
  | 'kabig'
  | 'roll'
  | 'rollbig'
  | 'balloon'
  | 'kusudama'
  | 'eraser';

export type ChartPlacementTool = 'don' | 'ka' | 'donbig' | 'kabig' | 'roll' | 'rollbig' | 'balloon' | 'kusudama';

/**
 * Every note type the editor can author/convert to, with a UI label. Covers all
 * of `FUMEN_NOTE_TYPE_NAMES` (the special `wii5op` medley ids are preserve-only,
 * so they're excluded). The Inspector type dropdown renders this list, and
 * `test/model/fumen-edits.test.ts` asserts it stays in sync with the codec's
 * named types so no editable type is ever silently unreachable.
 *
 * Labels carry the in-game onomatopoeia (the kana the game shows for each note)
 * plus an English gloss. The small Don/Ka alternatives are displayed
 * onomatopoeic labels for the same hit class, not distinct hit samples
 * (ドン / ド / コ; カッ / カ).
 *
 * 0xb (DON2) / 0xd (KA2) are **"both-players" co-op notes** (双人 / 2P-session) —
 * *not* a sound variant and *not* a "both-hands" hard hit (arcade drums are
 * force-sensitive; there is no two-stick distinction). They render and sound
 * exactly like the ordinary big Don/Ka (0x7/0x8), so the game shows the same kana
 * ドン(大) / カッ(大). In 2-player mode both players must hit them together —
 * verified in the corpus: across every co-op chart, a 0xb/0xd in player 1's chart
 * lands at the same time as a note in player 2's (100%), almost always the same
 * both-note (99%). In solo play the game's `ReplaceOnpuForSinglePlayer` routine
 * swaps them for a normal big note. (TJA notes A/B; tja2fumen labels the id
 * "hands" from the console heritage, but in this arcade game it is two-player.)
 * Identical big red/blue notes — not the purple kadon.
 */
export const NOTE_TYPE_CHOICES: { value: number; label: string }[] = [
  { value: 0x1, label: 'ドン (Don)' },
  { value: 0x2, label: 'ド (Don alt)' },
  { value: 0x3, label: 'コ (Don alt)' },
  { value: 0x4, label: 'カッ (Ka)' },
  { value: 0x5, label: 'カ (Ka alt)' },
  { value: 0x7, label: 'ドン(大) Big Don' },
  { value: 0xb, label: 'ドン(大) Big Don · both-players' },
  { value: 0x8, label: 'カッ(大) Big Ka' },
  { value: 0xd, label: 'カッ(大) Big Ka · both-players' },
  { value: 0x6, label: 'Drumroll' },
  { value: 0x9, label: 'Big Drumroll' },
  { value: 0xa, label: 'Balloon' },
  { value: 0xc, label: 'Kusudama' },
];

export interface ChartNoteRef {
  measureIndex: number;
  branchIndex: 0 | 1 | 2;
  noteIndex: number;
}

export type BranchInfo = [number, number, number, number, number, number];

/** A measure is a branch decision point when its branchInfo carries real
 *  thresholds (the corpus uses [-1×6] for every non-branch-start measure). */
export function isBranchPoint(measure: Pick<FumenMeasure, 'branchInfo'>): boolean {
  return measure.branchInfo.some((v) => v >= 0);
}

/**
 * Whether the editor should treat a chart as branched (render 3 stacked staves,
 * show the branch-focus segment, allow per-branch editing). True when the stored
 * header `hasBranches` flag is on OR the Expert/Master tracks already carry notes
 * — the corpus has 39 charts where the two disagree, and flipping the flag on
 * (Phase 8.5) is how a flat chart is turned into a branch-authoring surface.
 * Shared by the canvas, BranchSeg, and Inspector so all three agree on the rule.
 */
export function fumenIsBranched(f: Fumen): boolean {
  if (f.header.hasBranches !== 0) return true;
  return f.measures.some((m) => m.branches[1].notes.length > 0 || m.branches[2].notes.length > 0);
}

/** Default thresholds when turning a measure into a branch point: 1 drumroll
 *  to advance, 2 to master — the simplest drumroll-count gate seen in the corpus. */
export const DEFAULT_BRANCH_INFO: BranchInfo = [1, 2, 1, 2, 1, 2];
export const CLEARED_BRANCH_INFO: BranchInfo = [-1, -1, -1, -1, -1, -1];

/**
 * A selected measure (Phase 11). `branchIndex` is undefined for a measure-level
 * selection (edits every branch / all-branch helpers); a number narrows to one
 * stave for branch-specific scroll-speed edits (set by branch focus).
 */
export interface ChartMeasureRef {
  measureIndex: number;
  branchIndex?: 0 | 1 | 2;
}

/** Measure-level fields editable in one patch (BPM/offset/GO-GO/barline). */
export interface MeasurePatch {
  bpm?: number;
  offset?: number;
  gogo?: number | boolean;
  barline?: number | boolean;
}

/** A branch stave (0/1/2) or every rendered branch ('all') for scroll-speed edits. */
export type SpeedTarget = 0 | 1 | 2 | 'all';

export interface PlaceChartNoteInput {
  measureIndex: number;
  branchIndex: 0 | 1 | 2;
  position: number;
  tool: ChartPlacementTool;
  shiftKey?: boolean;
  duration?: number;
  balloonCount?: number;
  /**
   * "Replace the existing note at this slot" modifier (Phase 9.2). When set, the
   * nearest same-branch note within this ms window of `position` is removed
   * before the new note is inserted, so re-placing on top of a note swaps it
   * instead of stacking a duplicate. Omitted = stack (the default).
   */
  replaceWithinMs?: number;
}

export interface FumenEditResult {
  fumen: Fumen;
  selection?: ChartNoteRef;
}

const DRUMROLL_SUFFIX_BYTES = 8;
const BALLOON_DEFAULT_COUNT = 10;
/** Float slack (ms) when deciding a note head sits past a measure boundary. */
const POSITION_TOLERANCE_MS = 0.5;

export function isPlacementTool(tool: ChartTool): tool is ChartPlacementTool {
  return tool === 'don'
    || tool === 'ka'
    || tool === 'donbig'
    || tool === 'kabig'
    || tool === 'roll'
    || tool === 'rollbig'
    || tool === 'balloon'
    || tool === 'kusudama';
}

export function isLongPlacementTool(tool: ChartTool): tool is 'roll' | 'rollbig' | 'balloon' | 'kusudama' {
  return tool === 'roll' || tool === 'rollbig' || tool === 'balloon' || tool === 'kusudama';
}

export function measureDurationMs(measure: Pick<FumenMeasure, 'bpm'>): number {
  return fallbackMeasureDurationMs(measure);
}

export function noteTypeForTool(tool: ChartPlacementTool, shiftKey = false): number {
  switch (tool) {
    case 'don': return shiftKey ? 0x7 : 0x1;
    case 'ka': return shiftKey ? 0x8 : 0x4;
    case 'donbig': return 0x7;
    case 'kabig': return 0x8;
    case 'roll': return shiftKey ? 0x9 : 0x6;
    case 'rollbig': return 0x9;
    case 'balloon': return shiftKey ? 0xc : 0xa;
    case 'kusudama': return 0xc;
  }
}

export function isLongNoteType(type: number): boolean {
  return DRUMROLL_NOTE_TYPES.has(type) || type === 0xa || type === 0xc;
}

function normalizePosition(position: number, duration: number): number {
  if (!Number.isFinite(position)) return 0;
  if (position < 0) return 0;
  if (position > duration) return duration;
  return position;
}

function defaultLongDuration(measureDuration: number): number {
  return Math.max(1, measureDuration / NOMINAL_MEASURE_BEATS);
}

function normalizeLongDuration(duration: number | undefined, measureDuration: number): number {
  if (duration === undefined || !Number.isFinite(duration) || duration <= 0) return defaultLongDuration(measureDuration);
  return Math.max(1, duration);
}

function cloneDrumrollSuffix(note: FumenNote): Uint8Array | undefined {
  if (!note.drumrollSuffix) return undefined;
  return note.drumrollSuffix.slice();
}

function makeNote(tool: ChartPlacementTool, measureDuration: number, input: PlaceChartNoteInput): FumenNote {
  const type = noteTypeForTool(tool, input.shiftKey);
  const isBalloonType = type === 0xa || type === 0xc;
  const note: FumenNote = {
    type,
    position: normalizePosition(input.position, measureDuration),
    item: 0,
    padding: 0,
    scoreInit: isBalloonType ? (input.balloonCount ?? BALLOON_DEFAULT_COUNT) : 0,
    scoreDiff: 0,
    duration: isLongNoteType(type) ? normalizeLongDuration(input.duration, measureDuration) : 0,
  };
  if (DRUMROLL_NOTE_TYPES.has(type)) {
    note.drumrollSuffix = new Uint8Array(DRUMROLL_SUFFIX_BYTES);
  }
  return note;
}

function validRef(fumen: Fumen, ref: ChartNoteRef): boolean {
  const measure = fumen.measures[ref.measureIndex];
  if (!measure) return false;
  const branch = measure.branches[ref.branchIndex];
  if (!branch) return false;
  return ref.noteIndex >= 0 && ref.noteIndex < branch.notes.length;
}

function replaceMeasure(fumen: Fumen, measureIndex: number, measure: FumenMeasure): Fumen {
  const measures = fumen.measures.slice();
  measures[measureIndex] = measure;
  return { ...fumen, measures };
}

function replaceBranchNotes(
  fumen: Fumen,
  measureIndex: number,
  branchIndex: 0 | 1 | 2,
  notes: FumenNote[],
): Fumen {
  const measures = fumen.measures.slice();
  const measure = measures[measureIndex];
  const branches = measure.branches.slice() as [FumenBranch, FumenBranch, FumenBranch];
  branches[branchIndex] = { ...branches[branchIndex], notes };
  measures[measureIndex] = { ...measure, branches };
  return { ...fumen, measures };
}

function sortNotes(notes: FumenNote[]): FumenNote[] {
  return notes.slice().sort((a, b) => {
    const pos = a.position - b.position;
    if (Math.abs(pos) > 0.0001) return pos;
    return a.type - b.type;
  });
}

export function getChartNote(fumen: Fumen, ref?: ChartNoteRef): FumenNote | undefined {
  if (!ref || !validRef(fumen, ref)) return undefined;
  return fumen.measures[ref.measureIndex].branches[ref.branchIndex].notes[ref.noteIndex];
}

export function getChartMeasure(fumen: Fumen, ref?: ChartMeasureRef): FumenMeasure | undefined {
  if (!ref) return undefined;
  return fumen.measures[ref.measureIndex];
}

/**
 * Index of the note nearest `position` whose distance is within `withinMs`, or
 * -1 if none qualifies. Used by the "replace note at slot" placement modifier.
 */
function nearestNoteIndexWithin(notes: FumenNote[], position: number, withinMs: number): number {
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < notes.length; i++) {
    const dist = Math.abs(notes[i].position - position);
    if (dist <= withinMs && dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}

export function insertChartNote(fumen: Fumen, input: PlaceChartNoteInput): FumenEditResult {
  const measure = fumen.measures[input.measureIndex];
  if (!measure) return { fumen };
  const branch = measure.branches[input.branchIndex];
  if (!branch) return { fumen };
  const note = makeNote(input.tool, measureDurationAt(fumen, input.measureIndex), input);
  let existing = branch.notes;
  // "Replace note at slot": drop the nearest note already sitting at this snapped
  // position so re-placing swaps it rather than stacking a duplicate.
  if (input.replaceWithinMs !== undefined && input.replaceWithinMs >= 0) {
    const target = nearestNoteIndexWithin(existing, note.position, input.replaceWithinMs);
    if (target >= 0) existing = existing.filter((_note, i) => i !== target);
  }
  const notes = sortNotes([...existing, note]);
  const noteIndex = notes.indexOf(note);
  return {
    fumen: replaceBranchNotes(fumen, input.measureIndex, input.branchIndex, notes),
    selection: { measureIndex: input.measureIndex, branchIndex: input.branchIndex, noteIndex },
  };
}

export function removeChartNote(fumen: Fumen, ref: ChartNoteRef): FumenEditResult {
  if (!validRef(fumen, ref)) return { fumen };
  const measure = fumen.measures[ref.measureIndex];
  const branch = measure.branches[ref.branchIndex];
  const notes = branch.notes.filter((_note, i) => i !== ref.noteIndex);
  return {
    fumen: replaceBranchNotes(fumen, ref.measureIndex, ref.branchIndex, notes),
  };
}

/**
 * Remove several notes in one transform (drag-rect multi-select delete). Indices
 * are grouped per measure/branch and filtered in a single pass, so the noteIndex
 * values stay valid against the original arrays (no index-shift hazard).
 */
export function removeChartNotes(fumen: Fumen, refs: ChartNoteRef[]): FumenEditResult {
  const byBranch = new Map<string, Set<number>>();
  for (const ref of refs) {
    if (!validRef(fumen, ref)) continue;
    const key = `${ref.measureIndex}:${ref.branchIndex}`;
    let set = byBranch.get(key);
    if (!set) {
      set = new Set();
      byBranch.set(key, set);
    }
    set.add(ref.noteIndex);
  }
  if (byBranch.size === 0) return { fumen };
  let next = fumen;
  for (const [key, indices] of byBranch) {
    const [mi, bi] = key.split(':').map(Number) as [number, 0 | 1 | 2];
    const notes = next.measures[mi].branches[bi].notes.filter((_note, i) => !indices.has(i));
    next = replaceBranchNotes(next, mi, bi, notes);
  }
  return { fumen: next };
}

function normalizeUpdatedNote(note: FumenNote, measureDuration: number): FumenNote {
  const next: FumenNote = {
    ...note,
    position: normalizePosition(note.position, measureDuration),
  };
  if (isLongNoteType(next.type)) {
    next.duration = normalizeLongDuration(next.duration, measureDuration);
    if (next.type === 0xa || next.type === 0xc) {
      next.scoreInit = Math.max(1, Math.round(next.scoreInit || BALLOON_DEFAULT_COUNT));
    }
    if (DRUMROLL_NOTE_TYPES.has(next.type)) {
      next.drumrollSuffix = cloneDrumrollSuffix(next) ?? new Uint8Array(DRUMROLL_SUFFIX_BYTES);
    } else {
      delete next.drumrollSuffix;
    }
  } else {
    next.duration = 0;
    delete next.drumrollSuffix;
  }
  return next;
}

export function updateChartNote(
  fumen: Fumen,
  ref: ChartNoteRef,
  patch: Partial<FumenNote>,
): FumenEditResult {
  if (!validRef(fumen, ref)) return { fumen };
  const measure = fumen.measures[ref.measureIndex];
  const branch = measure.branches[ref.branchIndex];
  const original = branch.notes[ref.noteIndex];
  const updated = normalizeUpdatedNote({ ...original, ...patch }, measureDurationAt(fumen, ref.measureIndex));
  const notes = sortNotes(branch.notes.map((note, i) => (i === ref.noteIndex ? updated : note)));
  const noteIndex = notes.indexOf(updated);
  return {
    fumen: replaceBranchNotes(fumen, ref.measureIndex, ref.branchIndex, notes),
    selection: { measureIndex: ref.measureIndex, branchIndex: ref.branchIndex, noteIndex },
  };
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function positiveOr(value: number, fallback: number, min = 0.001): number {
  return Math.max(min, finiteOr(value, fallback));
}

function binary(value: number | boolean): 0 | 1 {
  return value ? 1 : 0;
}

// ── Measure-first event editing (Phase 11) ────────────────────────────────
//
// The fumen format stores BPM, offset, GO-GO, barline, branch thresholds, and
// per-branch scroll speed as measure/branch fields, not as separate event
// records. These transforms edit those fields on a selected measure directly.
// They all keep the byte-level draft/dirty pipeline (a no-op patch returns the
// same fumen ref so the store skips the history push).

/** Set measure-level fields (BPM/offset/GO-GO/barline) on one measure. */
export function updateMeasureProperties(
  fumen: Fumen,
  measureIndex: number,
  patch: MeasurePatch,
): FumenEditResult {
  const measure = fumen.measures[measureIndex];
  if (!measure) return { fumen };
  let next: FumenMeasure = measure;
  if (patch.bpm !== undefined) next = { ...next, bpm: positiveOr(patch.bpm, next.bpm, 1) };
  if (patch.offset !== undefined) next = { ...next, offset: finiteOr(patch.offset, next.offset) };
  if (patch.gogo !== undefined) next = { ...next, gogo: binary(patch.gogo) };
  if (patch.barline !== undefined) next = { ...next, barline: binary(patch.barline) };
  if (next === measure) return { fumen };
  return { fumen: replaceMeasure(fumen, measureIndex, next) };
}

/**
 * Nudge the chart's audio offset to `newOffsetMs` (the rounded value the Sound
 * tab shows). The stored per-measure `offset` column does double duty: `offset[0]`
 * is the chart's audio anchor, while every measure's *length* is encoded as the
 * gap to the next measure's offset. So a global offset change must add the same
 * delta to EVERY measure — rewriting only measure 0 would shrink/stretch measure
 * 0 and leave the rest of the chart pinned to the audio (only the first measure
 * would move). See `chartIntroDelayMs`/`measureTimings` in fumenTiming.ts: a
 * measure's judged time is `offset[i] + 4*beatMs(bpm[i])`.
 *
 * The delta is measured from the *rounded* current offset, and applied additively
 * to the full-precision (float32-decoded) values, so the stored sub-millisecond
 * fraction is preserved. Nudging away and back therefore restores the exact
 * original bytes — no phantom "edited" state.
 */
export function setChartAudioOffset(fumen: Fumen, newOffsetMs: number): FumenEditResult {
  const first = fumen.measures[0];
  if (!first) return { fumen };
  const current = Number.isFinite(first.offset) ? first.offset : 0;
  const delta = newOffsetMs - Math.round(current);
  if (!Number.isFinite(delta) || delta === 0) return { fumen };
  const measures = fumen.measures.map((m) =>
    Number.isFinite(m.offset) ? { ...m, offset: m.offset + delta } : m,
  );
  return { fumen: { ...fumen, measures } };
}

/**
 * "BPM changes here" override. `on:true` with a value sets this measure's BPM
 * (making it differ from the previous measure → the badge appears). `on:false`
 * copies the previous measure's BPM, removing the change. Measure 0 carries the
 * chart's base BPM, so `on:false` there is a no-op (nothing to inherit).
 */
export function setMeasureBpmOverride(
  fumen: Fumen,
  measureIndex: number,
  on: boolean,
  value?: number,
): FumenEditResult {
  const measure = fumen.measures[measureIndex];
  if (!measure) return { fumen };
  let nextBpm: number;
  if (on) {
    if (value === undefined) return { fumen };
    nextBpm = positiveOr(value, measure.bpm, 1);
  } else {
    const prev = fumen.measures[measureIndex - 1];
    if (!prev) return { fumen };
    nextBpm = prev.bpm;
  }
  if (nextBpm === measure.bpm) return { fumen };
  return { fumen: replaceMeasure(fumen, measureIndex, { ...measure, bpm: nextBpm }) };
}

/**
 * Per-branch scroll-speed override. `target` is a branch stave (0/1/2) or 'all'
 * (every branch). `on:true` with a value sets the speed; `on:false` copies the
 * previous measure's speed for each target branch. Measure 0 holds base speeds,
 * so `on:false` there is a no-op.
 */
export function setBranchSpeedOverride(
  fumen: Fumen,
  measureIndex: number,
  target: SpeedTarget,
  on: boolean,
  value?: number,
): FumenEditResult {
  const measure = fumen.measures[measureIndex];
  if (!measure) return { fumen };
  const prev = fumen.measures[measureIndex - 1];
  const branches = measure.branches.slice() as [FumenBranch, FumenBranch, FumenBranch];
  const indices: (0 | 1 | 2)[] = target === 'all' ? [0, 1, 2] : [target];
  let changed = false;
  for (const b of indices) {
    let nextSpeed: number;
    if (on) {
      if (value === undefined) continue;
      nextSpeed = positiveOr(value, branches[b].speed);
    } else {
      if (!prev) continue;
      nextSpeed = prev.branches[b].speed;
    }
    if (nextSpeed !== branches[b].speed) {
      branches[b] = { ...branches[b], speed: nextSpeed };
      changed = true;
    }
  }
  if (!changed) return { fumen };
  return { fumen: replaceMeasure(fumen, measureIndex, { ...measure, branches }) };
}

/** Toggle GO-GO time on a measure (an explicit measure-local state). */
export function setMeasureGogo(fumen: Fumen, measureIndex: number, on: boolean): FumenEditResult {
  return updateMeasureProperties(fumen, measureIndex, { gogo: on });
}

/** Toggle the measure's barline (an explicit measure-local state). */
export function setMeasureBarline(fumen: Fumen, measureIndex: number, on: boolean): FumenEditResult {
  return updateMeasureProperties(fumen, measureIndex, { barline: on });
}

/** Replace the measure's 6 branch thresholds: [N→E, N→M, E→E, E→M, M→E, M→M]. */
export function setMeasureBranchInfo(
  fumen: Fumen,
  measureIndex: number,
  branchInfo: BranchInfo,
): FumenEditResult {
  const measure = fumen.measures[measureIndex];
  if (!measure) return { fumen };
  const next = branchInfo.map((v) => (Number.isFinite(v) ? Math.round(v) : -1)) as BranchInfo;
  if (next.every((v, i) => v === measure.branchInfo[i])) return { fumen };
  return { fumen: replaceMeasure(fumen, measureIndex, { ...measure, branchInfo: next }) };
}

// ── Measure duration / offset authoring (Phase 12) ─────────────────────────
//
// The fumen format has no standalone measure-length field — a measure's real
// duration is the gap between consecutive stored `offset` values (bias-corrected
// at BPM boundaries; see model/fumenTiming.ts). So "editing a measure's length"
// means moving the boundary that follows it, which ripples every later offset.

/** How notes inside a shrunk measure are handled (Phase 12.6). */
export type NotePositionPolicy = 'block' | 'scale' | 'truncate';

/** Smallest editable measure duration (ms) — a gimmick floor so a length edit
 *  can't collapse a measure to zero/negative (Phase 12.7). */
export const MIN_EDITABLE_MEASURE_MS = 1;

/**
 * Whether a measure's real duration is independently editable:
 *  - the chart's offset column must be usable (so duration is offset-derived,
 *    not the BPM fallback — otherwise length is a pure function of BPM); and
 *  - it can't be the last measure (no following offset boundary to move; its
 *    length is the four-beat fallback — Phase 12.8).
 */
export function canEditMeasureDuration(
  fumen: Fumen,
  measureIndex: number,
): { ok: boolean; reason?: string } {
  const n = fumen.measures.length;
  if (measureIndex < 0 || measureIndex >= n) return { ok: false, reason: 'No such measure.' };
  if (measureIndex === n - 1) {
    return {
      ok: false,
      reason: 'The last measure has no following offset boundary, so its length is the 4-beat fallback.',
    };
  }
  if (!measureTimings(fumen).derived) {
    return {
      ok: false,
      reason: "This chart's offset column isn't usable, so durations are BPM-derived — change BPM to adjust length.",
    };
  }
  return { ok: true };
}

/** Number of note heads in `measureIndex` that would fall past a `newDurationMs`
 *  span (rolls may legally spill, so only the head position is counted). Lets the
 *  UI prompt for a scale-or-cancel choice before a shrink. */
export function measureOverflowCount(fumen: Fumen, measureIndex: number, newDurationMs: number): number {
  const measure = fumen.measures[measureIndex];
  if (!measure) return 0;
  const limit = newDurationMs + POSITION_TOLERANCE_MS;
  let count = 0;
  for (const branch of measure.branches) {
    for (const note of branch.notes) if (note.position > limit) count++;
  }
  return count;
}

function scaleMeasureNotes(measure: FumenMeasure, ratio: number): FumenMeasure {
  const branches = measure.branches.map((b) => ({
    ...b,
    notes: b.notes.map((note) => {
      const next: FumenNote = { ...note, position: note.position * ratio };
      if (isLongNoteType(note.type)) next.duration = note.duration * ratio;
      const suffix = cloneDrumrollSuffix(note);
      if (suffix) next.drumrollSuffix = suffix;
      return next;
    }),
  })) as [FumenBranch, FumenBranch, FumenBranch];
  return { ...measure, branches };
}

/** Drop note heads that fall past a `newDurationMs` span (the overflow counted by
 *  `measureOverflowCount`), leaving the surviving notes at their current
 *  positions. Used by the 'truncate' shrink policy. */
function truncateMeasureNotes(measure: FumenMeasure, newDurationMs: number): FumenMeasure {
  const limit = newDurationMs + POSITION_TOLERANCE_MS;
  const branches = measure.branches.map((b) => ({
    ...b,
    notes: b.notes.filter((note) => note.position <= limit),
  })) as [FumenBranch, FumenBranch, FumenBranch];
  return { ...measure, branches };
}

/**
 * Edit one measure's real duration (Phase 12.4, ripple semantics). Changing
 * measure `i`'s length to `newDurationMs` shifts every downstream measure's
 * stored offset by the same delta, so downstream durations and each note's
 * within-measure ms position are preserved — the whole tail of the chart slides
 * together and the Sound-tab playhead stays consistent. Measure 0's stored
 * offset (the chart/audio offset) is never moved here, even when editing measure
 * 0; only offsets after the edited measure shift.
 *
 * Notes inside the edited measure follow `policy`:
 *  - 'block' (default): if shrinking would push a note head past the new span,
 *    the edit is refused (returns the same fumen ref). The caller should
 *    pre-check with `measureOverflowCount` and offer 'scale'/'truncate'.
 *  - 'scale': ratio-scale note positions (and long-note durations) into the new
 *    span so nothing overflows.
 *  - 'truncate': delete the note heads that fall past the new span, leaving the
 *    surviving notes where they are.
 *
 * No-op edits (last measure, BPM-derived chart, sub-floor duration, unchanged
 * length, or a blocked shrink) return the same fumen ref so the store skips the
 * history push.
 */
export function setMeasureDuration(
  fumen: Fumen,
  measureIndex: number,
  newDurationMs: number,
  policy: NotePositionPolicy = 'block',
): FumenEditResult {
  const n = fumen.measures.length;
  if (measureIndex < 0 || measureIndex >= n - 1) return { fumen };
  const measure = fumen.measures[measureIndex];
  if (!measure) return { fumen };
  if (!Number.isFinite(newDurationMs) || newDurationMs < MIN_EDITABLE_MEASURE_MS) return { fumen };
  const timing = measureTimings(fumen);
  if (!timing.derived) return { fumen };
  const oldDuration = timing.durations[measureIndex];
  const delta = newDurationMs - oldDuration;
  if (Math.abs(delta) < 1e-6) return { fumen };

  const measures = fumen.measures.slice();
  if (policy === 'scale') {
    measures[measureIndex] = scaleMeasureNotes(measure, newDurationMs / oldDuration);
  } else if (policy === 'truncate') {
    measures[measureIndex] = truncateMeasureNotes(measure, newDurationMs);
  } else if (measureOverflowCount(fumen, measureIndex, newDurationMs) > 0) {
    return { fumen }; // blocked: caller should offer 'scale'/'truncate'
  }
  for (let i = measureIndex + 1; i < n; i++) {
    measures[i] = { ...measures[i], offset: measures[i].offset + delta };
  }
  return { fumen: { ...fumen, measures } };
}

// ── Header (chart properties) editing — Phase 8.5 ──────────────────────────

const INT32_MIN = -0x80000000;
const INT32_MAX = 0x7fffffff;

function clampInt32(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(INT32_MIN, Math.min(INT32_MAX, Math.round(value)));
}

/**
 * The header i32 fields the editor may change. Deliberately excludes:
 *   - `measureCount` — structural; it must equal `measures.length` or the next
 *     decode reads the wrong number of measures. The codec writes it verbatim.
 *   - `dummyData` / `unknownData` — named but gameplay meaning unconfirmed;
 *     preserved verbatim (read-only in the UI).
 * `hasBranches` is handled on its own (coerced to 0/1). `timingWindows` are not
 * edited here — their per-index meaning is unconfirmed, so the panel shows them
 * read-only. See codec/fumen/spec.md.
 */
export const EDITABLE_HEADER_INT_KEYS = [
  'hpMax',
  'hpClear',
  'hpGainGood',
  'hpGainOk',
  'hpLossBad',
  'normalNormalRatio',
  'normalProfessionalRatio',
  'normalMasterRatio',
  'branchPtsGood',
  'branchPtsOk',
  'branchPtsBad',
  'branchPtsDrumroll',
  'branchPtsGoodBig',
  'branchPtsOkBig',
  'branchPtsDrumrollBig',
  'branchPtsBalloon',
  'branchPtsKusudama',
  'branchPtsUnknown',
] as const satisfies ReadonlyArray<keyof FumenHeader>;

export type EditableHeaderIntKey = (typeof EDITABLE_HEADER_INT_KEYS)[number];

/** Patch shape for the editable header fields (the only ones the UI sends). */
export type FumenHeaderPatch = Partial<Pick<FumenHeader, EditableHeaderIntKey | 'hasBranches'>>;

/**
 * Update the loaded chart's typed header. Only the editable fields are applied —
 * any other key on the patch is ignored, so the structural (`measureCount`) and
 * reserved (`dummyData`/`unknownData`/`timingWindows`) regions can never be
 * touched through this path. Int fields are rounded + clamped to i32 range;
 * `hasBranches` is coerced to 0/1. No-op patches return the same fumen ref so the
 * store skips the history push.
 */
export function updateFumenHeader(fumen: Fumen, patch: FumenHeaderPatch): FumenEditResult {
  const cur = fumen.header;
  const next: FumenHeader = { ...cur };
  let changed = false;
  if (patch.hasBranches !== undefined) {
    const v: 0 | 1 = patch.hasBranches ? 1 : 0;
    if (next.hasBranches !== v) {
      next.hasBranches = v;
      changed = true;
    }
  }
  for (const key of EDITABLE_HEADER_INT_KEYS) {
    const raw = patch[key];
    if (raw === undefined) continue;
    const v = clampInt32(Number(raw), cur[key]);
    if (next[key] !== v) {
      next[key] = v;
      changed = true;
    }
  }
  if (!changed) return { fumen };
  return { fumen: { ...fumen, header: next } };
}

function cloneFumenNote(note: FumenNote): FumenNote {
  const copy: FumenNote = { ...note };
  const suffix = cloneDrumrollSuffix(note);
  if (suffix) copy.drumrollSuffix = suffix;
  return copy;
}

/**
 * Author a branch on a (typically flat) chart: turn the header `hasBranches` flag
 * on and seed each measure's empty Expert/Master tracks with a copy of its Normal
 * notes, giving the user a real starting point to diverge from. Measures whose
 * Expert/Master already carry notes are left untouched, so an existing branched
 * chart is never clobbered. One undo step. A no-op (same fumen ref) if there is
 * nothing to seed and the flag is already on.
 */
export function seedBranchesFromNormal(fumen: Fumen): FumenEditResult {
  let touched = false;
  const measures = fumen.measures.map((m) => {
    const [normal, expert, master] = m.branches;
    if (expert.notes.length > 0 || master.notes.length > 0) return m;
    if (normal.notes.length === 0) return m;
    touched = true;
    return {
      ...m,
      branches: [
        normal,
        { ...expert, notes: normal.notes.map(cloneFumenNote) },
        { ...master, notes: normal.notes.map(cloneFumenNote) },
      ] as [FumenBranch, FumenBranch, FumenBranch],
    };
  });
  const header =
    fumen.header.hasBranches !== 0 ? fumen.header : { ...fumen.header, hasBranches: 1 };
  if (!touched && header === fumen.header) return { fumen };
  return { fumen: { ...fumen, measures: touched ? measures : fumen.measures, header } };
}

export function sameChartNoteRef(a?: ChartNoteRef, b?: ChartNoteRef): boolean {
  return !!a
    && !!b
    && a.measureIndex === b.measureIndex
    && a.branchIndex === b.branchIndex
    && a.noteIndex === b.noteIndex;
}

export function sameChartMeasureRef(a?: ChartMeasureRef, b?: ChartMeasureRef): boolean {
  return !!a
    && !!b
    && a.measureIndex === b.measureIndex
    && a.branchIndex === b.branchIndex;
}
