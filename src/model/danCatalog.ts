// Bridges the game project's song catalog to the (locale-agnostic) dani
// validator/UI. Returns a resolver only when a project is open; without one the
// dani editor still works on raw songNo values (see PLAN.md, Dani Dojo).

import { hasUra, preferredTitle, songStars, type Locale, type SongIndex } from './songlist';
import type { DanSongResolver } from './danValidation';

export function makeDanSongResolver(songs: SongIndex | undefined, locale: Locale): DanSongResolver | undefined {
  if (!songs) return undefined;
  return (songNo) => {
    const row = songs.byUniqueId.get(songNo);
    if (!row) return undefined;
    return {
      id: row.id,
      title: preferredTitle(row, locale),
      hasUra: hasUra(row),
      stars: songStars(row),
      genreNo: row.genreNo,
    };
  };
}
