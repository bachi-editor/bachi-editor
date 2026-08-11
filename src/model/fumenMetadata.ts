// Synchronize the chart-owned musicinfo fields without re-normalizing shipped
// legacy values. The corpus contains a handful of intentional/legacy offsets
// in rendaTime* and fuusenTotal*, so edits are applied as deltas from the decoded
// chart instead of replacing the whole field with a fresh approximation.

import type {
  Fumen,
  MusicInfoChartDerivedField,
  MusicInfoChartDerivedPatch,
  MusicInfoItem,
} from '../codec';
import type { FumenDifficulty } from '../fs/fumens';
import { beatMs } from './fumenTiming';

interface DifficultyFields {
  branch: MusicInfoChartDerivedField;
  notes: MusicInfoChartDerivedField;
  renda: MusicInfoChartDerivedField;
  fuusen: MusicInfoChartDerivedField;
}

export const CHART_METADATA_FIELDS: Record<FumenDifficulty, DifficultyFields> = {
  easy: { branch: 'branchEasy', notes: 'easyOnpuNum', renda: 'rendaTimeEasy', fuusen: 'fuusenTotalEasy' },
  normal: { branch: 'branchNormal', notes: 'normalOnpuNum', renda: 'rendaTimeNormal', fuusen: 'fuusenTotalNormal' },
  hard: { branch: 'branchHard', notes: 'hardOnpuNum', renda: 'rendaTimeHard', fuusen: 'fuusenTotalHard' },
  oni: { branch: 'branchMania', notes: 'maniaOnpuNum', renda: 'rendaTimeMania', fuusen: 'fuusenTotalMania' },
  ura: { branch: 'branchUra', notes: 'uraOnpuNum', renda: 'rendaTimeUra', fuusen: 'fuusenTotalUra' },
};

const NON_HIT_NOTE_TYPES = new Set([0x6, 0x9, 0xa, 0xc]);
const ROLL_NOTE_TYPES = new Set([0x6, 0x9]);
const BALLOON_NOTE_TYPES = new Set([0xa, 0xc]);

export interface FumenMetadataSummary {
  branch: boolean;
  notes: number;
  renda: number;
  fuusen: number;
}

/** A 48th note — the tail musicinfo counts past each drumroll's stored length. */
const RENDA_TAIL_BEATS = 1 / 12;

/**
 * Summarize the route represented by musicinfo: Normal for flat charts and
 * Master for branched charts. That convention matches 4,343/4,353 note-count
 * records in the current corpus; the ten remaining records are explicit test /
 * sentinel values and are preserved by the delta strategy below.
 *
 * `rendaTime*` is not the plain sum of the fumen's drumroll durations: shipped
 * values run one 48th note *longer* per roll. Adding that tail reconstructs 2,906
 * of the 4,009 CHN charts that have drumrolls to within 2 ms — against 30 for the
 * plain sum — so it is the convention new charts should follow.
 */
export function summarizeFumenMetadata(fumen: Fumen): FumenMetadataSummary {
  const branch = fumen.header.hasBranches !== 0;
  const branchIndex = branch ? 2 : 0;
  let notes = 0;
  let renda = 0;
  let fuusen = 0;
  for (const measure of fumen.measures) {
    for (const note of measure.branches[branchIndex].notes) {
      if (!NON_HIT_NOTE_TYPES.has(note.type)) notes++;
      if (ROLL_NOTE_TYPES.has(note.type)) {
        renda += (note.duration + beatMs(measure.bpm) * RENDA_TAIL_BEATS) / 1000;
      }
      if (BALLOON_NOTE_TYPES.has(note.type)) fuusen += note.scoreInit;
    }
  }
  return { branch, notes, renda, fuusen };
}

function currentNumber(item: MusicInfoItem, field: MusicInfoChartDerivedField, fallback: number): number {
  const value = item[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function assign(
  patch: MusicInfoChartDerivedPatch,
  field: MusicInfoChartDerivedField,
  value: number | boolean,
): void {
  (patch as Record<string, unknown>)[field] = value;
}

/** Return only the chart-derived musicinfo changes caused by one fumen edit. */
export function chartMetadataPatchAfterEdit(
  item: MusicInfoItem,
  difficulty: FumenDifficulty,
  before: Fumen,
  after: Fumen,
): MusicInfoChartDerivedPatch {
  const fields = CHART_METADATA_FIELDS[difficulty];
  const from = summarizeFumenMetadata(before);
  const to = summarizeFumenMetadata(after);
  const patch: MusicInfoChartDerivedPatch = {};

  if (from.branch !== to.branch) assign(patch, fields.branch, to.branch);

  const noteDelta = to.notes - from.notes;
  if (noteDelta !== 0) {
    assign(patch, fields.notes, Math.max(0, Math.round(currentNumber(item, fields.notes, from.notes) + noteDelta)));
  }

  const rendaDelta = to.renda - from.renda;
  if (Math.abs(rendaDelta) > 1e-9) {
    assign(patch, fields.renda, Math.max(0, currentNumber(item, fields.renda, from.renda) + rendaDelta));
  }

  const fuusenDelta = to.fuusen - from.fuusen;
  if (fuusenDelta !== 0) {
    assign(patch, fields.fuusen, Math.max(0, Math.round(currentNumber(item, fields.fuusen, from.fuusen) + fuusenDelta)));
  }

  return patch;
}

/** Copy chart-derived values between two difficulties when their charts are exact clones. */
export function clonedDifficultyMetadataPatch(
  item: MusicInfoItem,
  fromDifficulty: FumenDifficulty,
  toDifficulty: FumenDifficulty,
): MusicInfoChartDerivedPatch {
  const from = CHART_METADATA_FIELDS[fromDifficulty];
  const to = CHART_METADATA_FIELDS[toDifficulty];
  const patch: MusicInfoChartDerivedPatch = {};
  for (const key of ['branch', 'notes', 'renda', 'fuusen'] as const) {
    const value = item[from[key]];
    if (typeof value === 'number' || typeof value === 'boolean') assign(patch, to[key], value);
  }
  return patch;
}
