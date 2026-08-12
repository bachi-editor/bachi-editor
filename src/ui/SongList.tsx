import { useMemo } from 'react';
import { useAppStore } from '../model/store';
import {
  hasAudioFile,
  hasChartFile,
  nextSongSort,
  preferredTitle,
  SongFilter,
  songMatchesFilters,
  songMatchesQuery,
  songStars,
  sortSongRows,
  SongSortOption,
} from '../model/songlist';
import { genreFor, genreMessageKey } from '../model/genres';
import { dirtySongIds } from '../model/diff';
import { MessageKey, useT } from '../i18n';
import { Icon } from './shell/Icon';
import { MarqueeText } from './shell/MarqueeText';
import { Menu } from './shell/Menu';
import { SongListSkeleton } from './shell/Skeleton';
import { useDeferredReady } from './shell/useDeferredReady';
import { SongMetadataLine } from './SongMetadataLine';

const FILTERS: { value: SongFilter; labelKey: MessageKey; className: string }[] = [
  { value: 'edited', labelKey: 'songlist.filter.edited', className: 'edited' },
  { value: 'noaudio', labelKey: 'songlist.filter.noaudio', className: 'noaudio' },
  { value: 'notinorder', labelKey: 'songlist.filter.notinorder', className: 'notinorder' },
];

const SORTS: { value: SongSortOption; labelKey: MessageKey; titleKey: MessageKey }[] = [
  { value: 'uniqueId', labelKey: 'metadata.songNo', titleKey: 'songlist.sortUniqueIdTitle' },
  { value: 'genre', labelKey: 'metadata.genre', titleKey: 'songlist.sortGenreTitle' },
];

