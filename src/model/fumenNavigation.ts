import type { Fumen } from '../codec';
import type { ChartNoteRef } from './fumenEdits';

type BranchIndex = 0 | 1 | 2;

/**
 * Return the earliest note in a measure. A branch scope keeps navigation on one
 * stave; without one, notes are compared by time and then branch for a stable
 * visual order.
 */
export function firstNoteInMeasure(
  fumen: Fumen,
  measureIndex: number,
  branchIndex?: BranchIndex,
): ChartNoteRef | undefined {
  const measure = fumen.measures[measureIndex];
  if (!measure) return undefined;

  if (branchIndex !== undefined) {
    return measure.branches[branchIndex].notes.length > 0
      ? { measureIndex, branchIndex, noteIndex: 0 }
      : undefined;
  }

  let first: ChartNoteRef | undefined;
  let firstPosition = Number.POSITIVE_INFINITY;
  for (let b = 0; b < measure.branches.length; b++) {
    const branch = measure.branches[b as BranchIndex];
    for (let noteIndex = 0; noteIndex < branch.notes.length; noteIndex++) {
      const position = branch.notes[noteIndex].position;
      if (
        position < firstPosition
        || (position === firstPosition && first !== undefined && b < first.branchIndex)
      ) {
        first = { measureIndex, branchIndex: b as BranchIndex, noteIndex };
        firstPosition = position;
      }
    }
  }
  return first;
}

/**
 * Move to the previous/next note on the selected note's branch, crossing empty
 * measures as needed. Branch tracks are independent playable paths, so arrow
 * navigation does not jump between Normal/Expert/Master.
 */
export function adjacentNote(
  fumen: Fumen,
  current: ChartNoteRef,
  direction: -1 | 1,
): ChartNoteRef | undefined {
  const currentBranch = fumen.measures[current.measureIndex]?.branches[current.branchIndex];
  if (!currentBranch || !currentBranch.notes[current.noteIndex]) return undefined;

  const sameMeasureIndex = current.noteIndex + direction;
  if (sameMeasureIndex >= 0 && sameMeasureIndex < currentBranch.notes.length) {
    return { ...current, noteIndex: sameMeasureIndex };
  }

  for (
    let measureIndex = current.measureIndex + direction;
    measureIndex >= 0 && measureIndex < fumen.measures.length;
    measureIndex += direction
  ) {
    const notes = fumen.measures[measureIndex].branches[current.branchIndex].notes;
    if (notes.length === 0) continue;
    return {
      measureIndex,
      branchIndex: current.branchIndex,
      noteIndex: direction > 0 ? 0 : notes.length - 1,
    };
  }
  return undefined;
}
