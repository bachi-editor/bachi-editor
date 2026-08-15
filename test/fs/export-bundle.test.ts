import { describe, expect, test } from 'vitest';
import { unzipSync } from 'fflate';
import {
  buildServerBundle,
  serverBundlePaths,
  type ServerBundleRequest,
  type ServerBundleSelection,
} from '../../src/fs/exportBundle';
import type { RawDatatables } from '../../src/fs/datatables';
import type { ProjectRoot } from '../../src/fs/project';
import { sealDatatable } from '../../src/fs/write';
import { decodeJsonPayload, openEnvelope, parseDanConfig, type DanConfig } from '../../src/codec';
import { DATATABLE_KEY_HEX, FUMEN_KEY_HEX, HAS_KEYS } from '../helpers/keys';

const decoder = new TextDecoder();
const KEYS = { datatable: DATATABLE_KEY_HEX, fumen: FUMEN_KEY_HEX };
const NOW = new Date(2026, 5, 11, 14, 5, 9);

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

function dan(danId: number): DanConfig {
  return [{
    danId,
    verupNo: 1,
    title: '1kyuu',
    aryOdaiSong: [
      { songNo: 1, level: 4, isHiddenSongName: false },
      { songNo: 2, level: 4, isHiddenSongName: false },
      { songNo: 3, level: 4, isHiddenSongName: true },
    ],
    aryOdaiBorder: [{
      odaiType: 1,
      borderType: 1,
      redBorderTotal: 90,
      goldBorderTotal: 95,
      redBorder_1: 0, redBorder_2: 0, redBorder_3: 0,
      goldBorder_1: 0, goldBorder_2: 0, goldBorder_3: 0,
    }],
  }];
}

/** A project root with keys but no readable datatable dir (empty MemDir). */
function root(files: Map<string, MemFile> = new Map()): ProjectRoot {
  return { datatable: new MemDir(files), keys: KEYS } as unknown as ProjectRoot;
}

function parts(on: Partial<ServerBundleSelection>): ServerBundleSelection {
  return { musicMetadata: false, musicOrder: false, dan: false, gaiden: false, ...on };
}

function request(over: Partial<ServerBundleRequest> = {}): ServerBundleRequest {
  return {
    format: 'bin',
    parts: parts({ musicMetadata: true, musicOrder: true }),
    sources: { project: { root: root(), datatables: tables() } },
    now: NOW,
    ...over,
  };
}

async function decodeBin<T>(bytes: Uint8Array): Promise<T> {
  const { payload } = await openEnvelope(bytes, DATATABLE_KEY_HEX);
  return decodeJsonPayload<T>(payload);
}

describe('serverBundlePaths', () => {
  test('the datatable parts follow the chosen format, under datatable/', () => {
    expect(serverBundlePaths('musicMetadata', 'bin')).toEqual([
      'datatable/musicinfo.bin',
      'datatable/wordlist.bin',
    ]);
    expect(serverBundlePaths('musicMetadata', 'json')).toEqual([
      'datatable/musicinfo.json',
      'datatable/wordlist.json',
    ]);
    expect(serverBundlePaths('musicOrder', 'json')).toEqual(['datatable/music_order.json']);
  });

  test('the dani configs sit at the data root and are JSON in both formats', () => {
    expect(serverBundlePaths('dan', 'bin')).toEqual(['dan_data.json']);
    expect(serverBundlePaths('dan', 'json')).toEqual(['dan_data.json']);
    expect(serverBundlePaths('gaiden', 'bin')).toEqual(['gaiden_data.json']);
  });
});

