// Invariants checked on *edited* charts before a save is allowed (PLAN 3.7).
// Errors block the write; warnings are surfaced but don't block. We only ever
// validate charts the user actually touched — the on-disk corpus round-trips
// byte-perfect (Phase 0) but predates our edits, so flagging pre-existing quirks
// in untouched charts would be pure noise and could block an unrelated save.
//
// Placement/inspector edits already clamp positions and counts (model/fumenEdits),
// so a clean chart that goes through the UI stays clean; these checks are the
// backstop that catches a corrupt edit (or a future codec/edit bug) before it
// reaches disk, complementing the encoder self-check in fs/write.ts.

import type { Fumen, FumenMeasure } from '../codec';
import { DRUMROLL_NOTE_TYPES } from '../codec';
import { isLongNoteType } from './fumenEdits';
import { measureTimings } from './fumenTiming';
import type { ValidationIssue } from './validation';
import { type FumenBaseline, isFumenDirty } from './fumenDrafts';

/** Balloon + kusudama: their hit count lives in scoreInit and must be > 0. */
const BALLOON_TYPES = new Set<number>([0xa, 0xc]);

/** Float slack (ms) when checking a note sits inside its measure. */
const POSITION_TOLERANCE_MS = 1;

/** BPMs outside this band are almost certainly an accidental edit, not a chart. */
const BPM_WARN_MIN = 20;
const BPM_WARN_MAX = 1200;

/** Cap issues per chart so one pathological chart can't flood the dialog. */
const MAX_ISSUES_PER_CHART = 20;

function pushCapped(issues: ValidationIssue[], issue: ValidationIssue): void {
  if (issues.length < MAX_ISSUES_PER_CHART) issues.push(issue);
}

function validateMeasure(
  label: string,
  measure: FumenMeasure,
  measureNo: number,
  duration: number,
  issues: ValidationIssue[],
): void {
  if (!Number.isFinite(measure.bpm) || measure.bpm <= 0) {
    pushCapped(issues, {
      level: 'error',
      message: `${label}: measure ${measureNo} has invalid BPM ${measure.bpm}.`,
    });
    return; // a bad BPM makes the measure duration meaningless; skip note checks
  }
  if (measure.bpm < BPM_WARN_MIN || measure.bpm > BPM_WARN_MAX) {
    pushCapped(issues, {
      level: 'warn',
      message: `${label}: measure ${measureNo} BPM ${measure.bpm} looks extreme.`,
    });
  }

  for (const branch of measure.branches) {
    if (branch.speed === 0) {
      pushCapped(issues, {
        level: 'warn',
        message: `${label}: measure ${measureNo} has a 0× scroll speed (notes won't move).`,
      });
    }
    for (const note of branch.notes) {
      // 1. Note head must sit inside its measure (rolls may extend past the end,
      //    so only the start position is bounded).
      if (!Number.isFinite(note.position)
        || note.position < -POSITION_TOLERANCE_MS
        || note.position > duration + POSITION_TOLERANCE_MS) {
        pushCapped(issues, {
          level: 'error',
          message: `${label}: measure ${measureNo} has a note at ${Math.round(note.position)}ms outside the measure (0–${Math.round(duration)}ms).`,
        });
      }
      // 2. Long notes (drumroll/balloon) need a positive length — start before end.
      if (isLongNoteType(note.type) && (!Number.isFinite(note.duration) || note.duration <= 0)) {
        const kind = DRUMROLL_NOTE_TYPES.has(note.type) ? 'drumroll' : 'balloon';
        pushCapped(issues, {
          level: 'error',
          message: `${label}: measure ${measureNo} has a ${kind} with no length (duration ${note.duration}).`,
        });
      }
      // 3. Balloons/kusudama must have a hit count > 0.
      if (BALLOON_TYPES.has(note.type) && (!Number.isFinite(note.scoreInit) || note.scoreInit <= 0)) {
        pushCapped(issues, {
          level: 'error',
          message: `${label}: measure ${measureNo} has a balloon with a non-positive hit count (${note.scoreInit}).`,
        });
      }
    }
  }
}

/** Validate one chart's content. `label` is a display path like `fumen/<id>/<file>`. */
export function validateFumenChart(label: string, fumen: Fumen): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const timing = measureTimings(fumen);
  fumen.measures.forEach((measure, i) => {
    if (issues.length >= MAX_ISSUES_PER_CHART) return;
    validateMeasure(label, measure, i + 1, timing.durations[i], issues);
  });
  return issues;
}

/**
 * Validate every chart whose draft differs from its baseline (i.e. the charts a
 * save would actually write). Untouched charts are skipped. Issues from all
 * dirty charts are concatenated in a stable (songId, filename) order.
 */
export function validateDirtyFumens(
  baselines: Map<string, FumenBaseline>,
  drafts: Map<string, Fumen>,
): ValidationIssue[] {
  const dirty: { key: string; songId: string; filename: string; draft: Fumen }[] = [];
  for (const [key, draft] of drafts) {
    const baseline = baselines.get(key);
    if (!baseline) continue;
    if (!isFumenDirty(baseline.fumen, draft)) continue;
    dirty.push({ key, songId: baseline.songId, filename: baseline.slot.filename, draft });
  }
  dirty.sort((a, b) =>
    a.songId === b.songId ? a.filename.localeCompare(b.filename) : a.songId.localeCompare(b.songId),
  );
  const issues: ValidationIssue[] = [];
  for (const d of dirty) {
    issues.push(...validateFumenChart(`fumen/${d.songId}/${d.filename}`, d.draft));
  }
  return issues;
}
