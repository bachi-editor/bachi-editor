import { describe, expect, test } from 'vitest';
import type { MusicOrderItem } from '../../src/codec';
import type { RawDatatables } from '../../src/fs/datatables';
import { buildSongIndex } from '../../src/model/songlist';
import {
  buildOrderFolders,
  createPlacementKeyFor,
  validateOrderFolder,
} from '../../src/ui/order/orderView';
import { createOrderSelectionStore } from '../../src/ui/order/orderSelection';

const data = (): RawDatatables => ({
  musicinfo: { items: [
    { uniqueId: 1, id: 'a', genreNo: 0 },
    { uniqueId: 2, id: 'b', genreNo: 0 },
    { uniqueId: 3, id: 'c', genreNo: 5 },
  ] },
  musicOrder: { items: [
    { uniqueId: 1, id: 'a', genreNo: 0 },
    { uniqueId: 2, id: 'b', genreNo: 0 },
    { uniqueId: 3, id: 'c', genreNo: 5 },
  ] },
  wordlist: { items: [] },
});

describe('Music Order view projection', () => {
  test('retains unchanged folders and placements across a local reorder', () => {
    const d = data();
    const songs = buildSongIndex(d);
    const keyFor = createPlacementKeyFor();
    const first = buildOrderFolders(d.musicOrder.items, songs.byId, [0, 5], keyFor);
    const reordered = [d.musicOrder.items[1], d.musicOrder.items[0], d.musicOrder.items[2]];
    const next = buildOrderFolders(reordered, songs.byId, [0, 5], keyFor, first);

    expect(next[1]).toBe(first[1]);
    expect(next[0]).not.toBe(first[0]);
    expect(next[0].placements.map((p) => p.key)).toEqual([
      first[0].placements[1].key,
      first[0].placements[0].key,
    ]);
  });

  test('assigns distinct stable keys to duplicate placement objects', () => {
    const d = data();
    const first = d.musicOrder.items[0];
    const duplicate: MusicOrderItem = { ...first };
    d.musicOrder.items.splice(1, 0, duplicate);
    const songs = buildSongIndex(d);
    const keyFor = createPlacementKeyFor();
    const folders = buildOrderFolders(d.musicOrder.items, songs.byId, [0, 5], keyFor);
    const keys = folders[0].placements.map((p) => p.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keyFor(first)).toBe(keys[0]);
    expect(keyFor(duplicate)).toBe(keys[1]);
  });

  test('reports repeated songs only within their genre and marks every matching card', () => {
    const d = data();
    const first = d.musicOrder.items[0];
    const duplicate: MusicOrderItem = { ...first };
    const otherGenre: MusicOrderItem = { ...first, genreNo: 5 };
    d.musicOrder.items = [first, d.musicOrder.items[1], duplicate, d.musicOrder.items[2], otherGenre];
    const songs = buildSongIndex(d);
    const folders = buildOrderFolders(
      d.musicOrder.items,
      songs.byId,
      [0, 5],
      createPlacementKeyFor(),
    );
    const genreZero = folders.find((folder) => folder.genreNo === 0)!;
    const genreFive = folders.find((folder) => folder.genreNo === 5)!;
    const validation = validateOrderFolder(genreZero.placements);

    expect(validation.issues).toHaveLength(1);
    expect(validation.issues[0]).toMatchObject({
      kind: 'duplicate-song',
      songId: 'a',
      indices: [1, 3],
    });
    expect([...validation.affectedPlacementKeys]).toEqual([
      genreZero.placements[0].key,
      genreZero.placements[2].key,
    ]);
    expect(genreZero.validation.issues).toEqual(validation.issues);
    expect(genreFive.validation.issues).toEqual([]);
  });
});

describe('Music Order selection store', () => {
  test('notifies only the previous and next placement', () => {
    const store = createOrderSelectionStore();
    const calls = [0, 0, 0];
    const unsubscribers = calls.map((_, i) => store.subscribe(i + 1, () => { calls[i] += 1; }));

    store.select(1);
    expect(calls).toEqual([1, 0, 0]);
    store.select(2);
    expect(calls).toEqual([2, 1, 0]);
    store.select(2);
    expect(calls).toEqual([2, 1, 0]);
    unsubscribers.forEach((unsubscribe) => unsubscribe());
  });
});
