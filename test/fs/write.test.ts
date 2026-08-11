// Exercises the save pipeline's filesystem side — in particular the delete-song
// asset cleanup — against an in-memory fake that implements the slice of the
// File System Access API that fs/write.ts uses (getFileHandle / getDirectoryHandle
// with { create }, async iteration, createWritable, removeEntry).

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import type { RawDatatables } from '../../src/fs/datatables';
import type { ProjectRoot } from '../../src/fs/project';
import { deleteSong } from '../../src/model/edits';
import { saveDatatables, sealDatatable } from '../../src/fs/write';
import { decodeFumen } from '../../src/codec/fumen/decode';
import { openEnvelope } from '../../src/codec/envelope';
import { DATATABLE_KEY_HEX, FUMEN_KEY_HEX, HAS_KEYS } from '../helpers/keys';
import { detectJsonTextStyle, formatJsonText, readNus3BankDemoStartMs, type Fumen } from '../../src/codec';
import { HAS_CORPUS } from '../helpers/resources';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

const KEYS = { datatable: DATATABLE_KEY_HEX, fumen: FUMEN_KEY_HEX };

class MemFile {
  readonly kind = 'file' as const;
  constructor(public name: string, public bytes: Uint8Array) {}
  async getFile() {
    const b = this.bytes;
    return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  }
  createWritable() {
    const self = this;
    const parts: Uint8Array[] = [];
    return Promise.resolve({
      async write(chunk: Uint8Array) { parts.push(chunk); },
      async close() {
        const total = parts.reduce((n, p) => n + p.byteLength, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const p of parts) { out.set(p, off); off += p.byteLength; }
        self.bytes = out;
      },
    });
  }
}

class MemDir {
  readonly kind = 'directory' as const;
  children = new Map<string, MemDir | MemFile>();
  constructor(public name: string) {}

  async getFileHandle(name: string, opts?: { create?: boolean }) {
    const ex = this.children.get(name);
    if (ex && ex.kind === 'file') return ex;
    if (ex) throw new DOMException('is a directory', 'TypeMismatchError');
    if (!opts?.create) throw new DOMException(`no file ${name}`, 'NotFoundError');
    const f = new MemFile(name, new Uint8Array());
    this.children.set(name, f);
    return f;
  }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }) {
    const ex = this.children.get(name);
    if (ex && ex.kind === 'directory') return ex;
    if (ex) throw new DOMException('is a file', 'TypeMismatchError');
    if (!opts?.create) throw new DOMException(`no dir ${name}`, 'NotFoundError');
    const d = new MemDir(name);
    this.children.set(name, d);
    return d;
  }
  async removeEntry(name: string, _opts?: { recursive?: boolean }) {
    if (!this.children.has(name)) throw new DOMException(`no entry ${name}`, 'NotFoundError');
    this.children.delete(name);
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<[string, MemDir | MemFile]> {
    for (const [n, h] of this.children) yield [n, h];
  }
}

function baselineTables(): RawDatatables {
  return {
    musicinfo: {
      items: [
        { uniqueId: 1, id: 'aaa', genreNo: 0, starMania: 8, songFileName: 'sound/song_aaa' },
        { uniqueId: 2, id: 'bbb', genreNo: 5, starMania: 9 },
      ],
    },
    musicOrder: { items: [{ uniqueId: 1, id: 'aaa', genreNo: 0 }, { uniqueId: 2, id: 'bbb', genreNo: 5 }] },
    wordlist: { items: [{ key: 'song_aaa', japaneseText: 'A' }, { key: 'song_sub_aaa', japaneseText: 'sub' }] },
  };
}

