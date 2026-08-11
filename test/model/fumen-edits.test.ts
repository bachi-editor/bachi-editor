import { describe, expect, it } from 'vitest';
import type { Fumen, FumenMeasure, FumenNote } from '../../src/codec';
import { decodeFumen, encodeFumen, FUMEN_NOTE_TYPE_NAMES, makeFumenHeader, SPECIAL_NOTE_TYPES } from '../../src/codec';
import {
  canEditMeasureDuration,
  EDITABLE_HEADER_INT_KEYS,
  fumenIsBranched,
  getChartMeasure,
  getChartNote,
  insertChartNote,
  isLongNoteType,
  isLongPlacementTool,
  isPlacementTool,
  measureDurationMs,
  measureOverflowCount,
  NOTE_TYPE_CHOICES,
  noteTypeForTool,
  removeChartNote,
  removeChartNotes,
  sameChartMeasureRef,
  sameChartNoteRef,
  seedBranchesFromNormal,
  setBranchSpeedOverride,
  setChartAudioOffset,
  setMeasureBarline,
  setMeasureBpmOverride,
  setMeasureBranchInfo,
  setMeasureDuration,
  setMeasureGogo,
  updateChartNote,
  updateFumenHeader,
  updateMeasureProperties,
  type FumenHeaderPatch,
} from '../../src/model/fumenEdits';
import { beatMs, chartIntroDelayMs, measureTimings } from '../../src/model/fumenTiming';

function makeNote(type: number, position = 0, duration = 0): FumenNote {
  return { type, position, item: 0, padding: 0, scoreInit: 0, scoreDiff: 0, duration };
}

