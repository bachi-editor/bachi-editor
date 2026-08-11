import {
  DRUMROLL_NOTE_TYPES,
  FUMEN_DRUMROLL_SUFFIX_SIZE,
  Fumen,
  FumenNote,
} from './types';
import { decodeFumen, fumenEncodedSize } from './decode';
import { encodeHeader } from './header';

class Writer {
  private offset = 0;
  readonly view: DataView;

  constructor(public readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get pos(): number {
    return this.offset;
  }

  writeBytes(bytes: Uint8Array): void {
    this.buf.set(bytes, this.offset);
    this.offset += bytes.length;
  }
  u8(v: number): void {
    this.view.setUint8(this.offset, v);
    this.offset += 1;
  }
  u16le(v: number): void {
    this.view.setUint16(this.offset, v, true);
    this.offset += 2;
  }
  i32le(v: number): void {
    this.view.setInt32(this.offset, v, true);
    this.offset += 4;
  }
  f32le(v: number): void {
    this.view.setFloat32(this.offset, v, true);
    this.offset += 4;
  }
}

function writeNote(w: Writer, n: FumenNote): void {
  w.i32le(n.type);
  w.f32le(n.position);
  w.i32le(n.item);
  w.f32le(n.padding);
  w.u16le(n.scoreInit);
  w.u16le(n.scoreDiff);
  w.f32le(n.duration);
  if (DRUMROLL_NOTE_TYPES.has(n.type)) {
    // The 8-byte drumroll suffix is reserved and always zero across the whole
    // corpus (probed: 5.72M notes / 83.7k rolls, every suffix all-zero — see
    // spec.md). A decoded note carries its original suffix and is preserved
    // verbatim; a hand-built note that omitted it gets the canonical zeros, so
    // callers can't drift from the on-disk convention. A present-but-wrong-length
    // suffix is a real bug — still reject it.
    if (n.drumrollSuffix && n.drumrollSuffix.length !== FUMEN_DRUMROLL_SUFFIX_SIZE) {
      throw new Error(
        `note type 0x${n.type.toString(16)} drumrollSuffix must be ${FUMEN_DRUMROLL_SUFFIX_SIZE} bytes, got ${n.drumrollSuffix.length}`,
      );
    }
    w.writeBytes(n.drumrollSuffix ?? new Uint8Array(FUMEN_DRUMROLL_SUFFIX_SIZE));
  }
}

export function encodeFumen(fumen: Fumen): Uint8Array {
  const size = fumenEncodedSize(fumen);
  const out = new Uint8Array(size);
  const w = new Writer(out);
  w.writeBytes(encodeHeader(fumen.header));
  for (const m of fumen.measures) {
    w.f32le(m.bpm);
    w.f32le(m.offset);
    w.u8(m.gogo);
    w.u8(m.barline);
    w.u16le(m.padding1);
    for (let i = 0; i < 6; i++) w.i32le(m.branchInfo[i]);
    w.i32le(m.padding2);
    for (const b of m.branches) {
      w.u16le(b.notes.length);
      w.u16le(b.padding);
      w.f32le(b.speed);
      for (const n of b.notes) writeNote(w, n);
    }
  }
  w.writeBytes(fumen.trailer);
  return out;
}

/** Encoder self-check: encode → decode → encode should be byte-equal. */
export function verifyEncoderSelfConsistent(fumen: Fumen): { ok: boolean; bytesA: Uint8Array; bytesB: Uint8Array } {
  const bytesA = encodeFumen(fumen);
  const fumen2 = decodeFumen(bytesA);
  const bytesB = encodeFumen(fumen2);
  if (bytesA.length !== bytesB.length) return { ok: false, bytesA, bytesB };
  for (let i = 0; i < bytesA.length; i++) {
    if (bytesA[i] !== bytesB[i]) return { ok: false, bytesA, bytesB };
  }
  return { ok: true, bytesA, bytesB };
}
