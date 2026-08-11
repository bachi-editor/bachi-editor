import { beforeEach, describe, expect, test } from 'vitest';
import type { RawDatatables } from '../../src/fs/datatables';
import type { ProjectRoot } from '../../src/fs/project';
import { buildSongIndex } from '../../src/model/songlist';
import { useAppStore, type OpenProject } from '../../src/model/store';

const fixture = (): RawDatatables => ({
  musicinfo: { items: [
    { uniqueId: 1, id: 'a', genreNo: 0 },
    { uniqueId: 2, id: 'b', genreNo: 0 },
  ] },
  musicOrder: { items: [
    { uniqueId: 1, id: 'a', genreNo: 0 },
    { uniqueId: 2, id: 'b', genreNo: 0 },
  ] },
  wordlist: { items: [
    { key: 'song_a', englishUsText: 'A' },
    { key: 'song_b', englishUsText: 'B' },
  ] },
});

beforeEach(() => {
  const datatables = fixture();
  const project: OpenProject = {
    root: {} as ProjectRoot,
    baseline: datatables,
    datatables,
    songs: buildSongIndex(datatables),
    assets: { fumenIds: new Set(), soundFiles: new Set() },
    fumenBaselines: new Map(),
    fumenDrafts: new Map(),
    fumenCreated: new Map(),
    fumenRemoved: new Map(),
    soundMetadataBaselines: new Map(),
    soundMetadataDrafts: new Map(),
    undo: [],
    redo: [],
  };
  useAppStore.setState({ project: { kind: 'open', project }, save: { kind: 'idle' } });
});

describe('Music Order store projection', () => {
  test('reorder and history retain canonical row and lookup identities', () => {
    const before = useAppStore.getState().project;
    if (before.kind !== 'open') throw new Error('expected open project');
    const byId = before.project.songs.byId;
    const rowA = byId.get('a');
    const rowB = byId.get('b');

    useAppStore.getState().reorderSong('a', 0, 0, 0, 2);
    let current = useAppStore.getState().project;
    if (current.kind !== 'open') throw new Error('expected open project');
    expect(current.project.songs.byId).toBe(byId);
    expect(current.project.songs.rows).toEqual([rowB, rowA]);

    useAppStore.getState().undo();
    current = useAppStore.getState().project;
    if (current.kind !== 'open') throw new Error('expected open project');
    expect(current.project.songs.byId).toBe(byId);
    expect(current.project.songs.rows).toEqual([rowA, rowB]);

    useAppStore.getState().redo();
    current = useAppStore.getState().project;
    if (current.kind !== 'open') throw new Error('expected open project');
    expect(current.project.songs.byId).toBe(byId);
    expect(current.project.songs.rows).toEqual([rowB, rowA]);
  });
});