function makeMeasure(notes: FumenNote[] = [], offset = 0): FumenMeasure {
  return {
    bpm: 120,
    offset,
    gogo: 0,
    barline: 1,
    padding1: 0,
    branchInfo: [0, 0, 0, 0, 0, 0],
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

describe('fumen edit transforms', () => {
  it('inserts an upgraded Don at the sorted note position', () => {
    const fumen = makeFumen([makeMeasure([makeNote(0x4, 1000)])]);
    const result = insertChartNote(fumen, {
      measureIndex: 0,
      branchIndex: 0,
      position: 500,
      tool: 'don',
      shiftKey: true,
    });

    expect(result.selection).toEqual({ measureIndex: 0, branchIndex: 0, noteIndex: 0 });
    expect(result.fumen.measures[0].branches[0].notes.map((n) => n.type)).toEqual([0x7, 0x4]);
    expect(result.fumen.measures[0].branches[0].notes.map((n) => n.position)).toEqual([500, 1000]);
  });

  it('never reclassifies stored Don/Ka variants after insert, delete, or edit', () => {
    const existing = [
      makeNote(0x2, 250),
      makeNote(0x3, 500),
      makeNote(0x5, 750),
    ];
    const fumen = makeFumen([makeMeasure(existing)]);

    const inserted = insertChartNote(fumen, {
      measureIndex: 0,
      branchIndex: 0,
      position: 0,
      tool: 'don',
    });
    const insertedNotes = inserted.fumen.measures[0].branches[0].notes;
    expect(insertedNotes.map((note) => note.type)).toEqual([0x1, 0x2, 0x3, 0x5]);
    expect(insertedNotes.slice(1)).toEqual(existing);

    const deleted = removeChartNote(inserted.fumen, inserted.selection!);
    expect(deleted.fumen.measures[0].branches[0].notes).toEqual(existing);

    const edited = updateChartNote(
      fumen,
      { measureIndex: 0, branchIndex: 0, noteIndex: 1 },
      { position: 600 },
    );
    expect(edited.fumen.measures[0].branches[0].notes.map((note) => note.type))
      .toEqual([0x2, 0x3, 0x5]);
  });

  it('creates drumroll notes with a valid suffix and dragged duration', () => {
    const fumen = makeFumen([makeMeasure()]);
    const duration = measureDurationMs(fumen.measures[0]) / 2;
    const result = insertChartNote(fumen, {
      measureIndex: 0,
      branchIndex: 0,
      position: 0,
      tool: 'roll',
      duration,
    });
    const note = getChartNote(result.fumen, result.selection);

    expect(note?.type).toBe(0x6);
    expect(note?.duration).toBe(duration);
    expect(note?.drumrollSuffix).toHaveLength(8);
  });

  it('normalizes balloon count and duration when a selected note changes type', () => {
    const fumen = makeFumen([makeMeasure([makeNote(0x1, 200)])]);
    const result = updateChartNote(fumen, { measureIndex: 0, branchIndex: 0, noteIndex: 0 }, { type: 0xa });
    const note = getChartNote(result.fumen, result.selection);

    expect(note?.type).toBe(0xa);
    expect(note?.duration).toBeGreaterThan(0);
    expect(note?.scoreInit).toBe(10);
    expect(note?.drumrollSuffix).toBeUndefined();
  });

  it('resorts selection when note position changes and removes notes by ref', () => {
    const fumen = makeFumen([makeMeasure([makeNote(0x1, 0), makeNote(0x4, 1000)])]);
    const moved = updateChartNote(fumen, { measureIndex: 0, branchIndex: 0, noteIndex: 0 }, { position: 1500 });

    expect(moved.selection).toEqual({ measureIndex: 0, branchIndex: 0, noteIndex: 1 });
    expect(moved.fumen.measures[0].branches[0].notes.map((n) => n.type)).toEqual([0x4, 0x1]);

    const removed = removeChartNote(moved.fumen, moved.selection!);
    expect(removed.fumen.measures[0].branches[0].notes.map((n) => n.type)).toEqual([0x4]);
  });

  it('clamps placement position into the measure and defaults balloon count', () => {
    const fumen = makeFumen([makeMeasure()]);
    const measureMs = measureDurationMs(fumen.measures[0]);

    const below = insertChartNote(fumen, { measureIndex: 0, branchIndex: 0, position: -50, tool: 'don' });
    expect(getChartNote(below.fumen, below.selection)?.position).toBe(0);

    const above = insertChartNote(fumen, { measureIndex: 0, branchIndex: 0, position: measureMs + 999, tool: 'don' });
    expect(getChartNote(above.fumen, above.selection)?.position).toBe(measureMs);

    const balloon = insertChartNote(fumen, { measureIndex: 0, branchIndex: 0, position: 0, tool: 'balloon' });
    const balloonNote = getChartNote(balloon.fumen, balloon.selection);
    expect(balloonNote?.type).toBe(0xa);
    expect(balloonNote?.scoreInit).toBe(10);
    expect(balloonNote?.duration).toBeGreaterThan(0);

    const kusudama = insertChartNote(fumen, { measureIndex: 0, branchIndex: 0, position: 0, tool: 'kusudama' });
    const kusudamaNote = getChartNote(kusudama.fumen, kusudama.selection);
    expect(kusudamaNote?.type).toBe(0xc);
    expect(kusudamaNote?.scoreInit).toBe(10);
    expect(kusudamaNote?.duration).toBeGreaterThan(0);
  });

  it('clamps placement and note edits to offset-derived measure duration', () => {
    const fumen = makeFumen([
      makeMeasure([], 0),
      makeMeasure([], 500),
      makeMeasure([], 2500),
    ]);

    const placed = insertChartNote(fumen, {
      measureIndex: 0,
      branchIndex: 0,
      position: 1200,
      tool: 'don',
    });
    expect(getChartNote(placed.fumen, placed.selection)?.position).toBe(500);

    const moved = updateChartNote(
      makeFumen([
        makeMeasure([makeNote(0x1, 100)], 0),
        makeMeasure([], 500),
        makeMeasure([], 2500),
      ]),
      { measureIndex: 0, branchIndex: 0, noteIndex: 0 },
      { position: 1200 },
    );
    expect(getChartNote(moved.fumen, moved.selection)?.position).toBe(500);
  });

  it('breaks position ties by note type when sorting', () => {
    const fumen = makeFumen([makeMeasure([makeNote(0x4, 500)])]);
    const result = insertChartNote(fumen, { measureIndex: 0, branchIndex: 0, position: 500, tool: 'don' });
    // Both sit at 500ms. Placement keeps the Don tool's concrete 0x1 type, which
    // sorts ahead of the existing 0x4 Ka.
    expect(result.fumen.measures[0].branches[0].notes.map((n) => n.type)).toEqual([0x1, 0x4]);
    expect(result.selection?.noteIndex).toBe(0);
  });

  it('replaces the nearest note within the slot window (Phase 9.2)', () => {
    // Two existing notes 250 ms apart; placing a Don at 510 with a 130 ms window
    // swaps the 500 ms Ka, leaving the 250 ms one untouched (no stacking).
    const fumen = makeFumen([makeMeasure([makeNote(0x4, 250), makeNote(0x4, 500)])]);
    const result = insertChartNote(fumen, {
      measureIndex: 0,
      branchIndex: 0,
      position: 510,
      tool: 'don',
      replaceWithinMs: 130,
    });
    const notes = result.fumen.measures[0].branches[0].notes;
    expect(notes.map((n) => n.type)).toEqual([0x4, 0x1]);
    expect(notes.map((n) => n.position)).toEqual([250, 510]);
  });

  it('stacks instead of replacing when no note is within the slot window', () => {
    const fumen = makeFumen([makeMeasure([makeNote(0x4, 500)])]);
    const result = insertChartNote(fumen, {
      measureIndex: 0,
      branchIndex: 0,
      position: 0,
      tool: 'don',
      replaceWithinMs: 100, // 500 ms note is outside the window
    });
    expect(result.fumen.measures[0].branches[0].notes.map((n) => n.type)).toEqual([0x1, 0x4]);
  });

  it('stacks duplicates by default (no replace modifier)', () => {
    const fumen = makeFumen([makeMeasure([makeNote(0x4, 500)])]);
    const result = insertChartNote(fumen, { measureIndex: 0, branchIndex: 0, position: 500, tool: 'don' });
    expect(result.fumen.measures[0].branches[0].notes).toHaveLength(2);
  });

  it('clones an existing drumroll suffix when updating in place', () => {
    const suffix = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const roll: FumenNote = { ...makeNote(0x6, 0, 1000), drumrollSuffix: suffix };
    const fumen = makeFumen([makeMeasure([roll])]);
    const result = updateChartNote(fumen, { measureIndex: 0, branchIndex: 0, noteIndex: 0 }, { position: 100 });
    const note = getChartNote(result.fumen, result.selection);
    expect(Array.from(note!.drumrollSuffix!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(note?.drumrollSuffix).not.toBe(suffix); // cloned, not aliased
  });

  it('adds a drumroll suffix when a note is upgraded to a drumroll type', () => {
    const fumen = makeFumen([makeMeasure([makeNote(0x1, 0)])]);
    const result = updateChartNote(fumen, { measureIndex: 0, branchIndex: 0, noteIndex: 0 }, { type: 0x6 });
    const note = getChartNote(result.fumen, result.selection);
    expect(note?.type).toBe(0x6);
    expect(note?.duration).toBeGreaterThan(0);
    expect(note?.drumrollSuffix).toHaveLength(8);
  });

  it('removes several notes in one transform, even across branches', () => {
    const m0 = makeMeasure([makeNote(0x1, 0), makeNote(0x4, 250), makeNote(0x1, 500)]);
    // put two notes into branch 1 of a second measure
    const m1 = makeMeasure();
    m1.branches[1].notes = [makeNote(0x1, 0), makeNote(0x4, 500)];
    const fumen = makeFumen([m0, m1]);

    const result = removeChartNotes(fumen, [
      { measureIndex: 0, branchIndex: 0, noteIndex: 0 },
      { measureIndex: 0, branchIndex: 0, noteIndex: 2 },
      { measureIndex: 1, branchIndex: 1, noteIndex: 1 },
    ]);

    expect(result.fumen.measures[0].branches[0].notes.map((n) => n.position)).toEqual([250]);
    expect(result.fumen.measures[1].branches[1].notes.map((n) => n.position)).toEqual([0]);
  });

  it('ignores invalid refs and is a no-op for an empty multi-delete', () => {
    const fumen = makeFumen([makeMeasure([makeNote(0x1, 0)])]);
    expect(removeChartNotes(fumen, []).fumen).toBe(fumen);
    expect(removeChartNotes(fumen, [{ measureIndex: 9, branchIndex: 0, noteIndex: 0 }]).fumen).toBe(fumen);
    // a single valid ref still removes
    const ok = removeChartNotes(fumen, [{ measureIndex: 0, branchIndex: 0, noteIndex: 0 }]);
    expect(ok.fumen.measures[0].branches[0].notes).toHaveLength(0);
  });

  it('is a no-op when inserting or removing against an invalid ref', () => {
    const fumen = makeFumen([makeMeasure([makeNote(0x1, 0)])]);

    expect(insertChartNote(fumen, { measureIndex: 9, branchIndex: 0, position: 0, tool: 'don' }).fumen).toBe(fumen);
    expect(insertChartNote(fumen, { measureIndex: 0, branchIndex: 2, position: 0, tool: 'don' }).fumen)
      .not.toBe(fumen); // branch 2 exists
    expect(removeChartNote(fumen, { measureIndex: 0, branchIndex: 0, noteIndex: 5 }).fumen).toBe(fumen);
    expect(updateChartNote(fumen, { measureIndex: 0, branchIndex: 0, noteIndex: 5 }, { position: 1 }).fumen).toBe(fumen);
  });
});

describe('measure-first event transforms (Phase 11)', () => {
  it('reads a measure ref, returning undefined for invalid refs', () => {
    const fumen = makeFumen([makeMeasure()]);
    expect(getChartMeasure(fumen, { measureIndex: 0 })?.bpm).toBe(120);
    expect(getChartMeasure(fumen, { measureIndex: 9 })).toBeUndefined();
    expect(getChartMeasure(fumen, undefined)).toBeUndefined();
  });

  it('updateMeasureProperties updates bpm, offset, gogo and barline', () => {
    const fumen = makeFumen([makeMeasure()]);
    expect(updateMeasureProperties(fumen, 0, { bpm: 180 }).fumen.measures[0].bpm).toBe(180);
    expect(updateMeasureProperties(fumen, 0, { offset: -25 }).fumen.measures[0].offset).toBe(-25);
    expect(updateMeasureProperties(fumen, 0, { gogo: true }).fumen.measures[0].gogo).toBe(1);
    expect(updateMeasureProperties(fumen, 0, { barline: 0 }).fumen.measures[0].barline).toBe(0);
  });

  it('clamps non-finite / non-positive measure-property inputs to the prior value', () => {
    const fumen = makeFumen([makeMeasure()]);
    expect(updateMeasureProperties(fumen, 0, { bpm: 0 }).fumen.measures[0].bpm).toBe(1);
    expect(updateMeasureProperties(fumen, 0, { offset: Number.NaN }).fumen.measures[0].offset).toBe(0);
  });

  it('setMeasureGogo / setMeasureBarline toggle the measure-local state', () => {
    const fumen = makeFumen([makeMeasure()]);
    expect(setMeasureGogo(fumen, 0, true).fumen.measures[0].gogo).toBe(1);
    expect(setMeasureBarline(fumen, 0, false).fumen.measures[0].barline).toBe(0);
  });

  it('setMeasureBranchInfo rounds + replaces the 6 thresholds', () => {
    const fumen = makeFumen([makeMeasure(), makeMeasure()]);
    const next = setMeasureBranchInfo(fumen, 1, [1.6, 2, 1, 2, 1, 2]);
    expect(next.fumen.measures[1].branchInfo).toEqual([2, 2, 1, 2, 1, 2]);
    // a no-op (same values) returns the same ref.
    expect(setMeasureBranchInfo(next.fumen, 1, [2, 2, 1, 2, 1, 2]).fumen).toBe(next.fumen);
  });

  describe('BPM override (the "changes here" checkbox)', () => {
    it('on:true with a value sets the measure BPM', () => {
      const fumen = makeFumen([makeMeasure(), makeMeasure()]);
      const next = setMeasureBpmOverride(fumen, 1, true, 180);
      expect(next.fumen.measures[1].bpm).toBe(180);
    });

    it('on:false copies the previous measure BPM (uncheck inherits)', () => {
      const m0 = { ...makeMeasure(), bpm: 150 };
      const m1 = { ...makeMeasure(), bpm: 180 };
      const fumen = makeFumen([m0, m1]);
      const reset = setMeasureBpmOverride(fumen, 1, false);
      expect(reset.fumen.measures[1].bpm).toBe(150);
    });

    it('on:false is a no-op on measure 0 (base BPM, nothing to inherit)', () => {
      const fumen = makeFumen([{ ...makeMeasure(), bpm: 150 }]);
      expect(setMeasureBpmOverride(fumen, 0, false).fumen).toBe(fumen);
    });

    it('on:true without a value (arm only) is a no-op', () => {
      const fumen = makeFumen([makeMeasure(), makeMeasure()]);
      expect(setMeasureBpmOverride(fumen, 1, true).fumen).toBe(fumen);
    });
  });

  describe('branch-speed override', () => {
    it('edits one branch stave in isolation', () => {
      const fumen = makeFumen([makeMeasure()]);
      const next = setBranchSpeedOverride(fumen, 0, 1, true, 2.5);
      expect(next.fumen.measures[0].branches[1].speed).toBe(2.5);
      expect(next.fumen.measures[0].branches[0].speed).toBe(1);
      expect(next.fumen.measures[0].branches[2].speed).toBe(1);
    });

    it("target 'all' writes every branch's speed", () => {
      const fumen = makeFumen([makeMeasure()]);
      const next = setBranchSpeedOverride(fumen, 0, 'all', true, 3);
      expect(next.fumen.measures[0].branches.map((b) => b.speed)).toEqual([3, 3, 3]);
    });

    it('on:false copies the previous measure speed per branch (uncheck inherits)', () => {
      const m0 = makeMeasure();
      m0.branches[0].speed = 0.5;
      m0.branches[1].speed = 0.75;
      const m1 = makeMeasure();
      m1.branches[0].speed = 2;
      m1.branches[1].speed = 2;
      const fumen = makeFumen([m0, m1]);
      const allReset = setBranchSpeedOverride(fumen, 1, 'all', false);
      expect(allReset.fumen.measures[1].branches[0].speed).toBe(0.5);
      expect(allReset.fumen.measures[1].branches[1].speed).toBe(0.75);
    });

    it('clamps a non-positive speed to the floor', () => {
      const fumen = makeFumen([makeMeasure()]);
      expect(setBranchSpeedOverride(fumen, 0, 0, true, -1).fumen.measures[0].branches[0].speed).toBe(0.001);
    });

    it('on:false is a no-op on measure 0 (base speeds)', () => {
      const fumen = makeFumen([makeMeasure()]);
      expect(setBranchSpeedOverride(fumen, 0, 'all', false).fumen).toBe(fumen);
    });
  });

  it('returns the original fumen for an invalid measure index', () => {
    const fumen = makeFumen([makeMeasure()]);
    expect(updateMeasureProperties(fumen, 9, { bpm: 200 }).fumen).toBe(fumen);
    expect(setMeasureBpmOverride(fumen, 9, true, 200).fumen).toBe(fumen);
    expect(setMeasureBranchInfo(fumen, 9, [1, 1, 1, 1, 1, 1]).fumen).toBe(fumen);
    // an empty/no-op property patch returns the same ref so history is skipped.
    expect(updateMeasureProperties(fumen, 0, {}).fumen).toBe(fumen);
  });
});

describe('chart helpers', () => {
  it('classifies placement tools', () => {
    expect(isPlacementTool('don')).toBe(true);
    expect(isPlacementTool('balloon')).toBe(true);
    expect(isPlacementTool('kusudama')).toBe(true);
    expect(isPlacementTool('select')).toBe(false);
    expect(isPlacementTool('eraser')).toBe(false);

    expect(isPlacementTool('rollbig')).toBe(true);

    expect(isLongPlacementTool('roll')).toBe(true);
    expect(isLongPlacementTool('rollbig')).toBe(true);
    expect(isLongPlacementTool('balloon')).toBe(true);
    expect(isLongPlacementTool('kusudama')).toBe(true);
    expect(isLongPlacementTool('don')).toBe(false);
  });

  it('maps tools to note types with shift upgrades', () => {
    expect(noteTypeForTool('don')).toBe(0x1);
    expect(noteTypeForTool('don', true)).toBe(0x7);
    expect(noteTypeForTool('ka')).toBe(0x4);
    expect(noteTypeForTool('ka', true)).toBe(0x8);
    expect(noteTypeForTool('donbig')).toBe(0x7);
    expect(noteTypeForTool('kabig')).toBe(0x8);
    expect(noteTypeForTool('roll')).toBe(0x6);
    expect(noteTypeForTool('roll', true)).toBe(0x9);
    expect(noteTypeForTool('rollbig')).toBe(0x9);
    expect(noteTypeForTool('balloon')).toBe(0xa);
    expect(noteTypeForTool('balloon', true)).toBe(0xc);
    expect(noteTypeForTool('kusudama')).toBe(0xc);
    expect(noteTypeForTool('kusudama', true)).toBe(0xc);
  });

  it('the editable type list reaches every named note type (none unreachable)', () => {
    const choiceTypes = new Set(NOTE_TYPE_CHOICES.map((c) => c.value));
    const named = Object.keys(FUMEN_NOTE_TYPE_NAMES).map(Number);
    // Every named codec type must be convertible to in the Inspector dropdown,
    // so no rendered note (e.g. the both-players big notes 0xb/0xd) is editor-unreachable.
    for (const t of named) {
      expect(choiceTypes.has(t), `note type 0x${t.toString(16)} missing from NOTE_TYPE_CHOICES`).toBe(true);
    }
    // …and the list offers nothing that isn't a real named type.
    for (const c of NOTE_TYPE_CHOICES) {
      expect(FUMEN_NOTE_TYPE_NAMES[c.value], `0x${c.value.toString(16)} not a named type`).toBeDefined();
    }
    // Special (wii5op) types stay preserve-only — never in the authorable list.
    for (const t of SPECIAL_NOTE_TYPES) expect(choiceTypes.has(t)).toBe(false);
  });

  it('identifies long note types (drumrolls and balloons)', () => {
    expect(isLongNoteType(0x6)).toBe(true);
    expect(isLongNoteType(0x9)).toBe(true);
    expect(isLongNoteType(0xa)).toBe(true);
    expect(isLongNoteType(0xc)).toBe(true);
    expect(isLongNoteType(0x1)).toBe(false);
  });

  it('compares note and measure refs', () => {
    const ref = { measureIndex: 1, branchIndex: 0 as const, noteIndex: 2 };
    expect(sameChartNoteRef(ref, { ...ref })).toBe(true);
    expect(sameChartNoteRef(ref, { ...ref, noteIndex: 3 })).toBe(false);
    expect(sameChartNoteRef(undefined, ref)).toBe(false);
    expect(sameChartNoteRef(ref, undefined)).toBe(false);

    const mr = { measureIndex: 1, branchIndex: 0 as const };
    expect(sameChartMeasureRef(mr, { ...mr })).toBe(true);
    expect(sameChartMeasureRef(mr, { measureIndex: 1 })).toBe(false);
    expect(sameChartMeasureRef({ measureIndex: 2 }, { measureIndex: 2 })).toBe(true);
    expect(sameChartMeasureRef(undefined, mr)).toBe(false);
    expect(sameChartMeasureRef(mr, undefined)).toBe(false);
  });
});

function measureWithBranches(normal: FumenNote[], expert: FumenNote[], master: FumenNote[]): FumenMeasure {
  return {
    bpm: 120,
    offset: 0,
    gogo: 0,
    barline: 1,
    padding1: 0,
    branchInfo: [-1, -1, -1, -1, -1, -1],
    padding2: 0,
    branches: [
      { padding: 0, speed: 1, notes: normal },
      { padding: 0, speed: 1, notes: expert },
      { padding: 0, speed: 1, notes: master },
    ],
  };
}

describe('chart header editing (Phase 8.5)', () => {
  it('applies editable int fields, rounds, and clamps to i32', () => {
    const fumen = makeFumen([makeMeasure()]);
    const r = updateFumenHeader(fumen, { hpClear: 5000.7, hpLossBad: -30, hpMax: 1e12 });
    expect(r.fumen).not.toBe(fumen);
    expect(r.fumen.header.hpClear).toBe(5001);
    expect(r.fumen.header.hpLossBad).toBe(-30);
    expect(r.fumen.header.hpMax).toBe(0x7fffffff);
    // Untouched fields keep their values; measures are shared by reference.
    expect(r.fumen.header.normalNormalRatio).toBe(fumen.header.normalNormalRatio);
    expect(r.fumen.measures).toBe(fumen.measures);
  });

  it('coerces hasBranches to 0/1', () => {
    const fumen = makeFumen([makeMeasure()]);
    expect(updateFumenHeader(fumen, { hasBranches: 5 }).fumen.header.hasBranches).toBe(1);
    const on = updateFumenHeader(fumen, { hasBranches: 1 }).fumen;
    expect(updateFumenHeader(on, { hasBranches: 0 }).fumen.header.hasBranches).toBe(0);
  });

  it('ignores non-editable / reserved keys (structural + unconfirmed)', () => {
    const fumen = makeFumen([makeMeasure()]);
    const r = updateFumenHeader(
      fumen,
      { measureCount: 99, dummyData: 7, unknownData: 3, timingWindows: [1, 2] } as unknown as FumenHeaderPatch,
    );
    expect(r.fumen).toBe(fumen); // nothing editable changed -> same ref, no history push
  });

  it('is a no-op (same ref) when values are unchanged', () => {
    const fumen = makeFumen([makeMeasure()]);
    const r = updateFumenHeader(fumen, { hpMax: fumen.header.hpMax, hasBranches: fumen.header.hasBranches });
    expect(r.fumen).toBe(fumen);
  });

  it('round-trips a header edit through encode/decode', () => {
    const fumen = makeFumen([makeMeasure()]);
    const edited = updateFumenHeader(fumen, { hasBranches: 1, hpClear: 6000, branchPtsBalloon: 42 }).fumen;
    const decoded = decodeFumen(encodeFumen(edited));
    expect(decoded.header.hasBranches).toBe(1);
    expect(decoded.header.hpClear).toBe(6000);
    expect(decoded.header.branchPtsBalloon).toBe(42);
  });

  it('covers every editable int key', () => {
    const fumen = makeFumen([makeMeasure()]);
    const patch: FumenHeaderPatch = {};
    EDITABLE_HEADER_INT_KEYS.forEach((key, i) => { patch[key] = 1000 + i; });
    const out = updateFumenHeader(fumen, patch).fumen.header;
    EDITABLE_HEADER_INT_KEYS.forEach((key, i) => { expect(out[key]).toBe(1000 + i); });
  });
});

describe('branch authoring (fumenIsBranched + seedBranchesFromNormal)', () => {
  it('treats a flat chart as branched only via the flag or E/M notes', () => {
    const flat = makeFumen([makeMeasure([makeNote(0x1, 0)])]);
    expect(fumenIsBranched(flat)).toBe(false);

    const flagged = updateFumenHeader(flat, { hasBranches: 1 }).fumen;
    expect(fumenIsBranched(flagged)).toBe(true);

    // E/M notes but flag off (the 39 inconsistent corpus charts) still count.
    const byNotes = makeFumen([measureWithBranches([], [makeNote(0x1, 0)], [])]);
    expect(byNotes.header.hasBranches).toBe(0);
    expect(fumenIsBranched(byNotes)).toBe(true);
  });

  it('seeds empty Expert/Master from Normal and sets the flag', () => {
    const roll = makeNote(0x6, 0, 500);
    roll.drumrollSuffix = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const fumen = makeFumen([makeMeasure([makeNote(0x1, 0), roll])]);

    const r = seedBranchesFromNormal(fumen);
    const m = r.fumen.measures[0];
    expect(r.fumen.header.hasBranches).toBe(1);
    expect(m.branches[1].notes.map((n) => n.type)).toEqual([0x1, 0x6]);
    expect(m.branches[2].notes.map((n) => n.type)).toEqual([0x1, 0x6]);
    // Deep copy: cloned notes and their drumroll suffix are independent objects.
    expect(m.branches[1].notes[1]).not.toBe(m.branches[0].notes[1]);
    expect(m.branches[1].notes[1].drumrollSuffix).not.toBe(m.branches[0].notes[1].drumrollSuffix);
    expect(Array.from(m.branches[1].notes[1].drumrollSuffix!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('does not clobber a measure that already has Expert/Master notes', () => {
    const fumen = makeFumen([measureWithBranches([makeNote(0x1, 0)], [makeNote(0x4, 0)], [])]);
    const r = seedBranchesFromNormal(fumen);
    // Already branched-by-notes -> flag flips on but the E track is untouched.
    expect(r.fumen.header.hasBranches).toBe(1);
    expect(r.fumen.measures[0].branches[1].notes.map((n) => n.type)).toEqual([0x4]);
    expect(r.fumen.measures[0].branches[2].notes).toEqual([]);
  });

  it('is a no-op when there is nothing to seed and the flag is already on', () => {
    const fumen = makeFumen([makeMeasure([makeNote(0x1, 0)])]);
    const on = updateFumenHeader(fumen, { hasBranches: 1 }).fumen;
    // Normal has notes but flag is on and no Normal->E/M copy needed? It does copy,
    // so to get a true no-op, start from an empty Normal with flag on.
    const empty = updateFumenHeader(makeFumen([makeMeasure([])]), { hasBranches: 1 }).fumen;
    expect(seedBranchesFromNormal(empty).fumen).toBe(empty);
    // sanity: the flagged-with-notes chart does seed (not a no-op).
    expect(seedBranchesFromNormal(on).fumen).not.toBe(on);
  });
});

describe('measure duration / offset authoring (Phase 12)', () => {
  // Four constant-120 measures, 2000 ms each (beatMs(120)=500, 4 beats = 2000).
  // An explicit increasing offset column makes the chart offset-derived.
  function derivedChart(notes: FumenNote[] = []): Fumen {
    return makeFumen([
      makeMeasure(notes, 0),
      makeMeasure([], 2000),
      makeMeasure([], 4000),
      makeMeasure([], 6000),
    ]);
  }

  it('reports which measures can have their duration edited', () => {
    const chart = derivedChart();
    expect(canEditMeasureDuration(chart, 1).ok).toBe(true);
    // Last measure has no following offset boundary.
    expect(canEditMeasureDuration(chart, 3).ok).toBe(false);
    expect(canEditMeasureDuration(chart, 3).reason).toMatch(/last measure/i);
    // A chart with an unusable offset column is BPM-derived only.
    const flat = makeFumen([makeMeasure([], 0), makeMeasure([], 0)]);
    expect(canEditMeasureDuration(flat, 0).ok).toBe(false);
    expect(canEditMeasureDuration(flat, 0).reason).toMatch(/offset column/i);
  });

  it('ripples downstream offsets, preserving downstream durations', () => {
    const before = measureTimings(derivedChart());
    expect(before.durations.slice(0, 3)).toEqual([2000, 2000, 2000]);

    const r = setMeasureDuration(derivedChart(), 1, 1000);
    const after = measureTimings(r.fumen);

    expect(after.durations[1]).toBeCloseTo(1000, 6); // edited measure
    expect(after.durations[0]).toBeCloseTo(2000, 6); // upstream untouched
    expect(after.durations[2]).toBeCloseTo(2000, 6); // downstream gap preserved
    // Offsets at/after the boundary shifted by the -1000 delta; the prefix held.
    expect(r.fumen.measures.map((m) => m.offset)).toEqual([0, 2000, 3000, 5000]);
  });

  it('keeps measure 0 offset (the chart/audio anchor) when editing measure 0', () => {
    const r = setMeasureDuration(derivedChart(), 0, 1000);
    expect(r.fumen.measures[0].offset).toBe(0);
    expect(r.fumen.measures.map((m) => m.offset)).toEqual([0, 1000, 3000, 5000]);
    expect(measureTimings(r.fumen).durations[0]).toBeCloseTo(1000, 6);
  });

  it('blocks a shrink that would push note heads outside the measure', () => {
    const chart = derivedChart([makeNote(0x1, 1500)]);
    expect(measureOverflowCount(chart, 0, 1000)).toBe(1);
    // Default 'block' policy returns the same fumen ref (no edit).
    expect(setMeasureDuration(chart, 0, 1000).fumen).toBe(chart);
  });

  it('scales notes into the new span with the scale policy', () => {
    const chart = derivedChart([makeNote(0x1, 1500), makeNote(0x6, 0, 800)]);
    const r = setMeasureDuration(chart, 0, 1000, 'scale');
    const notes = r.fumen.measures[0].branches[0].notes;
    // ratio = 1000/2000 = 0.5: tap moves to 750, the roll's length halves to 400.
    expect(notes.find((n) => n.type === 0x1)!.position).toBeCloseTo(750, 6);
    expect(notes.find((n) => n.type === 0x6)!.duration).toBeCloseTo(400, 6);
    // Downstream still rippled.
    expect(r.fumen.measures.map((m) => m.offset)).toEqual([0, 1000, 3000, 5000]);
  });

  it('drops overflowing note heads with the truncate policy', () => {
    const chart = derivedChart([makeNote(0x1, 500), makeNote(0x2, 1500)]);
    expect(measureOverflowCount(chart, 0, 1000)).toBe(1);
    const r = setMeasureDuration(chart, 0, 1000, 'truncate');
    const notes = r.fumen.measures[0].branches[0].notes;
    // The note past the new 1000 ms span is removed; the in-span note stays put.
    expect(notes.map((n) => n.position)).toEqual([500]);
    // Downstream still rippled by the -1000 delta.
    expect(r.fumen.measures.map((m) => m.offset)).toEqual([0, 1000, 3000, 5000]);
  });

  it('is a no-op for the last measure, a BPM-derived chart, and an unchanged length', () => {
    const chart = derivedChart();
    expect(setMeasureDuration(chart, 3, 1000).fumen).toBe(chart); // last measure
    expect(setMeasureDuration(chart, 1, 2000).fumen).toBe(chart); // unchanged length
    expect(setMeasureDuration(chart, 1, 0).fumen).toBe(chart); // below the floor
    const flat = makeFumen([makeMeasure([], 0), makeMeasure([], 0)]);
    expect(setMeasureDuration(flat, 0, 1000).fumen).toBe(flat); // not derived
  });
});

describe('setChartAudioOffset', () => {
  it('shifts every measure by the same delta so the whole chart moves, not just measure 0', () => {
    const chart = makeFumen([makeMeasure([], 0), makeMeasure([], 1500), makeMeasure([], 3000)]);
    const before = measureTimings(chart);

    const result = setChartAudioOffset(chart, 200); // 0 → 200 ms
    const offsets = result.fumen.measures.map((m) => m.offset);
    // Bug 1: all offsets move by +200, not only measure 0.
    expect(offsets).toEqual([200, 1700, 3200]);

    // Because every offset shifts equally, inter-measure durations are unchanged…
    const after = measureTimings(result.fumen);
    expect(after.durations).toEqual(before.durations);
    // …and each measure's judged audio time (offset[i] + 4*beatMs) shifts by +200.
    const beat = beatMs(chart.measures[0].bpm);
    expect(chartIntroDelayMs(result.fumen)).toBeCloseTo(200 + 4 * beat, 6);
  });

  it('preserves sub-millisecond fractions so nudging away and back is byte-clean (Bug 2)', () => {
    // A realistic fractional float32 offset (as decoded from a real chart).
    const chart = makeFumen([makeMeasure([], 512.34), makeMeasure([], 2012.34)]);
    const baseBytes = encodeFumen(chart);
    const shown = Math.round(chart.measures[0].offset); // 512

    const away = setChartAudioOffset(chart, shown + 10).fumen; // nudge +10 → 522
    expect(Math.round(away.measures[0].offset)).toBe(522);
    const back = setChartAudioOffset(away, shown).fumen; // nudge -10 → 512

    // The fraction survives the round trip, so the re-encoded bytes are identical.
    expect(back.measures.map((m) => m.offset)).toEqual([512.34, 2012.34]);
    expect(encodeFumen(back)).toEqual(baseBytes);
  });

  it('is a no-op when the rounded offset is unchanged (returns the same ref)', () => {
    const chart = makeFumen([makeMeasure([], 512.34), makeMeasure([], 2012.34)]);
    // 512.34 rounds to 512; committing 512 must not touch the stored fraction.
    expect(setChartAudioOffset(chart, 512).fumen).toBe(chart);
    const empty = makeFumen([]);
    expect(setChartAudioOffset(empty, 100).fumen).toBe(empty); // no measures — safe no-op
  });
});
