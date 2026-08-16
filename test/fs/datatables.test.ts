import { describe, expect, test } from 'vitest';
import { loadDatatables, type RawDatatables } from '../../src/fs/datatables';
import type { ProjectRoot } from '../../src/fs/project';
import { sealDatatable } from '../../src/fs/write';
import { DATATABLE_KEY_HEX, FUMEN_KEY_HEX, HAS_KEYS } from '../helpers/keys';

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

function tables(): RawDatatables {
  return {
    musicinfo: { items: [{ uniqueId: 1, id: 'aaa', genreNo: 0, starMania: 8 }] },
    musicOrder: { items: [{ uniqueId: 1, id: 'aaa', genreNo: 0 }] },
    wordlist: { items: [{ key: 'song_aaa', englishUsText: 'A' }] },
    musicAttribute: { items: [{ uniqueId: 1, id: 'aaa', ensoBgId: 2 }] },
    musicUsbSetting: { items: [{ uniqueId: 1, id: 'aaa', usbVer: 3 }] },
    musicAiSection: { items: [{ uniqueId: 1, id: 'aaa', sectionCount: 4 }] },
  };
}

async function rootWith(
  source: RawDatatables,
  companions: Partial<Record<'music_attribute.bin' | 'music_usbsetting.bin' | 'music_ai_section.bin', Uint8Array | null>> = {},
): Promise<ProjectRoot> {
  const files = new Map<string, MemFile>([
    ['musicinfo.bin', new MemFile(await sealDatatable(source.musicinfo, DATATABLE_KEY_HEX))],
    ['music_order.bin', new MemFile(await sealDatatable(source.musicOrder, DATATABLE_KEY_HEX))],
    ['wordlist.bin', new MemFile(await sealDatatable(source.wordlist, DATATABLE_KEY_HEX))],
  ]);
  for (const [name, bytes] of Object.entries(companions)) {
    if (bytes) files.set(name, new MemFile(bytes));
  }
  return {
    datatable: new MemDir(files),
    keys: { datatable: DATATABLE_KEY_HEX, fumen: FUMEN_KEY_HEX },
  } as unknown as ProjectRoot;
}

describe.skipIf(!HAS_KEYS)('loadDatatables', () => {
  test('loads and decodes all six encrypted datatable bins', async () => {
    const source = tables();
    const root = await rootWith(source, {
      'music_attribute.bin': await sealDatatable(source.musicAttribute, DATATABLE_KEY_HEX),
      'music_usbsetting.bin': await sealDatatable(source.musicUsbSetting, DATATABLE_KEY_HEX),
      'music_ai_section.bin': await sealDatatable(source.musicAiSection, DATATABLE_KEY_HEX),
    });

    await expect(loadDatatables(root)).resolves.toEqual(source);
  });

  test('tolerates genuinely missing companion tables', async () => {
    const source = tables();
    const root = await rootWith(source);

    await expect(loadDatatables(root)).resolves.toEqual({
      musicinfo: source.musicinfo,
      musicOrder: source.musicOrder,
      wordlist: source.wordlist,
    });
  });

  test('rejects a present but corrupt companion instead of treating it as missing', async () => {
    const source = tables();
    const root = await rootWith(source, {
      'music_attribute.bin': new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
    });

    await expect(loadDatatables(root)).rejects.toThrow(/Could not load music_attribute\.bin/);
  });
});
