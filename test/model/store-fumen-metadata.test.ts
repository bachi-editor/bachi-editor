import { beforeEach, describe, expect, test } from 'vitest';
import type { Fumen, FumenMeasure, FumenNote } from '../../src/codec';
import { encodeFumen, makeFumenHeader } from '../../src/codec';
import type { RawDatatables } from '../../src/fs/datatables';
import type { AssetInventory } from '../../src/fs/inventory';
import type { FumenSlot } from '../../src/fs/fumens';
import type { ProjectRoot } from '../../src/fs/project';
import { fumenKey } from '../../src/model/fumenDrafts';
import { summarizeFumenMetadata } from '../../src/model/fumenMetadata';
import { buildSongIndex } from '../../src/model/songlist';
import { useAppStore, type OpenProject } from '../../src/model/store';

const SONG_ID = 'aaa';
const SLOT: FumenSlot = { filename: 'aaa_m.bin', difficulty: 'oni', player: 'single' };
const KEY = fumenKey(SONG_ID, SLOT.filename);

function note(type: number, position = 0): FumenNote {
  return { type, position, item: 0, padding: 0, scoreInit: 0, scoreDiff: 0, duration: 0 };
}

function makeChart(): Fumen {
  const shared = [note(0x1, 100)];
  const measure: FumenMeasure = {
    bpm: 120,
    offset: 0,
    gogo: 0,
    barline: 1,
    padding1: 0,
    branchInfo: [-1, -1, -1, -1, -1, -1],
    padding2: 0,
    branches: [
      { padding: 0, speed: 1, notes: shared },
      { padding: 0, speed: 1, notes: [] },
      { padding: 0, speed: 1, notes: shared.map((value) => ({ ...value })) },
    ],
  };
  return { header: makeFumenHeader({ measureCount: 1 }), measures: [measure], trailer: new Uint8Array() };
}

beforeEach(() => {
  const fumen = makeChart();
  const bytes = encodeFumen(fumen);
  const derived = summarizeFumenMetadata(fumen);
  const datatables: RawDatatables = {
    musicinfo: {
      items: [{
        uniqueId: 1,
        id: SONG_ID,
        genreNo: 0,
        starMania: 8,
        starUra: 0,
        branchMania: derived.branch,
        maniaOnpuNum: derived.notes,
        rendaTimeMania: derived.renda,
        fuusenTotalMania: derived.fuusen,
      }],
    },
    musicOrder: { items: [{ uniqueId: 1, id: SONG_ID, genreNo: 0 }] },
    wordlist: { items: [{ key: 'song_aaa', japaneseText: 'A' }] },
  };
  const assets: AssetInventory = { fumenIds: new Set([SONG_ID]), soundFiles: new Set() };
  const project: OpenProject = {
    root: {} as ProjectRoot,
    baseline: datatables,
    datatables,
    songs: buildSongIndex(datatables),
    assets,
    fumenBaselines: new Map([[KEY, { songId: SONG_ID, slot: SLOT, fumen, bytes }]]),
    fumenDrafts: new Map(),
    fumenCreated: new Map(),
    fumenRemoved: new Map(),
    soundMetadataBaselines: new Map(),
    soundMetadataDrafts: new Map(),
    undo: [],
    redo: [],
  };
  useAppStore.setState({
    project: { kind: 'open', project },
    selection: { songId: SONG_ID, difficulty: 'oni', player: 'single' },
    songSlots: [SLOT],
    songDiskSlots: [SLOT],
    fumen: { kind: 'ready', loaded: { ...SLOT, songId: SONG_ID, bytes, fumen } },
    chart: { tool: 'don', branchFocus: 'all' },
    save: { kind: 'idle' },
  });
});

function state() {
  return useAppStore.getState();
}

