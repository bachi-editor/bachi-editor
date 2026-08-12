// Phase 7.2 — net-zero editing through the real store/history leaves nothing
// dirty. Drives the actual zustand store (placeChartNote / eraseChartNote /
// undo) against an injected open project holding a real decoded chart, and
// asserts the save pipeline's dirty set (collectFumenDiffs, the same one
// commitSave builds dirtyFumens from) is empty after the edits are reverted —
// and that any surviving draft re-encodes to the original on-disk plaintext.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { useAppStore, type OpenProject } from '../../src/model/store';
import { buildSongIndex } from '../../src/model/songlist';
import { fumenKey } from '../../src/model/fumenDrafts';
import { decodeFumen } from '../../src/codec/fumen/decode';
import { encodeFumen } from '../../src/codec/fumen/encode';
import { openEnvelope } from '../../src/codec/envelope';
import { FUMEN_KEY_HEX } from '../helpers/keys';
import { measureDurationMs } from '../../src/model/fumenEdits';
import { summarizeFumenMetadata } from '../../src/model/fumenMetadata';
import type { RawDatatables } from '../../src/fs/datatables';
import type { AssetInventory } from '../../src/fs/inventory';
import type { FumenSlot } from '../../src/fs/fumens';
import type { ProjectRoot } from '../../src/fs/project';
import type { Fumen } from '../../src/codec';
import { CHN_X64, HAS_CORPUS } from '../helpers/resources';

const SONG_ID = 'aaa';
const SLOT: FumenSlot = { filename: 'aaa_m.bin', difficulty: 'oni', player: 'single' };
const KEY = fumenKey(SONG_ID, SLOT.filename);

let basePayload: Uint8Array;
let baseFumen: Fumen;

beforeAll(async () => {
  const buf = await readFile(resolve(CHN_X64, 'fumen/10binz/10binz_m.bin'));
  const { payload } = await openEnvelope(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), FUMEN_KEY_HEX);
  basePayload = payload;
  baseFumen = decodeFumen(payload);
});

function datatables(): RawDatatables {
  const derived = summarizeFumenMetadata(baseFumen);
  return {
    musicinfo: {
      items: [{
        uniqueId: 1,
        id: SONG_ID,
        genreNo: 0,
        starMania: 8,
        branchMania: derived.branch,
        maniaOnpuNum: derived.notes,
        rendaTimeMania: derived.renda,
        fuusenTotalMania: derived.fuusen,
      }],
    },
    musicOrder: { items: [{ uniqueId: 1, id: SONG_ID, genreNo: 0 }] },
    wordlist: { items: [{ key: 'song_aaa', japaneseText: 'A' }] },
  };
}

/** Inject a fresh open project with `baseFumen` as the loaded oni chart. */
function openWithChart(): void {
  const dt = datatables();
  const assets: AssetInventory = { fumenIds: new Set([SONG_ID]), soundFiles: new Set() };
  const project: OpenProject = {
    root: {} as unknown as ProjectRoot, // never touched: undo/place/diff are disk-free
    baseline: dt,
    datatables: dt,
    songs: buildSongIndex(dt),
    assets,
    fumenBaselines: new Map([[KEY, { songId: SONG_ID, slot: SLOT, fumen: baseFumen, bytes: basePayload }]]),
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
    fumen: { kind: 'ready', loaded: { ...SLOT, songId: SONG_ID, bytes: basePayload, fumen: baseFumen } },
    chart: { tool: 'don', branchFocus: 'all' },
    save: { kind: 'idle' },
  });
}

/** A position inside measure 0 not occupied by an existing branch-0 note. */
function freePosition(mi: number): number {
  const measure = baseFumen.measures[mi];
  const dur = measureDurationMs(measure);
  const taken = new Set(measure.branches[0].notes.map((n) => Math.round(n.position)));
  for (let frac = 1; frac < 16; frac++) {
    const pos = (dur * frac) / 16 + 0.137;
    if (!taken.has(Math.round(pos))) return pos;
  }
  return dur / 2 + 0.137;
}

function s() {
  return useAppStore.getState();
}