async function seedRoot(base: RawDatatables): Promise<{ root: ProjectRoot; datatable: MemDir; fumen: MemDir; sound: MemDir }> {
  const datatable = new MemDir('datatable');
  // Seed existing datatable bytes so direct-overwrite paths are exercised.
  for (const [name, key] of [['musicinfo.bin', 'musicinfo'], ['music_order.bin', 'musicOrder'], ['wordlist.bin', 'wordlist']] as const) {
    datatable.children.set(name, new MemFile(name, await sealDatatable(base[key], DATATABLE_KEY_HEX)));
  }
  const fumen = new MemDir('fumen');
  const aaaDir = new MemDir('aaa');
  aaaDir.children.set('aaa_m.bin', new MemFile('aaa_m.bin', new Uint8Array([1, 2, 3])));
  aaaDir.children.set('aaa_h.bin', new MemFile('aaa_h.bin', new Uint8Array([4, 5])));
  fumen.children.set('aaa', aaaDir);
  const sound = new MemDir('sound');
  sound.children.set('song_aaa.nus3bank', new MemFile('song_aaa.nus3bank', new Uint8Array([9, 9, 9, 9])));

  const handle = new MemDir('x64');
  const root = {
    handle: handle as unknown as FileSystemDirectoryHandle,
    datatable: datatable as unknown as FileSystemDirectoryHandle,
    fumen: fumen as unknown as FileSystemDirectoryHandle,
    sound: sound as unknown as FileSystemDirectoryHandle,
    keys: KEYS,
  };
  return { root, datatable, fumen, sound };
}

