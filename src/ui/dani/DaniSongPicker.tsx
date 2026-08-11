// Song picker for an odai slot. Reuses the catalog + the Music Order
// "find-to-place" search idiom. The chosen song's Song No. is stored under the
// on-disk `songNo` key (the same number as musicinfo `uniqueId`; see PLAN.md, Dani Dojo).

import { useMemo, useState } from 'react';
import { useAppStore } from '../../model/store';
import { preferredTitle, songMatchesQuery, songStars, type SongRow } from '../../model/songlist';
import { genreFor } from '../../model/genres';
import { useT } from '../../i18n';
import { Icon } from '../shell/Icon';
import { SongMetadataLine } from '../SongMetadataLine';
import { useDanSongs } from './useDani';

const MAX_RESULTS = 40;

export function DaniSongPicker() {
  const picker = useAppStore((s) => s.dani.picker);
  const locale = useAppStore((s) => s.ui.locale);
  const setQuery = useAppStore((s) => s.daniSetPickerQuery);
  const close = useAppStore((s) => s.daniClosePicker);
  const pick = useAppStore((s) => s.daniPickSong);
  const songs = useDanSongs();
  const [manual, setManual] = useState(0);
  const t = useT();

  const query = picker?.query ?? '';
  const results = useMemo(() => {
    if (!songs) return [];
    const q = query.trim().toLowerCase();
    const rows = q ? songs.rows.filter((r) => songMatchesQuery(r, q)) : songs.rows;
    return rows.slice(0, MAX_RESULTS);
  }, [songs, query]);

  if (!picker) return null;
  const total = songs?.rows.length ?? 0;

  return (
    <div className="tk-modal-overlay" onClick={close}>
      <div className="tk-modal dd-picker" onClick={(e) => e.stopPropagation()}>
        <div className="tk-modal-head">
          <div className="row">
            <h2>{t('dani.pickSong')}</h2>
            <span className="pill">{songs ? t('dani.pickerPill', { n: picker.slot + 1, total: total.toLocaleString() }) : t('dani.pickerPillNoCount', { n: picker.slot + 1 })}</span>
          </div>
          <p>{songs ? t('dani.pickerIntro') : t('dani.pickerIntroNoCatalog')}</p>
        </div>
        {songs ? (
          <>
            <div className="dd-search">
              <Icon name="search" size={15} />
              <input autoFocus placeholder={t('songlist.searchPlaceholder')} value={query}
                onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="dd-results">
              {results.length === 0
                ? <div className="dd-results-empty">{t('dani.noMatchingSongs')}</div>
                : results.map((row) => <SongResult key={row.uniqueId} row={row} locale={locale} onPick={() => pick(row.uniqueId)} />)}
            </div>
          </>
        ) : (
          <div className="dd-nocatalog">
            <input type="number" min={1} autoFocus placeholder={t('metadata.songNo')} aria-label={t('metadata.songNo')} value={manual || ''}
              onChange={(e) => setManual(parseInt(e.target.value, 10) || 0)}
              onKeyDown={(e) => { if (e.key === 'Enter' && manual > 0) pick(manual); }} />
            <button className="tk-btn tk-btn-primary" onClick={() => pick(manual)} disabled={manual <= 0}>{t('dani.setSongNo')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function SongResult({ row, locale, onPick }: { row: SongRow; locale: Parameters<typeof preferredTitle>[1]; onPick: () => void }) {
  const genre = genreFor(row.genreNo);
  const [highlighted, setHighlighted] = useState(false);
  return (
    <button
      className="dd-result"
      onClick={onPick}
      onMouseEnter={() => setHighlighted(true)}
      onMouseLeave={() => setHighlighted(false)}
      onFocus={() => setHighlighted(true)}
      onBlur={() => setHighlighted(false)}
    >
      <span className="dd-genre" style={{ background: genre.color }} />
      <span className="dd-result-main">
        <span className="dd-result-title">{preferredTitle(row, locale)}</span>
        <SongMetadataLine
          songId={row.id}
          songNo={row.uniqueId}
          genreNo={row.genreNo}
          stars={songStars(row)}
          active={highlighted}
        />
      </span>
    </button>
  );
}
