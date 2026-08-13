import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import type { AssetInventory } from '../../src/fs/inventory';
import type { FumenSlot } from '../../src/fs/fumens';
import type { ProjectRoot } from '../../src/fs/project';
import type { RawDatatables } from '../../src/fs/datatables';
import { encodeFumen, readNus3BankDemoStartMs } from '../../src/codec';
import { buildSongIndex } from '../../src/model/songlist';
import { fumenKey } from '../../src/model/fumenDrafts';
import { makeBlankFumen } from '../../src/model/fumenScaffold';
import { soundMetadataKey } from '../../src/model/soundMetadata';
import { convertTjaForImport } from '../../src/model/tjaImport';
import { useAppStore, type OpenProject } from '../../src/model/store';
import { CHN_X64, HAS_CORPUS } from '../helpers/resources';

const SONG_ID = 'target';

const TJA = `
TITLE:Imported title
BPM:150
OFFSET:0
COURSE:Oni
LEVEL:8
SCOREINIT:1000
SCOREDIFF:100
#START
10101010,
#END
`;
const ONI: FumenSlot = { filename: 'target_m.bin', difficulty: 'oni', player: 'single' };
const URA: FumenSlot = { filename: 'target_x.bin', difficulty: 'ura', player: 'single' };

function datatables(): RawDatatables {
  return {
    musicinfo: { items: [{ uniqueId: 17, id: SONG_ID, starMania: 6, starUra: 9 }] },
    musicOrder: { items: [{ uniqueId: 17, id: SONG_ID, genreNo: 0 }] },
    wordlist: { items: [{ key: 'song_target', englishUsText: 'Old title' }] },
  };
}

/** The slice of the File System Access API that reading one sound bank needs. */
function soundRoot(banks: Record<string, Uint8Array>): ProjectRoot {
  const sound = {
    async getFileHandle(name: string) {
      const stored = banks[name];
      if (!stored) throw new DOMException(`no file ${name}`, 'NotFoundError');
      return {
        async getFile() {
          return { arrayBuffer: async () => stored.buffer.slice(stored.byteOffset, stored.byteOffset + stored.byteLength) };
        },
      };
    },
  };
  return { sound: sound as unknown as FileSystemDirectoryHandle } as ProjectRoot;
}

function resetStore(root: ProjectRoot = ({} as ProjectRoot), soundFiles = new Set<string>()): void {
  const dt = datatables();
  const oldFumen = makeBlankFumen('oni');
  const bytes = encodeFumen(oldFumen);
  const assets: AssetInventory = { fumenIds: new Set([SONG_ID]), soundFiles };
  const project: OpenProject = {
    root,
    baseline: dt,
    datatables: dt,
    songs: buildSongIndex(dt),
    assets,
    fumenBaselines: new Map([[
      fumenKey(SONG_ID, ONI.filename),
      { songId: SONG_ID, slot: ONI, fumen: oldFumen, bytes },
    ]]),
    fumenDrafts: new Map(),
    fumenCreated: new Map(),
    fumenRemoved: new Map(),
    soundMetadataBaselines: new Map(),
    soundMetadataDrafts: new Map(),
    undo: [],
    redo: [],
  };
  const state = useAppStore.getState();
  useAppStore.setState({
    project: { kind: 'open', project },
    selection: { songId: SONG_ID, difficulty: 'oni', player: 'single' },
    songDiskSlots: [ONI, URA],
    songSlots: [ONI, URA],
    fumen: { kind: 'ready', loaded: { ...ONI, songId: SONG_ID, bytes, fumen: oldFumen } },
    chart: { tool: 'select', branchFocus: 'all' },
    ui: { ...state.ui, tjaImportOpen: true, tab: 'metadata' },
    save: { kind: 'idle' },
  });
}

beforeEach(() => resetStore());