describe('saveDatatables — delete-song asset cleanup', () => {
  test.skipIf(!HAS_KEYS)('removes deleted-song assets without creating extra files', async () => {
    const base = baselineTables();
    const draft = deleteSong(base, 1); // delete "aaa"
    const { root, datatable, fumen, sound } = await seedRoot(base);

    const result = await saveDatatables(root, base, draft);

    // datatables: all three are dirty (musicinfo/order/wordlist lost aaa).
    expect(result.saved.map((s) => s.file).sort()).toEqual(['music_order.bin', 'musicinfo.bin', 'wordlist.bin']);

    // Production assets are gone, with no replacement copies or sidecars.
    expect(fumen.children.has('aaa')).toBe(false);
    expect([...fumen.children.keys()]).toEqual([]);
    expect(sound.children.has('song_aaa.nus3bank')).toBe(false);
    expect([...sound.children.keys()]).toEqual([]);
    expect([...datatable.children.keys()].sort()).toEqual(['music_order.bin', 'musicinfo.bin', 'wordlist.bin']);

    // result reports the cleanup.
    expect(result.removedAssets).toEqual([{ songId: 'aaa' }]);
  });

  test.skipIf(!HAS_CORPUS)('writes edited charts in place and reports savedFumens', async () => {
    const base = baselineTables();
    const { root, fumen } = await seedRoot(base);
    // Save an edited version of a real chart into fumen/aaa/aaa_m.bin.
    const REPO = resolve(__dirname, '../../..');
    const buf = await readFile(resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_n.bin'));
    const { payload } = await openEnvelope(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), FUMEN_KEY_HEX);
    const original = decodeFumen(payload);

    const aaaDir = fumen.children.get('aaa') as MemDir;
    // Edited draft: one extra Don note in measure 0 branch 0.
    const measures = original.measures.slice();
    const m0 = measures[0];
    const branches = m0.branches.slice() as Fumen['measures'][number]['branches'];
    branches[0] = {
      ...branches[0],
      notes: [...branches[0].notes, { type: 0x1, position: 100, item: 0, padding: 0, scoreInit: 0, scoreDiff: 0, duration: 0 }],
    };
    measures[0] = { ...m0, branches };
    const draftFumen: Fumen = { ...original, measures };

    const result = await saveDatatables(root, base, base, [
      { songId: 'aaa', filename: 'aaa_m.bin', fumen: draftFumen },
    ]);

    // No datatable changed; one chart written.
    expect(result.saved).toHaveLength(0);
    expect(result.savedFumens).toHaveLength(1);
    expect(result.savedFumens[0]).toMatchObject({ songId: 'aaa', filename: 'aaa_m.bin' });

    // The on-disk file now decodes to the edited chart…
    const writtenBytes = (aaaDir.children.get('aaa_m.bin') as MemFile).bytes;
    const { payload: writtenPayload } = await openEnvelope(writtenBytes, FUMEN_KEY_HEX);
    const reDecoded = decodeFumen(writtenPayload);
    expect(reDecoded.measures[0].branches[0].notes.length).toBe(original.measures[0].branches[0].notes.length + 1);

    expect([...aaaDir.children.keys()].sort()).toEqual(['aaa_h.bin', 'aaa_m.bin']);
  });

  test.skipIf(!HAS_CORPUS)('writes sound-bank demo-start metadata without creating extra files', async () => {
    const base = baselineTables();
    const { root, sound } = await seedRoot(base);
    const REPO = resolve(__dirname, '../../..');
    const buf = await readFile(resolve(REPO, 'resources/TaikoCHN/Data/x64/sound/song_10binz.nus3bank'));
    const original = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    sound.children.set('song_aaa.nus3bank', new MemFile('song_aaa.nus3bank', original));

    const result = await saveDatatables(root, base, base, [], [], [], [
      { filename: 'song_aaa.nus3bank', preferredStem: 'song_aaa', demoStartMs: 54321 },
    ]);

    expect(result.saved).toEqual([]);
    expect(result.savedSoundBanks).toHaveLength(1);
    const patched = (sound.children.get('song_aaa.nus3bank') as MemFile).bytes;
    expect(readNus3BankDemoStartMs(patched, 'song_10binz')).toBe(54321);
    expect([...sound.children.keys()]).toEqual(['song_aaa.nus3bank']);
  });

  test.skipIf(!HAS_CORPUS)('a chart whose header measure count is corrupt aborts the save with nothing written', async () => {
    const base = baselineTables();
    const { root, fumen } = await seedRoot(base);
    const REPO = resolve(__dirname, '../../..');
    const buf = await readFile(resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_n.bin'));
    const { payload } = await openEnvelope(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), FUMEN_KEY_HEX);
    const original = decodeFumen(payload);

    // Corrupt the header so it claims more measures than the array holds — the
    // encoder self-check up front must reject before any byte is written.
    const bad: Fumen = {
      ...original,
      header: { ...original.header, measureCount: original.measures.length + 5 },
    };

    const aaaDir = fumen.children.get('aaa') as MemDir;
    const sentinel = (aaaDir.children.get('aaa_m.bin') as MemFile).bytes;

    await expect(saveDatatables(root, base, base, [{ songId: 'aaa', filename: 'aaa_m.bin', fumen: bad }]))
      .rejects.toThrow();

    // Untouched: same bytes, with no new file created.
    expect((aaaDir.children.get('aaa_m.bin') as MemFile).bytes).toEqual(sentinel);
    expect([...aaaDir.children.keys()].sort()).toEqual(['aaa_h.bin', 'aaa_m.bin']);
  });

  test.skipIf(!HAS_CORPUS)('writes created chart files without sidecars and reports createdFumens', async () => {
    const base = baselineTables();
    const { root, fumen } = await seedRoot(base);
    const REPO = resolve(__dirname, '../../..');
    const buf = await readFile(resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_n.bin'));
    const { payload } = await openEnvelope(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), FUMEN_KEY_HEX);
    const uraChart = decodeFumen(payload);

    // Create a new Ura single chart under fumen/aaa/ (the folder already exists).
    const result = await saveDatatables(root, base, base, [], [
      { songId: 'aaa', filename: 'aaa_x.bin', fumen: uraChart },
    ]);

    expect(result.createdFumens).toHaveLength(1);
    expect(result.createdFumens[0]).toMatchObject({ songId: 'aaa', filename: 'aaa_x.bin' });

    const aaaDir = fumen.children.get('aaa') as MemDir;
    expect(aaaDir.children.has('aaa_x.bin')).toBe(true);
    expect([...aaaDir.children.keys()].sort()).toEqual(['aaa_h.bin', 'aaa_m.bin', 'aaa_x.bin']);
    // …and it decodes back to the seeded chart.
    const { payload: written } = await openEnvelope((aaaDir.children.get('aaa_x.bin') as MemFile).bytes, FUMEN_KEY_HEX);
    expect(decodeFumen(written).measures.length).toBe(uraChart.measures.length);
  });

  test.skipIf(!HAS_KEYS)('removes a chart file without leaving an extra copy and reports removedFumens', async () => {
    const base = baselineTables();
    const { root, fumen } = await seedRoot(base);
    const aaaDir = fumen.children.get('aaa') as MemDir;
    aaaDir.children.set('aaa_x.bin', new MemFile('aaa_x.bin', new Uint8Array([7, 7, 7, 7, 7])));

    const result = await saveDatatables(root, base, base, [], [], [
      { songId: 'aaa', filename: 'aaa_x.bin' },
    ]);

    expect(result.removedFumens).toHaveLength(1);
    expect(result.removedFumens[0]).toMatchObject({ songId: 'aaa', filename: 'aaa_x.bin', byteDelta: -5 });

    expect(aaaDir.children.has('aaa_x.bin')).toBe(false);
    expect([...aaaDir.children.keys()].sort()).toEqual(['aaa_h.bin', 'aaa_m.bin']);
  });

  test.skipIf(!HAS_KEYS)('removing an already-absent chart file is a no-op', async () => {
    const base = baselineTables();
    const { root, fumen } = await seedRoot(base);
    const aaaDir = fumen.children.get('aaa') as MemDir;
    const before = [...aaaDir.children.keys()].sort();

    const result = await saveDatatables(root, base, base, [], [], [
      { songId: 'aaa', filename: 'aaa_x.bin' }, // never existed
    ]);

    expect(result.removedFumens[0]).toMatchObject({ filename: 'aaa_x.bin', byteDelta: 0 });
    expect([...aaaDir.children.keys()].sort()).toEqual(before);
  });

  test.skipIf(!HAS_KEYS)('no removed songs → no asset cleanup, only edited datatables written', async () => {
    const base = baselineTables();
    // edit a star instead of deleting — musicinfo dirty, no removals.
    const draft: RawDatatables = {
      ...base,
      musicinfo: { items: base.musicinfo.items.map((i) => (i.uniqueId === 2 ? { ...i, starMania: 10 } : i)) },
    };
    const { root, fumen, sound } = await seedRoot(base);

    const result = await saveDatatables(root, base, draft);

    expect(result.removedAssets).toHaveLength(0);
    expect(result.saved.map((s) => s.file)).toEqual(['musicinfo.bin']);
    // assets untouched.
    expect(fumen.children.has('aaa')).toBe(true);
    expect(sound.children.has('song_aaa.nus3bank')).toBe(true);
  });

  // The game writes its datatables CRLF + tab indented (JPN 39.06) and a save
  // overwrites those files in place, so the writer re-emits whatever layout the
  // file on disk already had instead of minifying it.
  test.skipIf(!HAS_CORPUS)('an edited file keeps the JSON layout it had on disk', async () => {
    const base = baselineTables();
    const style = detectJsonTextStyle('{"items":[\r\n\t{\r\n\t\t"id":"a"\r\n\t}\r\n]}\r\n');
    const { root, datatable } = await seedRoot(base);
    // Re-seed musicinfo.bin in the game's layout rather than the compact default.
    datatable.children.set(
      'musicinfo.bin',
      new MemFile('musicinfo.bin', await sealDatatable(base.musicinfo, DATATABLE_KEY_HEX, style)),
    );

    const draft: RawDatatables = {
      ...base,
      musicinfo: { items: base.musicinfo.items.map((i) => (i.uniqueId === 2 ? { ...i, starMania: 10 } : i)) },
    };
    await saveDatatables(root, base, draft);

    const written = (datatable.children.get('musicinfo.bin') as MemFile).bytes;
    const { payload } = await openEnvelope(written, DATATABLE_KEY_HEX);
    const text = Buffer.from(payload).toString('utf8');
    expect(detectJsonTextStyle(text)).toEqual(style);
    expect(text).toBe(formatJsonText(draft.musicinfo, style));
  });
});

