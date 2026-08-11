import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { describe, test } from 'vitest';
import { decodeFumen } from '../../src/codec/fumen/decode';
import { encodeHeader } from '../../src/codec/fumen/header';
import { DRUMROLL_NOTE_TYPES, FUMEN_NOTE_TYPE_NAMES } from '../../src/codec/fumen/types';
import { openEnvelope } from '../../src/codec/envelope';
import { FUMEN_KEY_HEX } from '../helpers/keys';

const REPO = resolve(__dirname, '../../..');
const FUMEN_DIR = resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen');

async function* walkBins(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const ent of entries) {
    const p = join(root, ent.name);
    if (ent.isDirectory()) yield* walkBins(p);
    else if (ent.isFile() && ent.name.endsWith('.bin')) yield p;
  }
}

async function payloadOf(p: string): Promise<Uint8Array> {
  const buf = await readFile(p);
  const { payload } = await openEnvelope(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), FUMEN_KEY_HEX);
  return payload;
}

interface TypeStat {
  count: number;
  files: Set<string>;
  durations: Set<number>;
  scoreInits: Set<number>;
  items: Set<number>;
  positions: number; // count with nonzero position
  hasSuffix: number;
}

describe('census probe', () => {
  test('note-type + header census over the corpus', async () => {
    const all: string[] = [];
    for await (const p of walkBins(FUMEN_DIR)) all.push(p);
    all.sort();

    const stats = new Map<number, TypeStat>();
    function bump(type: number, file: string, n: { duration: number; scoreInit: number; item: number; position: number; drumrollSuffix?: Uint8Array }) {
      let s = stats.get(type);
      if (!s) {
        s = { count: 0, files: new Set(), durations: new Set(), scoreInits: new Set(), items: new Set(), positions: 0, hasSuffix: 0 };
        stats.set(type, s);
      }
      s.count++;
      if (s.files.size < 8) s.files.add(file);
      if (s.durations.size < 12) s.durations.add(Math.round(n.duration));
      if (s.scoreInits.size < 12) s.scoreInits.add(n.scoreInit);
      if (s.items.size < 12) s.items.add(n.item);
      if (n.position !== 0) s.positions++;
      if (n.drumrollSuffix) s.hasSuffix++;
    }

    // Header byte variance: how many distinct values each byte offset takes.
    const HEADER = 520;
    const byteValues: Set<number>[] = Array.from({ length: HEADER }, () => new Set<number>());
    // Also track f32 at every 4-byte offset (min/max + distinct sample).
    const f32distinct: Map<number, Set<number>> = new Map();

    let i = 0;
    for (const file of all) {
      const rel = relative(FUMEN_DIR, file);
      const payload = await payloadOf(file);
      const fumen = decodeFumen(payload);
      // header bytes (re-encode the typed header back to its 520 bytes)
      const headerBytes = encodeHeader(fumen.header);
      for (let b = 0; b < HEADER; b++) byteValues[b].add(headerBytes[b]);
      const hv = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
      for (let off = 0; off + 4 <= HEADER; off += 4) {
        let set = f32distinct.get(off);
        if (!set) { set = new Set(); f32distinct.set(off, set); }
        if (set.size < 30) set.add(hv.getFloat32(off, true));
      }
      // notes
      for (const m of fumen.measures) {
        for (const br of m.branches) {
          for (const note of br.notes) bump(note.type, rel, note);
        }
      }
      if (++i % 3000 === 0) console.log(`  ${i}/${all.length}`);
    }

    console.log(`\n=== NOTE-TYPE CENSUS (${all.length} files) ===`);
    const types = [...stats.keys()].sort((a, b) => a - b);
    for (const t of types) {
      const s = stats.get(t)!;
      const name = FUMEN_NOTE_TYPE_NAMES[t] ?? '???';
      const known = FUMEN_NOTE_TYPE_NAMES[t] ? '' : '  <-- UNNAMED';
      console.log(
        `0x${t.toString(16).padStart(2, '0')} ${name.padEnd(10)} count=${String(s.count).padStart(8)} files=${s.files.size}` +
          ` dur=${[...s.durations].slice(0, 6).join(',')} scoreInit=${[...s.scoreInits].slice(0, 6).join(',')}` +
          ` item=${[...s.items].slice(0, 4).join(',')} posNonZero=${s.positions} suffix=${s.hasSuffix} drumrollSet=${DRUMROLL_NOTE_TYPES.has(t)}${known}`,
      );
    }

    console.log(`\n=== UNNAMED-TYPE EXAMPLE FILES ===`);
    for (const t of types) {
      if (FUMEN_NOTE_TYPE_NAMES[t]) continue;
      const s = stats.get(t)!;
      console.log(`0x${t.toString(16)}: ${[...s.files].join('  ')}`);
    }

    console.log(`\n=== HEADER BYTE VARIANCE (offsets with >1 distinct value) ===`);
    const varyOffsets: number[] = [];
    for (let b = 0; b < HEADER; b++) if (byteValues[b].size > 1) varyOffsets.push(b);
    console.log(`varying bytes: ${varyOffsets.length}/${HEADER}`);
    // Print f32 fields that vary, in 4-byte stride.
    console.log(`\n=== HEADER f32 FIELDS (4-byte stride, distinct sample) ===`);
    for (let off = 0; off + 4 <= HEADER; off += 4) {
      const set = f32distinct.get(off)!;
      const anyVary = byteValues[off].size > 1 || byteValues[off + 1].size > 1 || byteValues[off + 2].size > 1 || byteValues[off + 3].size > 1;
      const sample = [...set].slice(0, 8).map((v) => (Number.isFinite(v) ? v.toPrecision(6) : String(v)));
      console.log(`off ${String(off).padStart(3)} (0x${off.toString(16)}): vary=${anyVary} distinct≈${set.size} ${sample.join(', ')}`);
    }
  }, 600_000);
});