describe('TJA import store transaction', () => {
  test('replaces, creates, and removes charts atomically and supports undo/redo', async () => {
    const imported = convertTjaForImport(TJA);

    expect(await useAppStore.getState().importTja(17, imported)).toEqual({ ok: true });
    let state = useAppStore.getState();
    expect(state.ui.tjaImportOpen).toBe(false);
    expect(state.ui.tab).toBe('chart');
    expect(state.songSlots?.map((slot) => slot.filename)).toEqual([
      'target_m.bin', 'target_m_1.bin', 'target_m_2.bin',
    ]);
    expect(state.fumen.kind).toBe('ready');
    expect(state.fumen.kind === 'ready' && state.fumen.loaded.filename).toBe('target_m.bin');
    expect(state.project.kind).toBe('open');
    if (state.project.kind !== 'open') return;
    expect([...state.project.project.fumenDrafts.keys()]).toEqual(['target/target_m.bin']);
    expect([...state.project.project.fumenCreated.keys()].sort()).toEqual([
      'target/target_m_1.bin', 'target/target_m_2.bin',
    ]);
    expect([...state.project.project.fumenRemoved.keys()]).toEqual(['target/target_x.bin']);
    expect(state.project.project.songs.byId.get(SONG_ID)?.titles.title.englishUsText).toBe('Imported title');
    expect(state.project.project.songs.byId.get(SONG_ID)?.info).toMatchObject({ starMania: 8, starUra: 0 });
    expect(state.project.project.undo).toHaveLength(1);

    state.undo();
    state = useAppStore.getState();
    expect(state.songSlots?.map((slot) => slot.filename)).toEqual(['target_m.bin', 'target_x.bin']);
    expect(state.project.kind).toBe('open');
    if (state.project.kind !== 'open') return;
    expect(state.project.project.fumenDrafts.size).toBe(0);
    expect(state.project.project.fumenCreated.size).toBe(0);
    expect(state.project.project.fumenRemoved.size).toBe(0);
    expect(state.project.project.songs.byId.get(SONG_ID)?.titles.title.englishUsText).toBe('Old title');

    state.redo();
    state = useAppStore.getState();
    expect(state.songSlots?.map((slot) => slot.filename)).toEqual([
      'target_m.bin', 'target_m_1.bin', 'target_m_2.bin',
    ]);
    expect(state.project.kind === 'open' && state.project.project.fumenRemoved.has('target/target_x.bin')).toBe(true);
  });

  test('charts-only import rewrites the chart set and leaves metadata alone', async () => {
    const imported = convertTjaForImport(TJA);
    const before = useAppStore.getState().project;
    if (before.kind !== 'open') throw new Error('project not open');
    const datatablesBefore = before.project.datatables;

    expect(await useAppStore.getState().importTja(17, imported, {
      metadata: false, charts: true, demoStart: false,
    })).toEqual({ ok: true });

    const state = useAppStore.getState();
    if (state.project.kind !== 'open') throw new Error('project not open');
    expect([...state.project.project.fumenDrafts.keys()]).toEqual(['target/target_m.bin']);
    // Same datatables object: no title, star, or Shin-uchi field was rewritten.
    expect(state.project.project.datatables).toBe(datatablesBefore);
    expect(state.project.project.songs.byId.get(SONG_ID)?.titles.title.englishUsText).toBe('Old title');
    expect(state.project.project.songs.byId.get(SONG_ID)?.info).toMatchObject({ starMania: 6 });
  });

  test('metadata-only import leaves every chart file, the selection, and the open chart untouched', async () => {
    const imported = convertTjaForImport(TJA);
    const before = useAppStore.getState();
    const openedFumen = before.fumen.kind === 'ready' ? before.fumen.loaded.fumen : undefined;

    expect(await useAppStore.getState().importTja(17, imported, {
      metadata: true, charts: false, demoStart: false,
    })).toEqual({ ok: true });

    const state = useAppStore.getState();
    if (state.project.kind !== 'open') throw new Error('project not open');
    expect(state.project.project.fumenDrafts.size).toBe(0);
    expect(state.project.project.fumenCreated.size).toBe(0);
    expect(state.project.project.fumenRemoved.size).toBe(0);
    expect(state.songSlots?.map((slot) => slot.filename)).toEqual(['target_m.bin', 'target_x.bin']);
    expect(state.fumen.kind === 'ready' && state.fumen.loaded.fumen).toBe(openedFumen);
    // The chart set was not replaced, so the chart tab is not forced open either.
    expect(state.ui.tab).toBe('metadata');
    expect(state.ui.tjaImportOpen).toBe(false);
    expect(state.project.project.songs.byId.get(SONG_ID)?.titles.title.englishUsText).toBe('Imported title');
  });

  test.skipIf(!HAS_CORPUS)('writes the TJA DEMOSTART into the song bank as one pending sound edit', async () => {
    const buf = await readFile(resolve(CHN_X64, 'sound/song_10binz.nus3bank'));
    const bank = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    const bankName = `song_${SONG_ID}.nus3bank`;
    const currentMs = readNus3BankDemoStartMs(bank, `song_${SONG_ID}`);
    expect(currentMs).toBeDefined();
    resetStore(soundRoot({ [bankName]: bank }), new Set([bankName]));

    const imported = convertTjaForImport(TJA.replace('BPM:150', 'DEMOSTART:41.5\nBPM:150'));
    expect(imported.demoStartMs).toBe(41_500);
    expect(await useAppStore.getState().importTja(17, imported, {
      metadata: false, charts: false, demoStart: true,
    })).toEqual({ ok: true });

    const state = useAppStore.getState();
    if (state.project.kind !== 'open') throw new Error('project not open');
    const key = soundMetadataKey(bankName);
    // The bank's own value becomes the baseline, so the save diff has something
    // to compare against and the patch actually reaches disk.
    expect(state.project.project.soundMetadataBaselines.get(key)?.demoStartMs).toBe(currentMs);
    expect(state.project.project.soundMetadataDrafts.get(key)).toMatchObject({
      songId: SONG_ID,
      filename: bankName,
      preferredStem: `song_${SONG_ID}`,
      demoStartMs: 41_500,
    });
    // Charts and metadata stayed out of it, and the whole import is one undo step.
    expect(state.project.project.fumenDrafts.size).toBe(0);
    expect(state.project.project.songs.byId.get(SONG_ID)?.titles.title.englishUsText).toBe('Old title');
    expect(state.project.project.undo).toHaveLength(1);

    state.undo();
    const undone = useAppStore.getState().project;
    expect(undone.kind === 'open' && undone.project.soundMetadataDrafts.size).toBe(0);
  });

  test('skips the demo start when the song has no bank to write it into', async () => {
    const imported = convertTjaForImport(TJA.replace('BPM:150', 'DEMOSTART:41.5\nBPM:150'));
    expect(await useAppStore.getState().importTja(17, imported, {
      metadata: false, charts: false, demoStart: true,
    })).toEqual({ ok: true });

    const state = useAppStore.getState();
    if (state.project.kind !== 'open') throw new Error('project not open');
    expect(state.project.project.soundMetadataDrafts.size).toBe(0);
    expect(state.project.project.soundMetadataBaselines.size).toBe(0);
  });
});