describe('store chart/musicinfo synchronization', () => {
  test('Inspector branching updates musicinfo and undo restores both', () => {
    state().updateChartHeader({ hasBranches: 1 });

    const editedFumen = state().fumen;
    if (editedFumen.kind !== 'ready') throw new Error('expected ready fumen');
    expect(editedFumen.loaded.fumen.header.hasBranches).toBe(1);
    const editedProject = state().project;
    if (editedProject.kind !== 'open') throw new Error('expected open project');
    expect(editedProject.project.datatables.musicinfo.items[0].branchMania).toBe(true);

    state().undo();
    const revertedFumen = state().fumen;
    if (revertedFumen.kind !== 'ready') throw new Error('expected ready fumen');
    expect(revertedFumen.loaded.fumen.header.hasBranches).toBe(0);
    const revertedProject = state().project;
    if (revertedProject.kind !== 'open') throw new Error('expected open project');
    expect(revertedProject.project.datatables.musicinfo.items[0].branchMania).toBe(false);
  });

  test('Metadata branch toggle patches the chart header and stays in sync with the Inspector', async () => {
    // Toggling branch on for the loaded difficulty edits the chart's hasBranches
    // flag (same as the Inspector) and syncs the derived musicinfo branch flag.
    await state().setDifficultyBranch(1, 'oni', true);

    const editedFumen = state().fumen;
    if (editedFumen.kind !== 'ready') throw new Error('expected ready fumen');
    expect(editedFumen.loaded.fumen.header.hasBranches).toBe(1);
    let project = state().project;
    if (project.kind !== 'open') throw new Error('expected open project');
    expect(project.project.fumenDrafts.get(KEY)?.header.hasBranches).toBe(1);
    expect(project.project.datatables.musicinfo.items[0].branchMania).toBe(true);

    // Undo restores both the chart header and the musicinfo flag.
    state().undo();
    const revertedFumen = state().fumen;
    if (revertedFumen.kind !== 'ready') throw new Error('expected ready fumen');
    expect(revertedFumen.loaded.fumen.header.hasBranches).toBe(0);
    project = state().project;
    if (project.kind !== 'open') throw new Error('expected open project');
    expect(project.project.datatables.musicinfo.items[0].branchMania).toBe(false);
  });

  test('Metadata branch toggle for a difficulty with no chart just records the flag', async () => {
    // No easy chart slot exists, so there is nothing to patch — the toggle still
    // persists the musicinfo flag so it round-trips on save.
    await state().setDifficultyBranch(1, 'easy', true);
    const project = state().project;
    if (project.kind !== 'open') throw new Error('expected open project');
    expect(project.project.datatables.musicinfo.items[0].branchEasy).toBe(true);
    expect(project.project.fumenDrafts.size).toBe(0);
  });

  test('placing a playable note increments the read-only note count', () => {
    state().placeChartNote({ measureIndex: 0, branchIndex: 0, position: 500, tool: 'ka' });
    const project = state().project;
    if (project.kind !== 'open') throw new Error('expected open project');
    expect(project.project.datatables.musicinfo.items[0].maniaOnpuNum).toBe(2);
  });

  test('Ura chart creation is independent of metadata enablement', async () => {
    // The chart can be authored while Ura metadata is still disabled (starUra 0).
    await state().createUraChart(1);
    let project = state().project;
    if (project.kind !== 'open') throw new Error('expected open project');
    expect(project.project.fumenCreated.size).toBe(1);
    // Chart-derived counts sync from Oni, but the star flag stays off…
    expect(project.project.datatables.musicinfo.items[0].uraOnpuNum).toBe(1);
    expect(project.project.datatables.musicinfo.items[0].starUra).toBe(0);
    // …and the freshly created Ura is selectable even while not enabled.
    expect(state().selection.difficulty).toBe('ura');

    // Enabling metadata is a separate action that only flips the star.
    state().setUraEnabled(1, true);
    project = state().project;
    if (project.kind !== 'open') throw new Error('expected open project');
    expect(project.project.datatables.musicinfo.items[0].starUra).toBe(8);
    expect(project.project.fumenCreated.size).toBe(1);

    // Disabling metadata keeps the chart and leaves the user on it (only warned).
    state().setUraEnabled(1, false);
    project = state().project;
    if (project.kind !== 'open') throw new Error('expected open project');
    expect(project.project.datatables.musicinfo.items[0].starUra).toBe(0);
    expect(project.project.fumenCreated.size).toBe(1);
    expect(state().selection.difficulty).toBe('ura');
  });
});
