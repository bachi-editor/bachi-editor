// View-model that joins musicinfo + wordlist + music_order into a single
// per-song row. The on-disk files are not coherently denormalised: localised
// strings live in wordlist under keyed prefixes, and the canonical display
// order lives in music_order. This module owns that join so the UI never
// touches the raw datatables.
//
// Wordlist key conventions (verified against the CHN corpus):
//   song_<id>         → main title
//   song_sub_<id>     → subtitle
//   song_detail_<id>  → long description / "song wedge text"

import type { GameVersion, MusicInfoItem, MusicOrderItem, WordListItem } from '../codec';
import type { RawDatatables } from '../fs/datatables';
import type { AssetInventory } from '../fs/inventory';
import { resolveSoundFile } from '../fs/sound';
import { compareGameGenreOrder } from './genres';

export type Locale = 'japaneseText' | 'englishUsText' | 'chineseTText' | 'chineseSText' | 'koreanText';

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'chineseSText', label: '简体中文' },
  { value: 'chineseTText', label: '繁體中文' },
  { value: 'japaneseText', label: '日本語' },
  { value: 'englishUsText', label: 'English' },
  { value: 'koreanText', label: '한국어' },
];

const JPN_LOCALES = LOCALES.filter((locale) => locale.value !== 'chineseSText');

/** Localized fields offered and written for a selected game-data schema. */
export function localesForGameVersion(gameVersion?: GameVersion): readonly (typeof LOCALES)[number][] {
  return gameVersion === 'jpn' ? JPN_LOCALES : LOCALES;
}

export interface Titles {
  title: Record<Locale, string>;
  subtitle: Record<Locale, string>;
  detail: Record<Locale, string>;
}

export interface SongRow {
  /** String Song ID used by asset folders and wordlist keys. */
  id: string;
  /** Numeric Song No., stored as `uniqueId` in musicinfo. */
  uniqueId: number;
  /** genreNo from musicinfo if available, else from music_order. */
  genreNo: number | undefined;
  titles: Titles;
  info: MusicInfoItem;
}

/** Display-ready difficulty ratings shared by catalog and Dani views. */
export interface SongStars {
  easy: number;
  normal: number;
  hard: number;
  oni: number;
  ura: number;
}

function emptyLocaleMap(): Record<Locale, string> {
  return {
    chineseSText: '',
    chineseTText: '',
    japaneseText: '',
    englishUsText: '',
    koreanText: '',
  };
}

function readLocalised(item: WordListItem | undefined): Record<Locale, string> {
  const out = emptyLocaleMap();
  if (!item) return out;
  for (const key of Object.keys(out) as Locale[]) {
    const v = item[key];
    if (typeof v === 'string') out[key] = v;
  }
  return out;
}

export interface SongIndex {
  rows: SongRow[];
  /** Current music_order position by Song ID. Kept separate from canonical rows. */
  orderIndexById: ReadonlyMap<string, number>;
  /** uniqueId → SongRow. */
  byUniqueId: Map<number, SongRow>;
  /** id (string) → SongRow. */
  byId: Map<string, SongRow>;
}

export type SongFilter = 'edited' | 'noaudio' | 'notinorder';
export type SongSort = 'uniqueId' | 'uniqueIdDesc' | 'genre';
export type SongSortOption = 'uniqueId' | 'genre';

/** Select a Songs-catalog sort; reselecting Song No. flips its direction. */
export function nextSongSort(current: SongSort, option: SongSortOption): SongSort {
  if (option === 'genre') return 'genre';
  return current === 'uniqueId' ? 'uniqueIdDesc' : 'uniqueId';
}

/** Toggle one Songs-catalog filter while keeping the active values unique. */
export function toggleSongFilter(filters: readonly SongFilter[], filter: SongFilter): SongFilter[] {
  return filters.includes(filter)
    ? filters.filter((value) => value !== filter)
    : [...filters, filter];
}

/**
 * Apply every active catalog filter. An empty filter list intentionally means
 * "show all"; adding tags progressively narrows the visible song set.
 */
export function songMatchesFilters(
  row: SongRow,
  filters: readonly SongFilter[],
  edited: ReadonlySet<string>,
  inv: AssetInventory,
  inMusicOrder: boolean,
): boolean {
  return filters.every((filter) => {
    switch (filter) {
      case 'edited': return edited.has(row.id);
      case 'noaudio': return !hasAudioFile(inv, row);
      case 'notinorder': return !inMusicOrder;
    }
  });
}

/**
 * Return a sorted copy for catalog views without changing SongIndex.rows'
 * canonical music_order sequence (also consumed by the Dani song picker).
 */
export function sortSongRows(rows: readonly SongRow[], sort: SongSort): SongRow[] {
  return [...rows].sort((a, b) => {
    if (sort === 'genre') {
      const genreOrder = compareGameGenreOrder(a.genreNo, b.genreNo);
      if (genreOrder !== 0) return genreOrder;
    }
    return sort === 'uniqueIdDesc' ? b.uniqueId - a.uniqueId : a.uniqueId - b.uniqueId;
  });
}

