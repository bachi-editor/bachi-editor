import { describe, expect, test } from 'vitest';
import { unzipSync } from 'fflate';
import { buildServerBundle } from '../../src/fs/exportBundle';
import type { RawDatatables } from '../../src/fs/datatables';
import type { ProjectRoot } from '../../src/fs/project';
import { sealDatatable } from '../../src/fs/write';
import { decodeJsonPayload, openEnvelope } from '../../src/codec';
import { DATATABLE_KEY_HEX, FUMEN_KEY_HEX, HAS_KEYS } from '../helpers/keys';
import { HAS_CORPUS } from '../helpers/resources';

const decoder = new TextDecoder();
const KEYS = { datatable: DATATABLE_KEY_HEX, fumen: FUMEN_KEY_HEX };

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
    musicinfo: {
      items: [{
        uniqueId: 1,
        id: 'aaa',
        genreNo: 0,
        starMania: 8,
      }],
    },
    musicOrder: { items: [{ uniqueId: 1, id: 'aaa', genreNo: 0 }] },
    wordlist: { items: [{ key: 'song_aaa', englishUsText: 'A' }] },
  };
}

async function decodeBin<T>(bytes: Uint8Array): Promise<T> {
  const { payload } = await openEnvelope(bytes, DATATABLE_KEY_HEX);
  return decodeJsonPayload<T>(payload);
}

describe('buildServerBundle', () => {
  test.skipIf(!HAS_KEYS)('zips draft datatable bins, json siblings, and a README', async () => {
    const draft = tables();
    // A project with keys but no readable neiro.bin (empty datatable dir).
    const root = { datatable: new MemDir(new Map()), keys: KEYS } as unknown as ProjectRoot;
    const bundle = await buildServerBundle(root, draft, {
      now: new Date(2026, 5, 11, 14, 5, 9),
      dirty: true,
    });

    expect(bundle.filename).toBe('bachi-server-bundle-20260611-140509.zip');
    const zip = unzipSync(bundle.bytes);
    expect(Object.keys(zip).sort()).toEqual([
      'README.txt',
      'music_order.bin',
      'music_order.json',
      'musicinfo.bin',
      'musicinfo.json',
      'wordlist.bin',
      'wordlist.json',
    ]);

    await expect(decodeBin(zip['musicinfo.bin'])).resolves.toEqual(draft.musicinfo);
    await expect(decodeBin(zip['music_order.bin'])).resolves.toEqual(draft.musicOrder);
    await expect(decodeBin(zip['wordlist.bin'])).resolves.toEqual(draft.wordlist);
    expect(JSON.parse(decoder.decode(zip['musicinfo.json']))).toEqual(draft.musicinfo);
    expect(decoder.decode(zip['README.txt'])).toContain('current in-memory Bachi draft');
  });

  test.skipIf(!HAS_CORPUS)('passes through neiro when the project has a readable datatable', async () => {
    const draft = tables();
    const neiro = { items: [{ uniqueId: 8, id: 'don' }] };
    const datatable = new MemDir(new Map([
      ['neiro.bin', new MemFile(await sealDatatable(neiro, DATATABLE_KEY_HEX))],
    ]));
    const root = { datatable, keys: KEYS } as unknown as ProjectRoot;

    const bundle = await buildServerBundle(root, draft, { now: new Date(2026, 5, 11, 14, 5, 9) });
    const zip = unzipSync(bundle.bytes);

    expect(zip['neiro.bin']).toBeDefined();
    expect(zip['neiro.json']).toBeDefined();
    await expect(decodeBin(zip['neiro.bin'])).resolves.toEqual(neiro);
    expect(JSON.parse(decoder.decode(zip['neiro.json']))).toEqual(neiro);
  });
});
