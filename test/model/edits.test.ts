import { describe, expect, test } from 'vitest';
import type { RawDatatables } from '../../src/fs/datatables';
import {
  editMusicInfo,
  syncChartMetadata,
  setStar,
  setUraEnabled,
  setTitle,
  setSubtitle,
  reorderMusicOrder,
  sortMusicOrderGenre,
  insertMusicOrderEntry,
  removeMusicOrderEntry,
  addSong,
  deleteSong,
  nextUniqueId,
} from '../../src/model/edits';
import { diffDatatables, dirtySongIds, songIsDirty } from '../../src/model/diff';
import { validate } from '../../src/model/validation';
import { sealDatatable } from '../../src/fs/write';
import { MUSICINFO_SUPPORTED_FIELDS, openEnvelope, decodeJsonPayload } from '../../src/codec';
import { DATATABLE_KEY_HEX } from '../helpers/keys';

function fixture(): RawDatatables {
  return {
    musicinfo: {
      items: [
        { uniqueId: 1, id: 'aaa', genreNo: 0, starEasy: 3, starNormal: 5, starHard: 7, starMania: 8, starUra: 0 },
        { uniqueId: 2, id: 'bbb', genreNo: 5, starMania: 9, starUra: 0 },
      ],
    },
    musicOrder: {
      items: [
        { uniqueId: 1, id: 'aaa', genreNo: 0 },
        { uniqueId: 2, id: 'bbb', genreNo: 5 },
      ],
    },
    wordlist: {
      items: [
        { key: 'song_aaa', japaneseText: 'A', englishUsText: 'A-en', chineseTText: '', chineseSText: '', koreanText: '' },
      ],
    },
  };
}

describe('edit transforms', () => {
  test('editMusicInfo is immutable and structurally shared', () => {
    const d = fixture();
    const next = editMusicInfo(d, 1, { papamama: true });
    expect(next).not.toBe(d);
    expect(d.musicinfo.items[0].papamama).toBeUndefined(); // original untouched
    expect(next.musicinfo.items[0].papamama).toBe(true);
    expect(next.musicinfo.items[1]).toBe(d.musicinfo.items[1]); // unchanged item shared
  });

  test('editMusicInfo returns same ref on no-op', () => {
    const d = fixture();
    expect(editMusicInfo(d, 1, { starMania: 8 })).toBe(d);
  });

  test('setStar clamps to 0..10 and rounds', () => {
    const d = fixture();
    expect(setStar(d, 1, 'starMania', 99).musicinfo.items[0].starMania).toBe(10);
    expect(setStar(d, 1, 'starMania', -4).musicinfo.items[0].starMania).toBe(0);
    expect(setStar(d, 1, 'starMania', 6.6).musicinfo.items[0].starMania).toBe(7);
  });

  test('editMusicInfo supports current extended fields without touching identity', () => {
    const d = fixture();
    const next = editMusicInfo(d, 1, {
      papamama: true,
      shinutiScoreManiaDuet: 1_002_320,
      spikeOnOni: true,
    });
    const item = next.musicinfo.items[0];
    expect(item.uniqueId).toBe(1);
    expect(item.id).toBe('aaa');
    expect(item.genreNo).toBe(0);
    expect(item.papamama).toBe(true);
    expect(item.shinutiScoreManiaDuet).toBe(1_002_320);
    expect(item.spikeOnOni).toBe(true);
    expect(next.musicOrder).toBe(d.musicOrder);
  });

  test('setUraEnabled on uses Oni star as default, off zeroes', () => {
    const d = fixture();
    const on = setUraEnabled(d, 1, true);
    expect(on.musicinfo.items[0].starUra).toBe(8); // mirrors starMania
    expect(setUraEnabled(on, 1, false).musicinfo.items[0].starUra).toBe(0);
  });

  test('localized title/subtitle edits update and scaffold their wordlist rows', () => {
    const d = fixture();
    const titled = setTitle(d, 'aaa', 'englishUsText', 'New title');
    expect(titled.wordlist.items[0].englishUsText).toBe('New title');

    // bbb has no subtitle entry — should scaffold all five locales.
    const scaffolded = setSubtitle(d, 'bbb', 'japaneseText', 'サブ');
    const row = scaffolded.wordlist.items.find((w) => w.key === 'song_sub_bbb');
    expect(row).toBeDefined();
    expect(row!.japaneseText).toBe('サブ');
    expect(row!.koreanText).toBe('');
  });
});

