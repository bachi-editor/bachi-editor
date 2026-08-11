import {
  DRUMROLL_NOTE_TYPES,
  FUMEN_BRANCH_HEADER_SIZE,
  FUMEN_DRUMROLL_SUFFIX_SIZE,
  FUMEN_HEADER_SIZE,
  FUMEN_MEASURE_HEADER_SIZE,
  FUMEN_NOTE_SIZE,
  Fumen,
  FumenBranch,
  FumenMeasure,
  FumenNote,
} from './types';
import { decodeHeader } from './header';

class Reader {
  private offset: number;
  private readonly view: DataView;

  constructor(private readonly buf: Uint8Array, start = 0) {
    this.offset = start;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get pos(): number {
    return this.offset;
  }

  remaining(): number {
    return this.buf.length - this.offset;
  }

  slice(n: number): Uint8Array {
    const out = this.buf.slice(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }

  u8(): number {
    return this.view.getUint8(this.offset++);
  }
  u16le(): number {
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }
  i32le(): number {
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }
  f32le(): number {
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }
}

function readNote(r: Reader): FumenNote {
  const type = r.i32le();
  const position = r.f32le();
  const item = r.i32le();
  const padding = r.f32le();
  const scoreInit = r.u16le();
  const scoreDiff = r.u16le();
  const duration = r.f32le();
  const note: FumenNote = { type, position, item, padding, scoreInit, scoreDiff, duration };
  if (DRUMROLL_NOTE_TYPES.has(type)) {
    note.drumrollSuffix = r.slice(FUMEN_DRUMROLL_SUFFIX_SIZE);
  }
  return note;
}

function readBranch(r: Reader): FumenBranch {
  const totalNotes = r.u16le();
  const padding = r.u16le();
  const speed = r.f32le();
  const notes: FumenNote[] = [];
  for (let i = 0; i < totalNotes; i++) notes.push(readNote(r));
  return { padding, speed, notes };
}

function readMeasure(r: Reader): FumenMeasure {
  const bpm = r.f32le();
  const offset = r.f32le();
  const gogo = r.u8();
  const barline = r.u8();
  const padding1 = r.u16le();
  const branchInfo: number[] = [];
  for (let i = 0; i < 6; i++) branchInfo.push(r.i32le());
  const padding2 = r.i32le();
  const branches = [readBranch(r), readBranch(r), readBranch(r)] as [FumenBranch, FumenBranch, FumenBranch];
  return {
    bpm,
    offset,
    gogo,
    barline,
    padding1,
    branchInfo: branchInfo as FumenMeasure['branchInfo'],
    padding2,
    branches,
  };
}

/** Low-level helper: read the measure count straight from raw header bytes
 *  (512..516, u32 LE) without decoding the whole header. The normal decode path
 *  uses the typed `header.measureCount`; this stays for raw-byte probes/tests. */
export function readMeasureCount(header: Uint8Array): number {
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  return view.getUint32(512, true);
}

export function decodeFumen(payload: Uint8Array): Fumen {
  if (payload.length < FUMEN_HEADER_SIZE) {
    throw new Error(`fumen payload too small: ${payload.length} bytes (need ≥${FUMEN_HEADER_SIZE})`);
  }
  const header = decodeHeader(payload);
  const measureCount = header.measureCount;
  const r = new Reader(payload, FUMEN_HEADER_SIZE);
  const measures: FumenMeasure[] = [];
  for (let i = 0; i < measureCount; i++) {
    if (r.remaining() < FUMEN_MEASURE_HEADER_SIZE + 3 * FUMEN_BRANCH_HEADER_SIZE) {
      throw new Error(
        `fumen truncated at measure ${i}/${measureCount}, only ${r.remaining()} bytes left at pos ${r.pos}`,
      );
    }
    measures.push(readMeasure(r));
  }
  const trailer = payload.slice(r.pos);
  return { header, measures, trailer };
}

/** Sanity helper: compute the encoded byte length the encoder will produce. */
export function fumenEncodedSize(fumen: Fumen): number {
  let total = FUMEN_HEADER_SIZE;
  for (const m of fumen.measures) {
    total += FUMEN_MEASURE_HEADER_SIZE;
    for (const b of m.branches) {
      total += FUMEN_BRANCH_HEADER_SIZE;
      for (const n of b.notes) {
        total += FUMEN_NOTE_SIZE;
        if (DRUMROLL_NOTE_TYPES.has(n.type)) total += FUMEN_DRUMROLL_SUFFIX_SIZE;
      }
    }
  }
  total += fumen.trailer.length;
  return total;
}
