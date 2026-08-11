import { useMemo } from 'react';
import { useAppStore } from '../../model/store';
import { makeDanSongResolver } from '../../model/danCatalog';
import type { DanSongResolver } from '../../model/danValidation';
import type { SongIndex } from '../../model/songlist';

/** The open project's song catalog, or undefined when no project is open. */
export function useDanSongs(): SongIndex | undefined {
  const project = useAppStore((s) => s.project);
  return project.kind === 'open' ? project.project.songs : undefined;
}

/** A songNo→details resolver bound to the open catalog + display locale. */
export function useDanResolver(): DanSongResolver | undefined {
  const songs = useDanSongs();
  const locale = useAppStore((s) => s.ui.locale);
  return useMemo(() => makeDanSongResolver(songs, locale), [songs, locale]);
}
