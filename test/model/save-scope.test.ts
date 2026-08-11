// The per-page save independence contract (see model/saveScope.ts): Songs and
// Music Order share one draft but own disjoint files. Saving one must never
// write the other's edits — except a deleted song's music_order rows, which
// travel with the Songs save so no placement is left pointing at a gone song.

import { describe, expect, test } from 'vitest';
import type { RawDatatables } from '../../src/fs/datatables';
import { deleteSong, reorderMusicOrder } from '../../src/model/edits';
import { scopedDatatables, orderScopeDirty, songsDatatableDirty } from '../../src/model/saveScope';

// genre0 = [a,b,c], genre5 = [d,e].
function fixture(): RawDatatables {
  const ids = [
    ['a', 0], ['b', 0], ['c', 0], ['d', 5], ['e', 5],
  ] as const;
  return {
    musicinfo: { items: ids.map(([id, g], i) => ({ uniqueId: i + 1, id, genreNo: g, starMania: 5 })) },
    musicOrder: { items: ids.map(([id, g], i) => ({ uniqueId: i + 1, id, genreNo: g })) },
    wordlist: { items: [] },
  };
}
const order = (d: RawDatatables) => d.musicOrder.items.map((o) => `${o.id}:${o.genreNo}`).join(' ');

describe('save scope', () => {
  test('a pure metadata edit is Songs-dirty only', () => {
    const base = fixture();
    const draft = { ...base, musicinfo: { items: base.musicinfo.items.map((it) => (it.id === 'a' ? { ...it, starMania: 9 } : it)) } };
    expect(songsDatatableDirty(base, draft)).toBe(true);
    expect(orderScopeDirty(base, draft)).toBe(false);
    // Order save writes nothing (music_order unchanged); Songs save carries the edit.
    expect(scopedDatatables(base, draft, 'order').musicinfo.items[0].starMania).toBe(5);
    expect(scopedDatatables(base, draft, 'songs').musicinfo.items[0].starMania).toBe(9);
  });

  test('a pure reorder is Order-dirty only', () => {
    const base = fixture();
    const draft = reorderMusicOrder(base, 'a', 0, 0, 0, 2); // a → slot 2 within genre0
    expect(orderScopeDirty(base, draft)).toBe(true);
    expect(songsDatatableDirty(base, draft)).toBe(false);
    // Order save applies the reorder; Songs save leaves music_order at baseline.
    expect(order(scopedDatatables(base, draft, 'order'))).toBe('b:0 a:0 c:0 d:5 e:5');
    expect(order(scopedDatatables(base, draft, 'songs'))).toBe(order(base));
  });

  test('a deletion is Songs-dirty and its rows ride the Songs save, not Order', () => {
    const base = fixture();
    const draft = deleteSong(base, 3); // remove 'c' (genre0)
    // Deleting a song is a Songs action even though it strips a music_order row.
    expect(songsDatatableDirty(base, draft)).toBe(true);
    expect(orderScopeDirty(base, draft)).toBe(false);
    // Songs save removes c's placement; Order save would not have to.
    expect(order(scopedDatatables(base, draft, 'songs'))).toBe('a:0 b:0 d:5 e:5');
    expect(scopedDatatables(base, draft, 'songs').musicinfo.items.some((i) => i.id === 'c')).toBe(false);
  });

  test('deletion + reorder: each write carries only its own part', () => {
    const base = fixture();
    const deleted = deleteSong(base, 3); // remove 'c' → genre0 = [a, b]
    const draft = reorderMusicOrder(deleted, 'a', 0, 0, 0, 2); // a → end of genre0
    expect(songsDatatableDirty(base, draft)).toBe(true);
    expect(orderScopeDirty(base, draft)).toBe(true);
    // Songs save: deletion applied, reorder NOT (existing songs keep baseline order).
    expect(order(scopedDatatables(base, draft, 'songs'))).toBe('a:0 b:0 d:5 e:5');
    // Order save: the full current draft (deletion already applied) incl. the reorder.
    expect(order(scopedDatatables(base, draft, 'order'))).toBe('b:0 a:0 d:5 e:5');
  });

  test('distinguishes duplicate placements through pass-through fields', () => {
    const base = fixture();
    const first = { ...base.musicOrder.items[0], closeDispType: 10 };
    const second = { ...base.musicOrder.items[0], closeDispType: 20 };
    base.musicOrder = { items: [first, second, ...base.musicOrder.items.slice(1)] };
    const draft = {
      ...base,
      musicOrder: { ...base.musicOrder, items: [second, first, ...base.musicOrder.items.slice(2)] },
    };

    expect(orderScopeDirty(base, draft)).toBe(true);
  });
});
