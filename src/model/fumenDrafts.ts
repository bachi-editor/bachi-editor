// Fumen draft bookkeeping: the keys, dirty test, and semantic diff that let
// in-memory chart edits survive a slot switch and reach the save pipeline.
//
// Unlike datatables (JSON whose on-disk whitespace isn't reproducible), the
// fumen codec is byte-perfect by construction (Phase 0), so "dirty" is decided
// at the byte level: a draft differs from its baseline iff its re-encoded bytes
// differ. That same property means a saved fumen's bytes are deterministic, so
// re-baselining after save needs no disk read-back.

import { encodeFumen, Fumen, FumenMeasure } from '../codec';
import type { FumenSlot } from '../fs/fumens';
import type { FieldChange } from './diff';
import { beatMs, measureTimings } from './fumenTiming';

/** A fumen as first decoded from disk — the undo floor + diff baseline. */
export interface FumenBaseline {
  songId: string;
  slot: FumenSlot;
  /** Decoded chart, immutable. */
  fumen: Fumen;
  /** Original encrypted file bytes, kept so a draft can be shown without a re-read. */
  bytes: Uint8Array;
}

export interface FumenFileDiff {
  key: string;
  songId: string;
  filename: string;
  dirty: boolean;
  changes: FieldChange[];
  summary: string;
  /** Encoded-byte size delta (draft − baseline). */
  byteDelta: number;
}

/** Stable map key for a song's chart slot. */
export function fumenKey(songId: string, filename: string): string {
  return `${songId}/${filename}`;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** True when the draft's chart content differs from its baseline. */
export function isFumenDirty(baseline: Fumen, draft: Fumen): boolean {
  if (baseline === draft) return false;
  return !bytesEqual(encodeFumen(baseline), encodeFumen(draft));
}

interface ChartCounts {
  notes: number;
  drumrolls: number;
  balloons: number;
  measures: number;
}

const DRUMROLL_TYPES = new Set([0x6, 0x9]);
const BALLOON_TYPES = new Set([0xa, 0xc]);

function countMeasure(m: FumenMeasure, acc: ChartCounts): void {
  for (const branch of m.branches) {
    for (const n of branch.notes) {
      acc.notes++;
      if (DRUMROLL_TYPES.has(n.type)) acc.drumrolls++;
      else if (BALLOON_TYPES.has(n.type)) acc.balloons++;
    }
  }
}

function chartCounts(fumen: Fumen): ChartCounts {
  const acc: ChartCounts = { notes: 0, drumrolls: 0, balloons: 0, measures: fumen.measures.length };
  for (const m of fumen.measures) countMeasure(m, acc);
  return acc;
}

function statChange(label: string, from: number, to: number, out: FieldChange[]): void {
  if (from !== to) out.push({ label, from: String(from), to: String(to) });
}

/** Stored offset (ms) is changed beyond float-32 noise. */
function offsetChanged(a: FumenMeasure, b: FumenMeasure): boolean {
  return Math.abs(a.offset - b.offset) > 1e-3;
}

/**
 * Summarize measure-duration / offset edits (Phase 12.9). A duration edit ripples
 * a contiguous tail of stored offsets by a constant delta, so it's detectable
 * here without knowing the originating transform: the edited measure is the one
 * just before the first shifted offset, and the downstream count is how many
 * offsets moved. A pure BPM edit changes ms durations but never touches an
 * offset, so it produces no timing line. The global chart offset (measure 0's
 * stored offset, edited from the Sound tab) is reported on its own.
 */
function timingChanges(baseline: Fumen, draft: Fumen, out: FieldChange[]): void {
  const n = baseline.measures.length;
  if (n === 0 || draft.measures.length !== n) return;
  const shifted: number[] = [];
  for (let i = 0; i < n; i++) {
    if (offsetChanged(baseline.measures[i], draft.measures[i])) shifted.push(i);
  }
  if (shifted.length === 0) return;
  if (shifted[0] === 0) {
    out.push({
      label: 'chart offset',
      from: `${Math.round(baseline.measures[0].offset)} ms`,
      to: `${Math.round(draft.measures[0].offset)} ms`,
    });
    return;
  }
  const edited = shifted[0] - 1;
  const bt = measureTimings(baseline);
  const dt = measureTimings(draft);
  const fromBeats = bt.durations[edited] / beatMs(baseline.measures[edited].bpm);
  const toBeats = dt.durations[edited] / beatMs(draft.measures[edited].bpm);
  out.push({
    label: `measure ${edited + 1} length`,
    from: `${fromBeats.toFixed(2)}`,
    to: `${toBeats.toFixed(2)} beats`,
  });
  out.push({ label: 'downstream offsets', from: '0', to: `+${shifted.length} measures` });
}

/** Semantic diff of one chart slot (note/drumroll/balloon/measure counts + byte delta). */
export function diffFumen(songId: string, slot: FumenSlot, baseline: Fumen, draft: Fumen): FumenFileDiff {
  const key = fumenKey(songId, slot.filename);
  const baseBytes = encodeFumen(baseline);
  const draftBytes = encodeFumen(draft);
  const dirty = !bytesEqual(baseBytes, draftBytes);
  const changes: FieldChange[] = [];
  if (dirty) {
    const b = chartCounts(baseline);
    const d = chartCounts(draft);
    statChange('notes', b.notes, d.notes, changes);
    statChange('drumrolls', b.drumrolls, d.drumrolls, changes);
    statChange('balloons', b.balloons, d.balloons, changes);
    statChange('measures', b.measures, d.measures, changes);
    timingChanges(baseline, draft, changes);
  }
  const byteDelta = draftBytes.length - baseBytes.length;
  return {
    key,
    songId,
    filename: slot.filename,
    dirty,
    changes,
    summary: dirty
      ? (changes.length > 0 ? changes.map((c) => `${c.label} ${c.from}→${c.to}`).join(' · ') : 'chart edited')
      : 'no change',
    byteDelta,
  };
}

/**
 * Diff every slot that has both a baseline and a draft, returning only the
 * dirty ones in a stable (songId, filename) order.
 */
export function collectFumenDiffs(
  baselines: Map<string, FumenBaseline>,
  drafts: Map<string, Fumen>,
): FumenFileDiff[] {
  const out: FumenFileDiff[] = [];
  for (const [key, draft] of drafts) {
    const baseline = baselines.get(key);
    if (!baseline) continue;
    const fd = diffFumen(baseline.songId, baseline.slot, baseline.fumen, draft);
    if (fd.dirty) out.push(fd);
  }
  out.sort((a, b) => (a.songId === b.songId ? a.filename.localeCompare(b.filename) : a.songId.localeCompare(b.songId)));
  return out;
}