describe('reorderMusicOrder', () => {
  // Folder genre0 = [a,b,c], genre5 = [d,e]. Placement and metadata genres are independent.
  function orderFixture(): RawDatatables {
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

  test('within-folder move shifts a card', () => {
    const d = orderFixture();
    // a: genre0 slot0 → slot2; c: genre0 slot2 → slot0.
    expect(order(reorderMusicOrder(d, 'a', 0, 0, 0, 2))).toBe('b:0 a:0 c:0 d:5 e:5');
    expect(order(reorderMusicOrder(d, 'c', 0, 2, 0, 0))).toBe('c:0 a:0 b:0 d:5 e:5');
  });

  test('dropping a card on its own slot is a no-op (same ref)', () => {
    const d = orderFixture();
    expect(reorderMusicOrder(d, 'a', 0, 0, 0, 0)).toBe(d);
    expect(reorderMusicOrder(d, 'a', 0, 0, 0, 1)).toBe(d);
  });

  test('cross-folder move rewrites only the placement genre and keeps the run contiguous', () => {
    const d = orderFixture();
    const next = reorderMusicOrder(d, 'a', 0, 0, 5, 0);
    expect(order(next)).toBe('b:0 c:0 a:5 d:5 e:5');
    expect(next.musicinfo).toBe(d.musicinfo);
    expect(next.musicinfo.items.find((i) => i.id === 'a')!.genreNo).toBe(0);
  });

  test('cross-folder move to end of target folder', () => {
    const d = orderFixture();
    expect(order(reorderMusicOrder(d, 'a', 0, 0, 5, 9))).toBe('b:0 c:0 d:5 e:5 a:5');
  });

  test('a song in two genres moves only the dragged copy', () => {
    // 'a' is listed in both genre0 (slot0) and genre5 (slot0). Dragging the
    // genre5 copy to the end of genre5 must leave the genre0 copy untouched —
    // the old id-only findIndex moved the first (genre0) copy instead.
    const uid = { a: 1, b: 2, d: 4, e: 5 } as const;
    const d: RawDatatables = {
      musicinfo: {
        items: [
          { uniqueId: uid.a, id: 'a', genreNo: 0, starMania: 5 },
          { uniqueId: uid.b, id: 'b', genreNo: 0, starMania: 5 },
          { uniqueId: uid.d, id: 'd', genreNo: 5, starMania: 5 },
          { uniqueId: uid.e, id: 'e', genreNo: 5, starMania: 5 },
        ],
      },
      musicOrder: {
        items: [
          { uniqueId: uid.a, id: 'a', genreNo: 0 },
          { uniqueId: uid.b, id: 'b', genreNo: 0 },
          { uniqueId: uid.a, id: 'a', genreNo: 5 },
          { uniqueId: uid.d, id: 'd', genreNo: 5 },
          { uniqueId: uid.e, id: 'e', genreNo: 5 },
        ],
      },
      wordlist: { items: [] },
    };
    const next = reorderMusicOrder(d, 'a', 5, 0, 5, 3);
    expect(order(next)).toBe('a:0 b:0 d:5 e:5 a:5');
    // The other-genre duplicate must not have been genre-rewritten.
    expect(next.musicinfo.items.find((i) => i.id === 'a')!.genreNo).toBe(0);
  });

  test('a song appearing twice in one genre moves the exact dragged copy', () => {
    // Two 'a' entries in genre0, distinguished only by a hidden field. The
    // folder shows [a, a, b]; dragging each copy must move that copy.
    const a0 = { uniqueId: 1, id: 'a', genreNo: 0, closeDispType: 10 };
    const a1 = { uniqueId: 1, id: 'a', genreNo: 0, closeDispType: 20 };
    const b = { uniqueId: 2, id: 'b', genreNo: 0 };
    const base: RawDatatables = {
      musicinfo: {
        items: [
          { uniqueId: 1, id: 'a', genreNo: 0, starMania: 5 },
          { uniqueId: 2, id: 'b', genreNo: 0, starMania: 5 },
        ],
      },
      musicOrder: { items: [a0, a1, b] },
      wordlist: { items: [] },
    };
    // Drag slot 0 (a0) to the end → [a1, b, a0].
    expect(reorderMusicOrder(base, 'a', 0, 0, 0, 3).musicOrder.items).toEqual([a1, b, a0]);
    // Drag slot 1 (a1) to the front → [a1, a0, b].
    expect(reorderMusicOrder(base, 'a', 0, 1, 0, 0).musicOrder.items).toEqual([a1, a0, b]);
  });

  test('swapping two same-genre duplicates is applied, not dropped as a no-op', () => {
    // a0/a1 share id + genre, so an id:genre signature can't tell the swap from
    // the original — the move must still be applied (regression).
    const a0 = { uniqueId: 1, id: 'a', genreNo: 0, closeDispType: 10 };
    const a1 = { uniqueId: 1, id: 'a', genreNo: 0, closeDispType: 20 };
    const b = { uniqueId: 2, id: 'b', genreNo: 0 };
    const base: RawDatatables = {
      musicinfo: { items: [{ uniqueId: 1, id: 'a', genreNo: 0 }, { uniqueId: 2, id: 'b', genreNo: 0 }] },
      musicOrder: { items: [a0, a1, b] },
      wordlist: { items: [] },
    };
    const next = reorderMusicOrder(base, 'a', 0, 0, 0, 2); // a0 → before b
    expect(next).not.toBe(base);
    expect(next.musicOrder.items).toEqual([a1, a0, b]);
    expect(diffDatatables(base, next).files.find((file) => file.file === 'music_order.bin')?.dirty).toBe(true);
  });

  test('unknown song id is a no-op', () => {
    const d = orderFixture();
    expect(reorderMusicOrder(d, 'zzz', 0, 0, 0, 0)).toBe(d);
  });

  test('reorder is structurally shared (unmoved items keep their reference)', () => {
    const d = orderFixture();
    const next = reorderMusicOrder(d, 'c', 0, 2, 0, 0);
    expect(next).not.toBe(d);
    expect(next.wordlist).toBe(d.wordlist); // untouched table shared
  });

  test('sortMusicOrderGenre sorts one folder by displayed title', () => {
    const d: RawDatatables = {
      ...orderFixture(),
      wordlist: {
        items: [
          { key: 'song_a', englishUsText: 'Zulu' },
          { key: 'song_b', englishUsText: 'Alpha' },
          { key: 'song_c', chineseSText: 'Beta' }, // falls back from English
          { key: 'song_d', englishUsText: 'Aardvark' },
          { key: 'song_e', englishUsText: 'Echo' },
        ],
      },
    };

    const next = sortMusicOrderGenre(d, 0, 'englishUsText');

    expect(order(next)).toBe('b:0 c:0 a:0 d:5 e:5');
    expect(next.musicinfo).toBe(d.musicinfo);
    expect(next.wordlist).toBe(d.wordlist);
  });

  test('sortMusicOrderGenre is a no-op when the folder is already sorted', () => {
    const d: RawDatatables = {
      ...orderFixture(),
      wordlist: {
        items: [
          { key: 'song_a', englishUsText: 'Alpha' },
          { key: 'song_b', englishUsText: 'Beta' },
          { key: 'song_c', englishUsText: 'Gamma' },
        ],
      },
    };

    expect(sortMusicOrderGenre(d, 0, 'englishUsText')).toBe(d);
  });

  test('insertMusicOrderEntry adds a placement at the top of the folder', () => {
    const d = orderFixture();
    // 'd' (uniqueId 4) added to genre0 lands before that folder's first card.
    expect(order(insertMusicOrderEntry(d, 4, 0))).toBe('d:0 a:0 b:0 c:0 d:5 e:5');
    // Added to genre5, it lands before 'd' (the folder's current first card).
    expect(order(insertMusicOrderEntry(d, 1, 5))).toBe('a:0 b:0 c:0 a:5 d:5 e:5');
  });

  test('insertMusicOrderEntry appends when the target folder is empty', () => {
    const d = orderFixture();
    // Genre 3 has no run yet, so the new single-entry run appends to keep the
    // genre-contiguous invariant.
    expect(order(insertMusicOrderEntry(d, 2, 3))).toBe('a:0 b:0 c:0 d:5 e:5 b:3');
  });

  test('insertMusicOrderEntry is a no-op for an unknown song and shares tables', () => {
    const d = orderFixture();
    expect(insertMusicOrderEntry(d, 999, 0)).toBe(d);
    const next = insertMusicOrderEntry(d, 4, 0);
    expect(next).not.toBe(d);
    expect(next.musicinfo).toBe(d.musicinfo);
    expect(next.wordlist).toBe(d.wordlist);
  });

  test('removeMusicOrderEntry drops the addressed placement only', () => {
    const d = orderFixture();
    expect(order(removeMusicOrderEntry(d, 'b', 0, 1))).toBe('a:0 c:0 d:5 e:5');
    expect(order(removeMusicOrderEntry(d, 'd', 5, 0))).toBe('a:0 b:0 c:0 e:5');
    // musicinfo is untouched — only the placement is gone.
    expect(removeMusicOrderEntry(d, 'b', 0, 1).musicinfo).toBe(d.musicinfo);
  });

  test('removeMusicOrderEntry removes the exact same-genre duplicate copy', () => {
    const a0 = { uniqueId: 1, id: 'a', genreNo: 0, closeDispType: 10 };
    const a1 = { uniqueId: 1, id: 'a', genreNo: 0, closeDispType: 20 };
    const b = { uniqueId: 2, id: 'b', genreNo: 0 };
    const d: RawDatatables = {
      musicinfo: { items: [{ uniqueId: 1, id: 'a', genreNo: 0 }, { uniqueId: 2, id: 'b', genreNo: 0 }] },
      musicOrder: { items: [a0, a1, b] },
      wordlist: { items: [] },
    };
    expect(removeMusicOrderEntry(d, 'a', 0, 0).musicOrder.items).toEqual([a1, b]);
    expect(removeMusicOrderEntry(d, 'a', 0, 1).musicOrder.items).toEqual([a0, b]);
  });

  test('removeMusicOrderEntry is a no-op when the slot does not hold the song', () => {
    const d = orderFixture();
    expect(removeMusicOrderEntry(d, 'a', 0, 1)).toBe(d); // slot1 of genre0 is 'b'
    expect(removeMusicOrderEntry(d, 'a', 0, 9)).toBe(d); // out of range
    expect(removeMusicOrderEntry(d, 'a', 7, 0)).toBe(d); // no such folder
  });
});

describe('addSong / deleteSong', () => {
  test('nextUniqueId is max + 1', () => {
    expect(nextUniqueId(fixture())).toBe(3); // fixture has uids 1, 2
  });

  test('addSong scaffolds canonical metadata and title without changing Music Order', () => {
    const d = fixture();
    const next = addSong(d, { uniqueId: 42, id: 'newone', genreNo: 0, title: 'New One' });
    const mi = next.musicinfo.items.find((i) => i.id === 'newone')!;
    expect(mi.uniqueId).toBe(42);
    expect(mi.genreNo).toBe(0);
    expect(mi.starMania).toBe(0);
    expect(mi.shinutiScoreUraDuet).toBe(0);
    expect(mi.spikeOnOni).toBe(false);
    expect(new Set(Object.keys(mi))).toEqual(
      new Set(['uniqueId', 'id', 'genreNo', ...MUSICINFO_SUPPORTED_FIELDS]),
    );
    expect(next.musicOrder).toBe(d.musicOrder);
    expect(next.musicOrder.items.map((o) => o.id)).toEqual(['aaa', 'bbb']);
    expect(diffDatatables(d, next).files.find((f) => f.file === 'music_order.bin')?.dirty).toBe(false);
    // title seeded into every locale.
    const wl = next.wordlist.items.find((w) => w.key === 'song_newone')!;
    expect(wl.japaneseText).toBe('New One');
    expect(wl.koreanText).toBe('New One');
  });

  test('addSong leaves Music Order unchanged when the canonical genre has no folder', () => {
    const d = fixture();
    const next = addSong(d, { uniqueId: 43, id: 'cls', genreNo: 7, title: 'C' });
    expect(next.musicOrder).toBe(d.musicOrder);
    expect(next.musicOrder.items.some((o) => o.id === 'cls')).toBe(false);
  });

  test('addSong rejects missing/duplicate immutable fields (same ref)', () => {
    const d = fixture();
    expect(addSong(d, { uniqueId: 3, id: '   ', genreNo: 0, title: 'T' })).toBe(d);
    expect(addSong(d, { uniqueId: 3, id: 'aaa', genreNo: 0, title: 'T' })).toBe(d);
    expect(addSong(d, { uniqueId: 1, id: 'fresh', genreNo: 0, title: 'T' })).toBe(d);
    expect(addSong(d, { uniqueId: 3, id: 'fresh', genreNo: 0, title: '   ' })).toBe(d);
  });

  test('deleteSong removes the song from every table', () => {
    const d = setSubtitle(fixture(), 'aaa', 'japaneseText', 'sub'); // give aaa a sub row
    const next = deleteSong(d, 1); // aaa
    expect(next.musicinfo.items.some((i) => i.id === 'aaa')).toBe(false);
    expect(next.musicOrder.items.some((o) => o.id === 'aaa')).toBe(false);
    expect(next.wordlist.items.some((w) => w.key.includes('aaa'))).toBe(false);
    // other song untouched.
    expect(next.musicinfo.items.some((i) => i.id === 'bbb')).toBe(true);
  });

  test('add then delete round-trips back to the original sequence', () => {
    const d = fixture();
    const added = addSong(d, { uniqueId: 77, id: 'tmp', genreNo: 5, title: 'T' });
    const removed = deleteSong(added, 77);
    expect(removed.musicinfo.items.map((i) => i.id)).toEqual(d.musicinfo.items.map((i) => i.id));
    expect(removed.musicOrder.items.map((o) => o.id)).toEqual(d.musicOrder.items.map((o) => o.id));
  });

  test('deleteSong on unknown uniqueId is a no-op (same ref)', () => {
    const d = fixture();
    expect(deleteSong(d, 999)).toBe(d);
  });
});

describe('diff', () => {
  test('detects musicinfo + wordlist changes', () => {
    const base = fixture();
    let draft = setStar(base, 1, 'starMania', 9);
    draft = setSubtitle(draft, 'aaa', 'englishUsText', 'Z');
    const diff = diffDatatables(base, draft);
    expect(diff.dirty).toBe(true);
    const mi = diff.files.find((f) => f.file === 'musicinfo.bin')!;
    expect(mi.dirty).toBe(true);
    expect(mi.changes.some((c) => c.label.includes('starMania') && c.from === '8' && c.to === '9')).toBe(true);
    const wl = diff.files.find((f) => f.file === 'wordlist.bin')!;
    expect(wl.dirty).toBe(true);
    expect(diff.totalEdits).toBeGreaterThanOrEqual(2);
  });

  test('extended musicinfo fields participate in dirty state and save diff', () => {
    const base = fixture();
    const editable = editMusicInfo(base, 1, { papamama: true });
    const draft = syncChartMetadata(editable, 1, { rendaTimeEasy: 1.5 });
    const diff = diffDatatables(base, draft);
    const musicinfo = diff.files.find((file) => file.file === 'musicinfo.bin')!;
    expect(musicinfo.dirty).toBe(true);
    expect(musicinfo.changes.map((change) => change.label)).toEqual(
      expect.arrayContaining(['aaa · papamama', 'aaa · rendaTimeEasy']),
    );
    expect(dirtySongIds(base, draft)).toContain('aaa');
    expect(songIsDirty(base, draft, 'aaa', 1)).toBe(true);
  });

  test('reports added and removed songs, removed wordlist keys, and order changes', () => {
    const base = fixture();
    const draft: RawDatatables = {
      musicinfo: {
        items: [
          base.musicinfo.items[1],
          { uniqueId: 3, id: 'ccc', genreNo: 2, starMania: 6 },
        ],
      },
      musicOrder: {
        items: [
          base.musicOrder.items[1],
          { uniqueId: 3, id: 'ccc', genreNo: 2 },
        ],
      },
      wordlist: { items: [{ key: 'song_ccc', englishUsText: 'C' }] },
    };

    const diff = diffDatatables(base, draft);
    const musicinfo = diff.files.find((f) => f.file === 'musicinfo.bin')!;
    const order = diff.files.find((f) => f.file === 'music_order.bin')!;
    const wordlist = diff.files.find((f) => f.file === 'wordlist.bin')!;

    expect(musicinfo.changes.map((c) => c.label)).toEqual(expect.arrayContaining(['+ song ccc', '− song aaa']));
    expect(order.changes).toEqual([{ label: 'sequence', from: '2 entries', to: '2 entries' }]);
    expect(wordlist.changes.map((c) => c.label)).toContain('− song_aaa');
  });

  test('clean draft reports no edits', () => {
    const base = fixture();
    expect(diffDatatables(base, base).dirty).toBe(false);
    expect(diffDatatables(base, base).totalEdits).toBe(0);
  });

  test('dirtySongIds + songIsDirty track edited songs', () => {
    const base = fixture();
    const draft = setStar(base, 2, 'starMania', 10);
    expect([...dirtySongIds(base, draft)]).toEqual(['bbb']);
    expect(songIsDirty(base, draft, 'bbb', 2)).toBe(true);
    expect(songIsDirty(base, draft, 'aaa', 1)).toBe(false);
  });

  test('dirtySongIds + songIsDirty track edited subtitle rows', () => {
    const base = fixture();
    const draft = setSubtitle(base, 'aaa', 'englishUsText', 'Subtitle');

    expect([...dirtySongIds(base, draft)]).toEqual(['aaa']);
    expect(songIsDirty(base, draft, 'aaa', 1)).toBe(true);
  });
});

describe('validation', () => {
  test('passes on the clean fixture', () => {
    expect(validate(fixture()).ok).toBe(true);
  });

  test('flags music_order orphans as errors', () => {
    const d = fixture();
    d.musicOrder.items.push({ uniqueId: 999, id: 'ghost', genreNo: 0 });
    const r = validate(d);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.level === 'error' && i.message.includes('ghost'))).toBe(true);
  });

  test('flags duplicate uniqueIds as errors', () => {
    const d = fixture();
    d.musicinfo.items.push({ uniqueId: 1, id: 'dupe', starMania: 5 });

    const r = validate(d);

    expect(r.ok).toBe(false);
    expect(r.issues).toContainEqual({ level: 'error', message: 'Duplicate Song No. 1 (musicinfo.uniqueId).' });
  });

  test('flags out-of-range stars', () => {
    const d = fixture();
    d.musicinfo.items[0].starMania = 42;
    expect(validate(d).ok).toBe(false);
  });

  test('warns when a baseline song loses its music_order slot', () => {
    const base = fixture();
    const draft: RawDatatables = {
      ...base,
      musicOrder: { items: base.musicOrder.items.filter((o) => o.uniqueId !== 2) },
    };

    const r = validate(draft, base);

    expect(r.ok).toBe(true);
    expect(r.issues).toContainEqual({
      level: 'warn',
      message: '1 song(s) lost their music_order slot (bbb).',
    });
  });
});

describe('seal round-trip', () => {
  test('sealDatatable → openEnvelope recovers the edited JSON', async () => {
    const base = fixture();
    const draft = setStar(base, 1, 'starMania', 9);
    const bytes = await sealDatatable(draft.musicinfo, DATATABLE_KEY_HEX);
    const { payload } = await openEnvelope(bytes, DATATABLE_KEY_HEX);
    const decoded = decodeJsonPayload<typeof draft.musicinfo>(payload);
    expect(decoded.items[0].starMania).toBe(9);
    expect(decoded).toEqual(draft.musicinfo);
  });

});
