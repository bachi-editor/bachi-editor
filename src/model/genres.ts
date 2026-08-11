// Genre metadata: maps the on-disk numeric `genreNo` to a display name and the
// Bachi genre-dot colour. Enum values verified against TaikoLocalServer's
// Domain/Enums/SongGenre.cs (Pop=0 … Classical=7). Colours taken from the
// Bachi design reference (resources/UI-design-reference/data.js), with Kids
// filled in (the prototype's mock data omitted it).

import type { MessageKey } from '../i18n/messages';

export interface Genre {
  no: number;
  name: string;
  color: string;
}

export const GENRES: Genre[] = [
  { no: 0, name: 'Pops', color: '#4aa3df' },
  { no: 1, name: 'Anime', color: '#f29ac0' },
  { no: 2, name: 'Kids', color: '#7dc77d' },
  { no: 3, name: 'Vocaloid', color: '#9bb7c4' },
  { no: 4, name: 'Game Music', color: '#9b6fd6' },
  { no: 5, name: 'Namco Original', color: '#f2843c' },
  { no: 6, name: 'Variety', color: '#5fc08a' },
  { no: 7, name: 'Classical', color: '#caa14a' },
];

/**
 * Genre-folder order used by the CHN game song-select carousel.
 *
 * This is deliberately separate from GENRES' numeric-enum order. It comes
 * from the eight stock folders' explicit `order` fields in the bundled
 * `resources/TaikoCHN/Data/x64/datatable/genre_folderinfo.bin`:
 * Anime, Vocaloid, Game Music, Variety, Classical, Namco Original, Kids, Pops.
 */
export const GAME_GENRE_ORDER = [1, 3, 4, 6, 7, 5, 2, 0] as const;

const GAME_GENRE_RANK = new Map<number, number>(GAME_GENRE_ORDER.map((genreNo, index) => [genreNo, index]));

/** Compare genre numbers in game-folder order, with unknown genres last. */
export function compareGameGenreOrder(a: number | undefined, b: number | undefined): number {
  if (a === b) return 0;

  const rankA = a === undefined ? undefined : GAME_GENRE_RANK.get(a);
  const rankB = b === undefined ? undefined : GAME_GENRE_RANK.get(b);
  if (rankA !== undefined && rankB !== undefined) return rankA - rankB;
  if (rankA !== undefined) return -1;
  if (rankB !== undefined) return 1;

  // Keep distinct unrecognised genre numbers grouped deterministically, with
  // a missing genre after any numeric value.
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return a - b;
}

const BY_NO = new Map<number, Genre>(GENRES.map((g) => [g.no, g]));

const UNKNOWN: Genre = { no: -1, name: 'Unknown', color: '#bcb6ab' };

export function genreFor(genreNo: number | undefined): Genre {
  if (genreNo === undefined) return UNKNOWN;
  return BY_NO.get(genreNo) ?? UNKNOWN;
}

/** i18n catalog key for a genre's localized display name. */
const GENRE_KEYS: Record<number, MessageKey> = {
  0: 'genre.pops',
  1: 'genre.anime',
  2: 'genre.kids',
  3: 'genre.vocaloid',
  4: 'genre.gameMusic',
  5: 'genre.namcoOriginal',
  6: 'genre.variety',
  7: 'genre.classical',
};

export function genreMessageKey(genreNo: number | undefined): MessageKey {
  return GENRE_KEYS[genreNo ?? -1] ?? 'genre.unknown';
}
