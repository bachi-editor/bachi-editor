import { describe, expect, test } from 'vitest';
import { loadDatatables, type RawDatatables } from '../../src/fs/datatables';
import type { ProjectRoot } from '../../src/fs/project';
import { sealDatatable } from '../../src/fs/write';
import { DATATABLE_KEY_HEX, FUMEN_KEY_HEX } from '../helpers/keys';
import { HAS_CORPUS } from '../helpers/resources';

class MemFile {
  readonly kind = 'file' as const;
  constructor(private readonly bytes: Uint8Array) {}

  async getFile() {
    const b = this.bytes;
    return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  }
}

class MemDir {
  readonly kind = 'directory' as const;
  constructor(private readonly files: Map<string, MemFile>) {}

  async getFileHandle(name: string) {
    const file = this.files.get(name);
    if (!file) throw new DOMException(`no file ${name}`, 'NotFoundError');
    return file;
  }
}

describe.skipIf(!HAS_CORPUS)('loadDatatables', () => {
  test('loads and decodes the three encrypted datatable bins', async () => {
    const tables: RawDatatables = {
      musicinfo: { items: [{ uniqueId: 1, id: 'aaa', genreNo: 0, starMania: 8 }] },
      musicOrder: { items: [{ uniqueId: 1, id: 'aaa', genreNo: 0 }] },
      wordlist: { items: [{ key: 'song_aaa', englishUsText: 'A' }] },
    };
    const datatable = new MemDir(new Map([
      ['musicinfo.bin', new MemFile(await sealDatatable(tables.musicinfo, DATATABLE_KEY_HEX))],
      ['music_order.bin', new MemFile(await sealDatatable(tables.musicOrder, DATATABLE_KEY_HEX))],
      ['wordlist.bin', new MemFile(await sealDatatable(tables.wordlist, DATATABLE_KEY_HEX))],
    ]));
    const root = { datatable, keys: { datatable: DATATABLE_KEY_HEX, fumen: FUMEN_KEY_HEX } } as unknown as ProjectRoot;

    await expect(loadDatatables(root)).resolves.toEqual(tables);
  });
});
