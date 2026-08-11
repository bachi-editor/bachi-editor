import { describe, expect, it } from 'vitest';
import {
  buildSongIndex,
  expectedSoundFile,
  hasAudioFile,
  hasChartFile,
  hasSound,
  hasUra,
  nextSongSort,
  oniStars,
  preferredTitle,
  reindexSongOrder,
  songMatchesFilters,
  songMatchesQuery,
  songStars,
  sortSongRows,
  toggleSongFilter,
} from '../../src/model/songlist';
import type { RawDatatables } from '../../src/fs/datatables';

const sampleDatatables = (): RawDatatables => ({
  musicinfo: {
    items: [
      {
        id: 'beta', uniqueId: 2, genreNo: 1,
        starEasy: 2, starNormal: 4, starHard: 6, starMania: 9, starUra: 4,
        songFileName: 'sound/song_beta',
      },
      { id: 'alpha', uniqueId: 1, genreNo: 0, starMania: 7 },
      { id: 'orphan', uniqueId: 3 }, // not in music_order
    ],
  },
  musicOrder: {
    items: [
      { id: 'alpha', uniqueId: 1, genreNo: 0 },
      { id: 'beta', uniqueId: 2, genreNo: 1 },
      // 'orphan' missing on purpose.
    ],
  },
  wordlist: {
    items: [
      { key: 'song_alpha', japaneseText: 'アルファ', chineseSText: '阿尔法' },
      { key: 'song_sub_alpha', chineseSText: '副标题α' },
      { key: 'song_beta', englishUsText: 'Beta Song' },
      // orphan: no entries.
    ],
  },
});

