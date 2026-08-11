import { describe, expect, it } from 'vitest';
import type { Fumen, FumenMeasure, FumenNote } from '../../src/codec';
import { makeFumenHeader } from '../../src/codec';
import { adjacentNote, firstNoteInMeasure } from '../../src/model/fumenNavigation';

function note(position: number): FumenNote {
  return { type: 1, position, item: 0, padding: 0, scoreInit: 0, scoreDiff: 0, duration: 0 };
}

function measure(branches: [number[], number[], number[]]): FumenMeasure {
  return {
    bpm: 120,
    offset: 0,
    gogo: 0,
    barline: 1,
    padding1: 0,
    branchInfo: [-1, -1, -1, -1, -1, -1],
    padding2: 0,
    branches: branches.map((positions) => ({
      padding: 0,
      speed: 1,
      notes: positions.map(note),
    })) as FumenMeasure['branches'],
  };
}

function fumen(measures: FumenMeasure[]): Fumen {
  return {
    header: makeFumenHeader({ measureCount: measures.length }),
    measures,
    trailer: new Uint8Array(),
  };
}

describe('fumen keyboard navigation', () => {
  it('finds the earliest note in a measure and honors branch scope', () => {
    const chart = fumen([measure([[400], [100, 500], [100]])]);

    expect(firstNoteInMeasure(chart, 0)).toEqual({ measureIndex: 0, branchIndex: 1, noteIndex: 0 });
    expect(firstNoteInMeasure(chart, 0, 0)).toEqual({ measureIndex: 0, branchIndex: 0, noteIndex: 0 });
    expect(firstNoteInMeasure(chart, 0, 2)).toEqual({ measureIndex: 0, branchIndex: 2, noteIndex: 0 });
  });

  it('moves within a branch and skips empty measures', () => {
    const chart = fumen([
      measure([[100, 300], [], []]),
      measure([[], [50], []]),
      measure([[200], [], []]),
    ]);

    expect(adjacentNote(chart, { measureIndex: 0, branchIndex: 0, noteIndex: 0 }, 1))
      .toEqual({ measureIndex: 0, branchIndex: 0, noteIndex: 1 });
    expect(adjacentNote(chart, { measureIndex: 0, branchIndex: 0, noteIndex: 1 }, 1))
      .toEqual({ measureIndex: 2, branchIndex: 0, noteIndex: 0 });
    expect(adjacentNote(chart, { measureIndex: 2, branchIndex: 0, noteIndex: 0 }, -1))
      .toEqual({ measureIndex: 0, branchIndex: 0, noteIndex: 1 });
    expect(adjacentNote(chart, { measureIndex: 0, branchIndex: 0, noteIndex: 0 }, -1))
      .toBeUndefined();
  });
});