// Phase 7.3 — the save pipeline only touches charts the caller deemed dirty.
// (The store decides which charts are dirty via collectFumenDiffs/isFumenDirty;
// here we prove the fs layer writes exactly the slots it is handed and leaves
// every other slot — and every other file — byte-for-byte untouched.)
describe.skipIf(!HAS_CORPUS)('saveDatatables — unchanged charts are never written (Phase 7.3)', () => {
  async function realChart(): Promise<Fumen> {
    const REPO = resolve(__dirname, '../../..');
    const buf = await readFile(resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_n.bin'));
    const { payload } = await openEnvelope(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), FUMEN_KEY_HEX);
    return decodeFumen(payload);
  }

  test('writes only the dirty slot without creating sidecars', async () => {
    const base = baselineTables();
    const { root, fumen } = await seedRoot(base);
    const aaaDir = fumen.children.get('aaa') as MemDir;
    const mBefore = (aaaDir.children.get('aaa_m.bin') as MemFile).bytes; // [1,2,3]
    const hBefore = (aaaDir.children.get('aaa_h.bin') as MemFile).bytes; // [4,5]

    // Only aaa_m.bin is dirty; aaa_h.bin is left alone.
    const result = await saveDatatables(root, base, base, [
      { songId: 'aaa', filename: 'aaa_m.bin', fumen: await realChart() },
    ]);

    expect(result.savedFumens.map((f) => f.filename)).toEqual(['aaa_m.bin']);

    // Dirty slot is rewritten; the only other file remains the untouched sibling.
    expect((aaaDir.children.get('aaa_m.bin') as MemFile).bytes).not.toEqual(mBefore);
    expect([...aaaDir.children.keys()].sort()).toEqual(['aaa_h.bin', 'aaa_m.bin']);

    // Untouched sibling keeps its original bytes.
    expect((aaaDir.children.get('aaa_h.bin') as MemFile).bytes).toEqual(hBefore);
  });

  test('no dirty datatables and no dirty charts → nothing is written at all', async () => {
    const base = baselineTables();
    const { root, fumen, sound } = await seedRoot(base);
    const datatableDir = (root.datatable as unknown as MemDir);

    const snapshot = (dir: MemDir) =>
      [...dir.children.entries()]
        .map(([name, h]) => `${name}:${h.kind === 'file' ? [...h.bytes].join(',') : 'dir'}`)
        .sort();
    const dtBefore = snapshot(datatableDir);
    const aaaDir = fumen.children.get('aaa') as MemDir;
    const fumenBefore = snapshot(aaaDir);
    const soundBefore = snapshot(sound);

    // base === draft, empty chart/sound lists: a true no-op save.
    const result = await saveDatatables(root, base, base);

    expect(result.saved).toEqual([]);
    expect(result.savedFumens).toEqual([]);
    expect(result.createdFumens).toEqual([]);
    expect(result.removedFumens).toEqual([]);
    expect(result.savedSoundBanks).toEqual([]);
    expect(result.removedAssets).toEqual([]);

    // No file is rewritten or created anywhere.
    expect(snapshot(datatableDir)).toEqual(dtBefore);
    expect(snapshot(aaaDir)).toEqual(fumenBefore);
    expect(snapshot(sound)).toEqual(soundBefore);
  });
});