describe('buildServerBundle', () => {
  test.skipIf(!HAS_KEYS)('bin format seals the selected datatables under datatable/', async () => {
    const datatables = tables();
    const bundle = await buildServerBundle(request({
      sources: { project: { root: root(), datatables } },
      dirty: true,
    }));

    expect(bundle.filename).toBe('bachi-server-bundle-20260611-140509.zip');
    const zip = unzipSync(bundle.bytes);
    expect(Object.keys(zip).sort()).toEqual([
      'README.txt',
      'datatable/music_order.bin',
      'datatable/musicinfo.bin',
      'datatable/wordlist.bin',
    ]);

    await expect(decodeBin(zip['datatable/musicinfo.bin'])).resolves.toEqual(datatables.musicinfo);
    await expect(decodeBin(zip['datatable/music_order.bin'])).resolves.toEqual(datatables.musicOrder);
    await expect(decodeBin(zip['datatable/wordlist.bin'])).resolves.toEqual(datatables.wordlist);
    expect(decoder.decode(zip['README.txt'])).toContain('unsaved Bachi drafts');
  });

  test.skipIf(!HAS_KEYS)('bin format reuses the JSON layout the file already has on disk', async () => {
    const datatables = tables();
    // A musicinfo.bin on disk written with indented JSON: the bundle must come
    // back out in that same layout, so it matches what a save would write.
    const onDisk = await sealDatatable(datatables.musicinfo, DATATABLE_KEY_HEX, {
      indent: '  ', eol: '\n', colonSpace: true, trailingEol: '\n', inlineRoot: false,
    });
    const bundle = await buildServerBundle(request({
      parts: parts({ musicMetadata: true }),
      sources: {
        project: { root: root(new Map([['musicinfo.bin', new MemFile(onDisk)]])), datatables },
      },
    }));

    const zip = unzipSync(bundle.bytes);
    expect(zip['datatable/musicinfo.bin']).toEqual(onDisk);
    // wordlist.bin has no file on disk to copy a style from, so it stays compact.
    const { payload } = await openEnvelope(zip['datatable/wordlist.bin'], DATATABLE_KEY_HEX);
    expect(decoder.decode(payload)).toBe(JSON.stringify(datatables.wordlist));
  });

  test('json format writes indented plaintext siblings and needs no key', async () => {
    const datatables = tables();
    const bundle = await buildServerBundle(request({
      format: 'json',
      sources: { project: { root: root(), datatables } },
    }));

    const zip = unzipSync(bundle.bytes);
    expect(Object.keys(zip).sort()).toEqual([
      'README.txt',
      'datatable/music_order.json',
      'datatable/musicinfo.json',
      'datatable/wordlist.json',
    ]);
    expect(decoder.decode(zip['datatable/musicinfo.json'])).toBe(JSON.stringify(datatables.musicinfo, null, 2));
    expect(JSON.parse(decoder.decode(zip['datatable/wordlist.json']))).toEqual(datatables.wordlist);
  });

  test('only the selected parts are written', async () => {
    const bundle = await buildServerBundle(request({
      format: 'json',
      parts: parts({ musicOrder: true, gaiden: true }),
      sources: {
        project: { root: root(), datatables: tables() },
        dan: dan(1),
        gaiden: dan(20),
      },
    }));

    expect(Object.keys(unzipSync(bundle.bytes)).sort()).toEqual([
      'README.txt',
      'datatable/music_order.json',
      'gaiden_data.json',
    ]);
  });

  test('dani configs are written in the on-disk dani JSON style, with no project', async () => {
    const config = dan(1);
    const bundle = await buildServerBundle(request({
      parts: parts({ dan: true }),
      sources: { dan: config, gaiden: dan(20) },
    }));

    const zip = unzipSync(bundle.bytes);
    expect(Object.keys(zip).sort()).toEqual(['README.txt', 'dan_data.json']);
    const text = decoder.decode(zip['dan_data.json']);
    // Round-tripped through the dani codec: a borderType-1 row is written without
    // the per-song thresholds it does not use, and parsing restores them as 0.
    expect(parseDanConfig(text)).toEqual(config);
    // The dani on-disk style: no space after the key colon, no trailing newline.
    expect(text).toContain('"danId":1');
    expect(text.endsWith(']')).toBe(true);
  });

  test('a part selected without a source contributes nothing', async () => {
    const bundle = await buildServerBundle(request({
      format: 'json',
      parts: parts({ musicOrder: true, dan: true }),
      sources: { project: { root: root(), datatables: tables() } },
    }));

    expect(Object.keys(unzipSync(bundle.bytes))).not.toContain('dan_data.json');
  });

  test('an empty selection is rejected rather than zipping a lone README', async () => {
    await expect(buildServerBundle(request({ parts: parts({}) }))).rejects.toThrow(/[Nn]othing/);
  });

  test('the README lists every file and names the target path', async () => {
    const bundle = await buildServerBundle(request({
      format: 'json',
      parts: parts({ musicOrder: true, dan: true }),
      sources: { project: { root: root(), datatables: tables() }, dan: dan(1) },
    }));

    const readme = decoder.decode(unzipSync(bundle.bytes)['README.txt']);
    expect(readme).toContain('TaikoLocalServer/Host/wwwroot/data/');
    expect(readme).toContain('datatable/music_order.json');
    expect(readme).toContain('dan_data.json');
    expect(readme).not.toContain('README.txt (');
    expect(readme).toContain('matches what is currently loaded');
    // The reported file list covers the README itself too.
    expect(bundle.files.map((f) => f.path)).toContain('README.txt');
  });
});
