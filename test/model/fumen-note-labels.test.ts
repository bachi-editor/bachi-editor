import { describe, expect, it } from 'vitest';
import type { Fumen, FumenMeasure, FumenNote } from '../../src/codec';
import { makeFumenHeader } from '../../src/codec';
import { calculateBranchNoteLabels } from '../../src/model/fumenNoteLabels';

function makeNote(type: number, position: number): FumenNote {
  return {
    type,
    position,
    item: 0,
    padding: 0,
    scoreInit: 0,
    scoreDiff: 0,
    duration: 0,
  };
}

function makeMeasure(notes: FumenNote[] = [], bpm = 120): FumenMeasure {
  return {
    bpm,
    offset: 0,
    gogo: 0,
    barline: 1,
    padding1: 0,
    branchInfo: [-1, -1, -1, -1, -1, -1],
    padding2: 0,
    branches: [
      { padding: 0, speed: 1, notes },
      { padding: 0, speed: 1, notes: [] },
      { padding: 0, speed: 1, notes: [] },
    ],
  };
}

function makeFumen(measures: FumenMeasure[]): Fumen {
  return {
    header: makeFumenHeader({ measureCount: measures.length }),
    measures,
    trailer: new Uint8Array(),
  };
}

function branchTypes(fumen: Fumen, branchIndex: 0 | 1 | 2 = 0): number[] {
  return fumen.measures.flatMap((measure) =>
    measure.branches[branchIndex].notes.map((note) => note.type),
  );
}

describe('corpus-derived Don/Ka label calculation', () => {
  it('assigns isolated three-note Don and Ka sixteenth figures', () => {
    // At 120 BPM, 125 ms is one sixteenth-note unit.
    const notes = [
      makeNote(0x1, 0),
      makeNote(0x1, 125),
      makeNote(0x1, 250),
      makeNote(0x4, 1000),
      makeNote(0x4, 1125),
      makeNote(0x4, 1250),
    ];
    const fumen = makeFumen([makeMeasure(notes)]);
    const predicted = calculateBranchNoteLabels(fumen, 0);

    expect(notes.map((note) => predicted.get(note))).toEqual([
      0x2, 0x3, 0x1,
      0x5, 0x5, 0x4,
    ]);
  });

  it('assigns the five-note Don sixteenth figure', () => {
    const notes = [0, 125, 250, 375, 500].map((position) => makeNote(0x1, position));
    const fumen = makeFumen([makeMeasure(notes)]);
    const predicted = calculateBranchNoteLabels(fumen, 0);

    expect(notes.map((note) => predicted.get(note))).toEqual([0x2, 0x3, 0x2, 0x3, 0x1]);
  });

  it('normalizes timing by BPM and applies the following event scroll speed', () => {
    const fastNotes = [
      makeNote(0x1, 0),
      makeNote(0x1, 62.5),
      makeNote(0x1, 125),
    ];
    const fast = makeFumen([makeMeasure(fastNotes, 240)]);
    expect(fastNotes.map((note) => calculateBranchNoteLabels(fast, 0).get(note)))
      .toEqual([0x2, 0x3, 0x1]);

    const first = makeMeasure([makeNote(0x1, 1862.5)]);
    const second = makeMeasure([makeNote(0x1, 0)]);
    first.offset = 0;
    second.offset = 2000;
    second.branches[0].speed = 2;
    const scrolled = makeFumen([first, second]);
    // The raw gap is 1.1 sixteenths; the following note's 2x scroll makes it
    // visually 2.2 units away, selecting terminal ドン instead of ド.
    expect(calculateBranchNoteLabels(scrolled, 0).get(first.branches[0].notes[0])).toBe(0x1);
  });

  it('reports recommendations without changing any stored note ids', () => {
    const measure = makeMeasure([
      makeNote(0x1, 0),
      makeNote(0x1, 125),
      makeNote(0x1, 250),
      makeNote(0x7, 1000),
      makeNote(0x6, 1500),
    ]);
    measure.branches[1].notes = [makeNote(0x4, 0), makeNote(0x4, 125)];
    measure.branches[2].notes = [makeNote(0x2, 0)];
    const fumen = makeFumen([measure]);

    const normal = calculateBranchNoteLabels(fumen, 0);
    const expert = calculateBranchNoteLabels(fumen, 1);
    const master = calculateBranchNoteLabels(fumen, 2);
    expect(measure.branches[0].notes.map((note) => normal.get(note))).toEqual([
      0x2, 0x3, 0x1, undefined, undefined,
    ]);
    expect(measure.branches[1].notes.map((note) => expert.get(note))).toEqual([0x5, 0x4]);
    expect(measure.branches[2].notes.map((note) => master.get(note))).toEqual([0x1]);
    expect(branchTypes(fumen, 0)).toEqual([0x1, 0x1, 0x1, 0x7, 0x6]);
    expect(branchTypes(fumen, 1)).toEqual([0x4, 0x4]);
    expect(branchTypes(fumen, 2)).toEqual([0x2]);
  });

  it('treats a big Don or Ka two units ahead as a terminal boundary', () => {
    const red = makeNote(0x2, 0);
    const fumen = makeFumen([makeMeasure([red, makeNote(0x7, 250)])]);
    expect(calculateBranchNoteLabels(fumen, 0).get(red)).toBe(0x1);
  });
});
