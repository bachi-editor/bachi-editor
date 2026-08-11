// Song picker for the Music Order board. Reuses the catalog + "find-to-place"
// search idiom of the Dani Dojo picker, scoped to one genre folder: the chosen
// song is inserted at the top of that folder (see store.addSongToOrder).

import { useMemo, useState } from 'react';
import { useAppStore } from '../../model/store';
import { preferredTitle, songMatchesQuery, songStars, type Locale, type SongRow } from '../../model/songlist';
import { genreFor, genreMessageKey } from '../../model/genres';
import { useT } from '../../i18n';
import { Icon } from '../shell/Icon';
import { SongMetadataLine } from '../SongMetadataLine';

const MAX_RESULTS = 40;

export function OrderSongPicker({
  genreNo,
  onPick,
  onClose,
}: {
  genreNo: number;
  onPick: (uniqueId: number) => void;
  onClose: () => void;
}) {
  const songs = useAppStore((s) => (s.project.kind === 'open' ? s.project.project.songs : undefined));
  const locale = useAppStore((s) => s.ui.locale);
  const [query, setQuery] = useState('');
  const t = useT();
  const genre = genreFor(genreNo);

  const results = useMemo(() => {
    if (!songs) return [];
    const q = query.trim().toLowerCase();
    const rows = q ? songs.rows.filter((r) => songMatchesQuery(r, q)) : songs.rows;
    return rows.slice(0, MAX_RESULTS);
  }, [songs, query]);

  return (
    <div className="tk-modal-overlay" onClick={onClose}>
      <div className="tk-modal dd-picker" onClick={(e) => e.stopPropagation()}>
        <div className="tk-modal-head">
          <div className="row">
            <h2>{t('order.addSong')}</h2>
            <span className="pill">
              <span className="dd-genre" style={{ background: genre.color }} />
              {t(genreMessageKey(genreNo))}
            </span>
          </div>
          <p>{t('order.addSongIntro')}</p>
        </div>
        <div className="dd-search">
          <Icon name="search" size={15} />
          <input
            autoFocus
            placeholder={t('songlist.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="dd-results">
          {results.length === 0
            ? <div className="dd-results-empty">{t('order.noMatchingSongs')}</div>
            : results.map((row) => (
              <SongResult key={row.uniqueId} row={row} locale={locale} onPick={() => onPick(row.uniqueId)} />
            ))}
        </div>
      </div>
    </div>
  );
}

function SongResult({ row, locale, onPick }: { row: SongRow; locale: Locale; onPick: () => void }) {
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