describe('buildSongIndex', () => {
  it('orders music_order entries first, in order, then orphans by uniqueId', () => {
    const idx = buildSongIndex(sampleDatatables());
    expect(idx.rows.map((r) => r.id)).toEqual(['alpha', 'beta', 'orphan']);
  });

  it('populates byUniqueId and byId lookups', () => {
    const idx = buildSongIndex(sampleDatatables());
    expect(idx.byUniqueId.get(2)?.id).toBe('beta');
    expect(idx.byId.get('alpha')?.uniqueId).toBe(1);
  });

  it('sorts a catalog copy by numerical uniqueId without mutating the index', () => {
    const idx = buildSongIndex({
      ...sampleDatatables(),
      musicinfo: {
        items: [
          { id: 'hundred', uniqueId: 100, genreNo: 0 },
          { id: 'two', uniqueId: 2, genreNo: 1 },
          { id: 'ten', uniqueId: 10, genreNo: 3 },
          { id: 'one', uniqueId: 1, genreNo: 4 },
        ],
      },
      musicOrder: { items: [] },
    });
    const before = [...idx.rows];

    expect(sortSongRows(idx.rows, 'uniqueId').map((r) => r.uniqueId)).toEqual([1, 2, 10, 100]);
    expect(sortSongRows(idx.rows, 'uniqueIdDesc').map((r) => r.uniqueId)).toEqual([100, 10, 2, 1]);
    expect(idx.rows).toEqual(before);
  });

  it('toggles Song No. direction on repeated selections', () => {
    expect(nextSongSort('genre', 'uniqueId')).toBe('uniqueId');
    expect(nextSongSort('uniqueId', 'uniqueId')).toBe('uniqueIdDesc');
    expect(nextSongSort('uniqueIdDesc', 'uniqueId')).toBe('uniqueId');
    expect(nextSongSort('uniqueIdDesc', 'genre')).toBe('genre');
  });

  it('sorts by in-game genre order, then ascending uniqueId', () => {
    const idx = buildSongIndex({
      ...sampleDatatables(),
      musicinfo: {
        items: [
          { id: 'pops', uniqueId: 1, genreNo: 0 },
          { id: 'anime-later', uniqueId: 90, genreNo: 1 },
          { id: 'unknown', uniqueId: 3, genreNo: 99 },
          { id: 'namco', uniqueId: 4, genreNo: 5 },
          { id: 'anime-earlier', uniqueId: 2, genreNo: 1 },
          { id: 'classical', uniqueId: 8, genreNo: 7 },
          { id: 'unset', uniqueId: 6 },
          { id: 'vocaloid', uniqueId: 7, genreNo: 3 },
        ],
      },
      musicOrder: { items: [] },
    });

    const sorted = sortSongRows(idx.rows, 'genre');
    expect(sorted.map((r) => [r.genreNo, r.uniqueId])).toEqual([
      [1, 2],
      [1, 90],
      [3, 7],
      [7, 8],
      [5, 4],
      [0, 1],
      [99, 3],
      [undefined, 6],
    ]);
  });

  it('joins localised titles via wordlist keys', () => {
    const idx = buildSongIndex(sampleDatatables());
    const alpha = idx.byId.get('alpha')!;
    expect(alpha.titles.title.japaneseText).toBe('アルファ');
    expect(alpha.titles.title.chineseSText).toBe('阿尔法');
    expect(alpha.titles.subtitle.chineseSText).toBe('副标题α');
    expect(idx.byId.get('orphan')!.titles.title.japaneseText).toBe('');
  });

  it('preferredTitle falls back across locales then to id', () => {
    const idx = buildSongIndex(sampleDatatables());
    expect(preferredTitle(idx.byId.get('beta')!, 'chineseSText')).toBe('Beta Song');
    expect(preferredTitle(idx.byId.get('orphan')!, 'chineseSText')).toBe('orphan');
  });

  it('songMatchesQuery searches across id, uniqueId, and titles', () => {
    const idx = buildSongIndex(sampleDatatables());
    const alpha = idx.byId.get('alpha')!;
    expect(songMatchesQuery(alpha, 'alph')).toBe(true);
    expect(songMatchesQuery(alpha, '阿尔')).toBe(true);
    expect(songMatchesQuery(alpha, '1')).toBe(true); // uniqueId
    expect(songMatchesQuery(alpha, 'zzz')).toBe(false);
    expect(songMatchesQuery(alpha, '')).toBe(true);
  });

  it('toggles distinct catalog filters and removes an active filter', () => {
    const edited = toggleSongFilter([], 'edited');
    const both = toggleSongFilter(edited, 'noaudio');
    const all = toggleSongFilter(both, 'notinorder');

    expect(edited).toEqual(['edited']);
    expect(both).toEqual(['edited', 'noaudio']);
    expect(all).toEqual(['edited', 'noaudio', 'notinorder']);
    expect(toggleSongFilter(both, 'edited')).toEqual(['noaudio']);
  });

  it('shows all songs without filters and requires every active filter to match', () => {
    const idx = buildSongIndex(sampleDatatables());
    const alpha = idx.byId.get('alpha')!;
    const beta = idx.byId.get('beta')!;
    const orphan = idx.byId.get('orphan')!;
    const inv = { fumenIds: new Set(['alpha', 'beta']), soundFiles: new Set(['song_beta.nus3bank']) };
    const edited = new Set(['alpha', 'beta']);

    expect(songMatchesFilters(alpha, [], edited, inv, true)).toBe(true);
    expect(songMatchesFilters(alpha, ['edited', 'noaudio'], edited, inv, true)).toBe(true);
    expect(songMatchesFilters(beta, ['edited', 'noaudio'], edited, inv, true)).toBe(false);
    expect(songMatchesFilters(orphan, ['notinorder'], edited, inv, false)).toBe(true);
    expect(songMatchesFilters(alpha, ['notinorder'], edited, inv, true)).toBe(false);
  });

  it('reindexes order without rebuilding canonical rows or lookup maps', () => {
    const d = sampleDatatables();
    const idx = buildSongIndex(d);
    const alpha = idx.byId.get('alpha')!;
    const beta = idx.byId.get('beta')!;
    const next = reindexSongOrder(idx, [...d.musicOrder.items].reverse());

    expect(next.rows.map((r) => r.id)).toEqual(['beta', 'alpha', 'orphan']);
    expect(next.byId).toBe(idx.byId);
    expect(next.byUniqueId).toBe(idx.byUniqueId);
    expect(next.byId.get('alpha')).toBe(alpha);
    expect(next.byId.get('beta')).toBe(beta);
    expect(next.orderIndexById.get('beta')).toBe(0);
    expect(next.orderIndexById.has('orphan')).toBe(false);
  });

  it('derives chart and audio availability from inventory and metadata', () => {
    const idx = buildSongIndex(sampleDatatables());
    const beta = idx.byId.get('beta')!;
    const orphan = idx.byId.get('orphan')!;
    const inv = { fumenIds: new Set(['beta']), soundFiles: new Set(['song_beta.nus3bank']) };

    expect(oniStars(beta)).toBe(9);
    expect(songStars(beta)).toEqual({ easy: 2, normal: 4, hard: 6, oni: 9, ura: 4 });
    expect(hasUra(beta)).toBe(true);
    expect(hasSound(beta)).toBe(true);
    expect(expectedSoundFile(beta)).toBe('song_beta.nus3bank');
    expect(hasChartFile(inv, beta)).toBe(true);
    expect(hasAudioFile(inv, beta)).toBe(true);

    expect(oniStars(orphan)).toBe(0);
    expect(songStars(orphan)).toEqual({ easy: 0, normal: 0, hard: 0, oni: 0, ura: 0 });
    expect(hasUra(orphan)).toBe(false);
    expect(hasSound(orphan)).toBe(false);
    expect(expectedSoundFile(orphan)).toBeUndefined();
    expect(hasChartFile(inv, orphan)).toBe(false);
    expect(hasAudioFile(inv, orphan)).toBe(false);
  });
});