describe.skipIf(!HAS_CORPUS)('Phase 7.2 — net-zero editing leaves the save pipeline clean', () => {
  test('place a note then undo: edit count returns to 0 and no chart is dirty', () => {
    openWithChart();
    expect(s().getEditCount()).toBe(0);

    s().placeChartNote({ measureIndex: 0, branchIndex: 0, position: freePosition(0), tool: 'don' });
    expect(s().getEditCount()).toBe(2); // chart + synchronized musicinfo record
    expect(s().getFumenDiffs()).toHaveLength(1);

    s().undo();
    expect(s().getEditCount()).toBe(0);
    expect(s().getFumenDiffs()).toEqual([]);
  });

  test('place then erase the same note (forward revert): draft re-encodes to the original plaintext', () => {
    openWithChart();
    s().placeChartNote({ measureIndex: 0, branchIndex: 0, position: freePosition(0), tool: 'don' });
    const placed = s().chart.selectedNote;
    expect(placed).toBeDefined();

    s().eraseChartNote(placed!);

    // Forward revert keeps a draft entry, but it must be byte-identical to disk.
    expect(s().getFumenDiffs()).toEqual([]);
    expect(s().getEditCount()).toBe(0);
    const proj = s().project;
    if (proj.kind !== 'open') throw new Error('expected open project');
    const draft = proj.project.fumenDrafts.get(KEY);
    expect(draft).toBeDefined();
    expect([...encodeFumen(draft!)]).toEqual([...basePayload]);
  });

  test('N edits then N undos: history walks back to a pristine baseline', () => {
    openWithChart();
    const positions = [freePosition(0), freePosition(1), freePosition(2)];
    s().placeChartNote({ measureIndex: 0, branchIndex: 0, position: positions[0], tool: 'don' });
    s().placeChartNote({ measureIndex: 1, branchIndex: 0, position: positions[1], tool: 'ka' });
    s().placeChartNote({ measureIndex: 2, branchIndex: 0, position: positions[2], tool: 'don' });
    expect(s().getEditCount()).toBe(2); // chart + synchronized musicinfo record
    expect(s().getFumenDiffs()).toHaveLength(1);

    s().undo();
    s().undo();
    s().undo();

    expect(s().getEditCount()).toBe(0);
    expect(s().getFumenDiffs()).toEqual([]);
    // The displayed chart is back to the exact baseline reference.
    const fumen = s().fumen;
    if (fumen.kind !== 'ready') throw new Error('expected ready chart');
    expect([...encodeFumen(fumen.loaded.fumen)]).toEqual([...basePayload]);
  });

  test('redo after undo re-applies the edit (sanity: history is reversible)', () => {
    openWithChart();
    s().placeChartNote({ measureIndex: 0, branchIndex: 0, position: freePosition(0), tool: 'don' });
    s().undo();
    expect(s().getEditCount()).toBe(0);
    s().redo();
    expect(s().getEditCount()).toBe(2);
  });

  test('the Inspector branch toggle synchronizes musicinfo and undo restores both', () => {
    openWithChart();
    const before = baseFumen.header.hasBranches !== 0;

    s().updateChartHeader({ hasBranches: before ? 0 : 1 });

    const editedFumen = s().fumen;
    if (editedFumen.kind !== 'ready') throw new Error('expected ready chart');
    expect(editedFumen.loaded.fumen.header.hasBranches !== 0).toBe(!before);
    const editedProject = s().project;
    if (editedProject.kind !== 'open') throw new Error('expected open project');
    expect(editedProject.project.datatables.musicinfo.items[0].branchMania).toBe(!before);

    s().undo();
    const revertedFumen = s().fumen;
    if (revertedFumen.kind !== 'ready') throw new Error('expected ready chart');
    expect(revertedFumen.loaded.fumen.header.hasBranches !== 0).toBe(before);
    const revertedProject = s().project;
    if (revertedProject.kind !== 'open') throw new Error('expected open project');
    expect(revertedProject.project.datatables.musicinfo.items[0].branchMania).toBe(before);
  });
});
