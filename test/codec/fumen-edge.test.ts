import { describe, expect, it } from 'vitest';
import {
  FUMEN_HEADER_SIZE,
  type Fumen,
  type FumenMeasure,
  type FumenNote,
} from '../../src/codec';
import { decodeFumen, fumenEncodedSize, readMeasureCount } from '../../src/codec/fumen/decode';
import { encodeFumen } from '../../src/codec/fumen/encode';
import { makeFumenHeader } from '../../src/codec/fumen/header';

function makeNote(type: number, drumrollSuffix?: Uint8Array): FumenNote {
  return { type, position: 0, item: 0, padding: 0, scoreInit: 0, scoreDiff: 0, duration: 0, drumrollSuffix };
}

function makeMeasure(notes: FumenNote[] = []): FumenMeasure {
  return {
    bpm: 120,
    offset: 0,
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

/** Raw 520 header bytes with the measure count poked at 512 — for the low-level
 *  readMeasureCount + decodeFumen(rawBytes) truncation tests. */
function makeHeader(measureCount: number): Uint8Array {
  const header = new Uint8Array(FUMEN_HEADER_SIZE);
  new DataView(header.buffer).setUint32(512, measureCount, true);
  return header;
}

function makeFumen(measures: FumenMeasure[]): Fumen {
  return {
    header: makeFumenHeader({ measureCount: measures.length }),
    measures,
    trailer: new Uint8Array(),
  };
}

describe('fumen decode/encode guards', () => {
  it('reads the measure count from header bytes 512..516', () => {
    expect(readMeasureCount(makeHeader(7))).toBe(7);
  });

  it('throws when the payload is smaller than the header', () => {
    expect(() => decodeFumen(new Uint8Array(FUMEN_HEADER_SIZE - 1))).toThrow(/too small/);
  });

  it('throws when a measure is truncated', () => {
    // Header claims one measure, but no measure bytes follow.
    expect(() => decodeFumen(makeHeader(1))).toThrow(/truncated at measure 0\/1/);
  });

  it('round-trips a header-only fumen and preserves the trailer', () => {
    const fumen = makeFumen([]);
    fumen.trailer = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const out = encodeFumen(fumen);
    const decoded = decodeFumen(out);
    expect(decoded.measures).toHaveLength(0);
    expect(Array.from(decoded.trailer)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it('round-trips a drumroll note with its 8-byte suffix', () => {
    const suffix = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const fumen = makeFumen([makeMeasure([makeNote(0x6, suffix)])]);
    const out = encodeFumen(fumen);
    expect(out.length).toBe(fumenEncodedSize(fumen));

    const decoded = decodeFumen(out);
    const note = decoded.measures[0].branches[0].notes[0];
    expect(note.type).toBe(0x6);
    expect(Array.from(note.drumrollSuffix!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('synthesizes the canonical zero suffix for a hand-built drumroll note (Phase 7.4)', () => {
    // The 8-byte suffix is reserved and always zero in the corpus, so a note
    // built without one is filled with zeros rather than rejected — callers
    // can't drift from the on-disk convention.
    const missing = makeFumen([makeMeasure([makeNote(0x6)])]);
    const out = encodeFumen(missing);
    expect(out.length).toBe(fumenEncodedSize(missing));
    const note = decodeFumen(out).measures[0].branches[0].notes[0];
    expect(Array.from(note.drumrollSuffix!)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('throws when encoding a drumroll note with a wrong-length suffix', () => {
    const wrongSize = makeFumen([makeMeasure([makeNote(0x9, new Uint8Array(4))])]);
    expect(() => encodeFumen(wrongSize)).toThrow(/drumrollSuffix must be 8 bytes/);
  });

  it('accounts for drumroll suffixes in the computed encoded size', () => {
    const plain = makeFumen([makeMeasure([makeNote(0x1)])]);
    const roll = makeFumen([makeMeasure([makeNote(0x6, new Uint8Array(8))])]);
    expect(fumenEncodedSize(roll) - fumenEncodedSize(plain)).toBe(8);
  });
});