/**
 * Join musicinfo + wordlist + music_order into SongRows.
 * Order: songs listed in music_order first, in that order; then any
 * remaining musicinfo entries by uniqueId.
 */
export function buildSongIndex(d: RawDatatables): SongIndex {
  const wordByKey = new Map<string, WordListItem>();
  for (const w of d.wordlist.items) wordByKey.set(w.key, w);

  const rows: SongRow[] = d.musicinfo.items.map((info) => {
    const titles: Titles = {
      title: readLocalised(wordByKey.get(`song_${info.id}`)),
      subtitle: readLocalised(wordByKey.get(`song_sub_${info.id}`)),
      detail: readLocalised(wordByKey.get(`song_detail_${info.id}`)),
    };
    return {
      id: info.id,
      uniqueId: info.uniqueId,
      genreNo: info.genreNo,
      titles,
      info,
    };
  });

  const byUniqueId = new Map<number, SongRow>();
  const byId = new Map<string, SongRow>();
  for (const r of rows) {
    byUniqueId.set(r.uniqueId, r);
    byId.set(r.id, r);
  }
  return reindexSongOrder({ rows, orderIndexById: new Map(), byUniqueId, byId }, d.musicOrder.items);
}

/**
 * Refresh only the music_order projection while retaining every canonical row,
 * title map, and lookup object. Order-only edits are frequent on the board but
 * do not change musicinfo or wordlist, so rebuilding those joins would discard
 * useful referential stability and force unrelated card consumers to rerender.
 */
export function reindexSongOrder(index: SongIndex, items: readonly MusicOrderItem[]): SongIndex {
  const orderIndexById = new Map<string, number>();
  items.forEach((item, i) => {
    if (typeof item.id === 'string') orderIndexById.set(item.id, i);
  });
  const rows = [...index.rows].sort((a, b) => {
    const ai = orderIndexById.get(a.id) ?? Number.POSITIVE_INFINITY;
    const bi = orderIndexById.get(b.id) ?? Number.POSITIVE_INFINITY;
    if (ai !== bi) return ai - bi;
    return a.uniqueId - b.uniqueId;
  });
  return { rows, orderIndexById, byUniqueId: index.byUniqueId, byId: index.byId };
}

/** Pick the best non-empty title for a song, falling back across locales. */
export function preferredTitle(row: SongRow, locale: Locale): string {
  const fallback: Locale[] = [locale, 'chineseSText', 'chineseTText', 'japaneseText', 'englishUsText', 'koreanText'];
  for (const l of fallback) {
    const v = row.titles.title[l];
    if (v && v.trim().length > 0) return v;
  }
  return row.id;
}

function starValue(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/** Difficulty star counts, with missing metadata normalized to 0. */
export function songStars(row: SongRow): SongStars {
  return {
    easy: starValue(row.info.starEasy),
    normal: starValue(row.info.starNormal),
    hard: starValue(row.info.starHard),
    oni: starValue(row.info.starMania),
    ura: starValue(row.info.starUra),
  };
}

/** Oni (mania) difficulty star count, 0 if absent. */
export function oniStars(row: SongRow): number {
  return songStars(row).oni;
}

/** Whether the song declares an ura-oni chart (star or branch present). */
export function hasUra(row: SongRow): boolean {
  return songStars(row).ura > 0;
}

/**
 * Heuristic "declares a sound file": musicinfo carries a non-empty songFileName.
 * This is the *declaration*, not actual file presence — use hasAudioFile for
 * the on-disk check.
 */
export function hasSound(row: SongRow): boolean {
  const v = row.info.songFileName;
  return typeof v === 'string' && v.trim().length > 0;
}

/** Expected sound file name for a song, derived from musicinfo.songFileName. */
export function expectedSoundFile(row: SongRow): string | undefined {
  if (!hasSound(row)) return undefined;
  return resolveSoundFile(row.info).filename;
}

/** Whether the song's fumen/<id>/ folder exists on disk. */
export function hasChartFile(inv: AssetInventory, row: SongRow): boolean {
  return inv.fumenIds.has(row.id);
}

/** Whether the song's declared sound file exists on disk. */
export function hasAudioFile(inv: AssetInventory, row: SongRow): boolean {
  const f = expectedSoundFile(row);
  return f !== undefined && inv.soundFiles.has(f);
}

/** Case-insensitive substring match across id and all locales. */
export function songMatchesQuery(row: SongRow, queryLower: string): boolean {
  if (queryLower.length === 0) return true;
  if (row.id.toLowerCase().includes(queryLower)) return true;
  if (String(row.uniqueId).includes(queryLower)) return true;
  for (const l of Object.keys(row.titles.title) as Locale[]) {
    if (row.titles.title[l].toLowerCase().includes(queryLower)) return true;
    if (row.titles.subtitle[l].toLowerCase().includes(queryLower)) return true;
  }
  return false;
}