export function SongList() {
  const project = useAppStore((s) => s.project);
  const search = useAppStore((s) => s.ui.search);
  const locale = useAppStore((s) => s.ui.locale);
  const filters = useAppStore((s) => s.ui.filters);
  const songSort = useAppStore((s) => s.ui.songSort);
  const setSearch = useAppStore((s) => s.setSearch);
  const toggleSongFilter = useAppStore((s) => s.toggleSongFilter);
  const setSongSort = useAppStore((s) => s.setSongSort);
  const selectedId = useAppStore((s) => s.selection.songId);
  const selectSong = useAppStore((s) => s.selectSong);
  const openAddSong = useAppStore((s) => s.openAddSong);
  const t = useT();

  // Paint a skeleton for the first frame after mount so switching to this page
  // is instant; the 1000+ real rows render once the placeholder is on screen.
  const ready = useDeferredReady();
  const open = project.kind === 'open' ? project.project : undefined;
  const rows = open?.songs.rows ?? [];
  const inv = open?.assets;

  const edited = useMemo(
    () => (open ? dirtySongIds(open.baseline, open.datatables) : new Set<string>()),
    [open],
  );
  const visibleRows = useMemo(() => {
    if (!open || !inv) return [];
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((r) => (
      songMatchesQuery(r, q)
      && songMatchesFilters(r, filters, edited, inv, open.songs.orderIndexById.has(r.id))
    ));
    return sortSongRows(filtered, songSort);
  }, [open, rows, inv, search, filters, songSort, edited]);

  return (
    <aside className="tk-songs">
      <div className="tk-songs-head">
        <div className="tk-songs-title">
          <h2>{t('songlist.title')}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="tk-count-pill">{rows.length.toLocaleString()}</span>
            <button className="tk-btn tk-btn-sm tk-songs-add" onClick={openAddSong} title={t('songlist.addTitle')} disabled={!open}>
              <Icon name="plus" /> {t('common.add')}
            </button>
          </div>
        </div>
        <div className="tk-search">
          <Icon name="search" />
          {FILTERS.filter((filter) => filters.includes(filter.value)).map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={`tk-search-tag ${filter.className}`}
              aria-label={t('songlist.removeFilter', { label: t(filter.labelKey) })}
              title={t('songlist.removeFilter', { label: t(filter.labelKey) })}
              onClick={() => toggleSongFilter(filter.value)}
            >
              <span>{t(filter.labelKey)}</span>
              <Icon name="close" size={10} />
            </button>
          ))}
          <input
            placeholder={t('songlist.searchPlaceholder')}
            value={search}
            aria-label={t('songlist.searchAria')}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search.length > 0 && (
            <button
              type="button"
              className="tk-search-clear"
              aria-label={t('songlist.clearSearch')}
              title={t('songlist.clearSearch')}
              onClick={() => setSearch('')}
            >
              <Icon name="close" size={13} />
            </button>
          )}
        </div>
        <div className="tk-song-controls">
          <div className="tk-filter-control">
            <Menu
              trigger={(
                <>
                  <Icon name="filter" />
                  {filters.length > 0 && <span className="tk-filter-count">{filters.length}</span>}
                </>
              )}
              triggerClassName={'tk-filter-trigger' + (filters.length > 0 ? ' on' : '')}
              triggerTitle={t('songlist.chooseFilters')}
              triggerAriaLabel={t('songlist.chooseFilters')}
              minWidth={178}
            >
              {() => (
                <>
                  <div className="tk-menu-label">{t('songlist.songFilters')}</div>
                  {FILTERS.map((filter) => {
                    const active = filters.includes(filter.value);
                    return (
                      <button
                        key={filter.value}
                        type="button"
                        role="menuitemcheckbox"
                        aria-checked={active}
                        className={'tk-menu-item' + (active ? ' on' : '')}
                        onClick={() => toggleSongFilter(filter.value)}
                      >
                        <span className={`tk-filter-swatch ${filter.className}`} />
                        {t(filter.labelKey)}
                        <span className="tk-filter-check">{active && <Icon name="check" />}</span>
                      </button>
                    );
                  })}
                </>
              )}
            </Menu>
          </div>
          <div className="tk-sorts" aria-label={t('songlist.sorting')}>
            <span className="tk-sorts-label">{t('songlist.sort')}</span>
            <div className="tk-seg tk-song-sort">
              {SORTS.map((option) => {
                const songNo = option.value === 'uniqueId';
                const active = songNo ? songSort !== 'genre' : songSort === option.value;
                const descending = songNo && songSort === 'uniqueIdDesc';
                const titleKey = descending ? 'songlist.sortUniqueIdDescTitle' : option.titleKey;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={active ? 'on' : ''}
                    title={t(titleKey)}
                    aria-label={t(titleKey)}
                    aria-pressed={active}
                    onClick={() => setSongSort(nextSongSort(songSort, option.value))}
                  >
                    {t(option.labelKey)}
                    {songNo && (
                      <span
                        className={'tk-song-sort-direction' + (active ? '' : ' hidden')}
                        aria-hidden="true"
                      >
                        {descending ? '↓' : '↑'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="tk-songlist">
        {open && !ready && <SongListSkeleton />}
        {ready && visibleRows.map((row) => {
          const g = genreFor(row.genreNo);
          const hasChart = hasChartFile(inv!, row);
          const hasAudio = hasAudioFile(inv!, row);
          // Roll up the song's on-disk asset state into a single health signal.
          const health = !hasChart ? 'none' : !hasAudio ? 'warn' : 'ok';
          const healthTitle = !hasChart
            ? t('songlist.healthNoChart')
            : !hasAudio
              ? t('songlist.healthNoAudio')
              : t('songlist.healthReady');
          return (
            <div
              key={row.uniqueId}
              className={'tk-song' + (selectedId === row.id ? ' sel' : '')}
              onClick={() => selectSong(row.id)}
            >
              <span className="tk-genre" style={{ background: g.color }} title={t(genreMessageKey(row.genreNo))} />
              <div className="tk-song-main">
                <div className="tk-song-title">
                  <MarqueeText text={preferredTitle(row, locale)} active={selectedId === row.id} />
                  {edited.has(row.id) && <span className="tk-edit-dot" title={t('metadata.edited')} />}
                </div>
                <SongMetadataLine
                  songId={row.id}
                  songNo={row.uniqueId}
                  genreNo={row.genreNo}
                  stars={songStars(row)}
                  active={selectedId === row.id}
                />
              </div>
              <span className={'tk-health ' + health} title={healthTitle} />
            </div>
          );
        })}
        {(!open || ready) && visibleRows.length === 0 && (
          <div className="tk-list-empty">
            {!open
              ? t('songlist.emptyNoProject')
              : search
              ? t('songlist.emptySearch', { search })
              : filters.length > 0
                ? t('songlist.emptyFilters')
                : t('songlist.emptyNone')}
          </div>
        )}
      </div>
    </aside>
  );
}
