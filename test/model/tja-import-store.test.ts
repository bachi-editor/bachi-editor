import { beforeEach, describe, expect, test } from 'vitest';
import type { AssetInventory } from '../../src/fs/inventory';
import type { FumenSlot } from '../../src/fs/fumens';
import type { ProjectRoot } from '../../src/fs/project';
import type { RawDatatables } from '../../src/fs/datatables';
import { encodeFumen } from '../../src/codec';
import { buildSongIndex } from '../../src/model/songlist';
import { fumenKey } from '../../src/model/fumenDrafts';
import { makeBlankFumen } from '../../src/model/fumenScaffold';
import { convertTjaForImport } from '../../src/model/tjaImport';
import { useAppStore, type OpenProject } from '../../src/model/store';

const SONG_ID = 'target';
const ONI: FumenSlot = { filename: 'target_m.bin', difficulty: 'oni', player: 'single' };
const URA: FumenSlot = { filename: 'target_x.bin', difficulty: 'ura', player: 'single' };

function datatables(): RawDatatables {
  return {
    musicinfo: { items: [{ uniqueId: 17, id: SONG_ID, starMania: 6, starUra: 9 }] },
    musicOrder: { items: [{ uniqueId: 17, id: SONG_ID, genreNo: 0 }] },
    wordlist: { items: [{ key: 'song_target', englishUsText: 'Old title' }] },
  };
}

function resetStore(): void {
  const dt = datatables();
  const oldFumen = makeBlankFumen('oni');
  const bytes = encodeFumen(oldFumen);
  const assets: AssetInventory = { fumenIds: new Set([SONG_ID]), soundFiles: new Set() };
  const project: OpenProject = {
    root: {} as ProjectRoot,
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

beforeEach(resetStore);

describe('TJA import store transaction', () => {
  test('replaces, creates, and removes charts atomically and supports undo/redo', async () => {
    const imported = convertTjaForImport(`
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
`);

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
});
