import type { SongStars } from '../model/songlist';
import { genreMessageKey } from '../model/genres';
import { useT, type MessageKey } from '../i18n';

const STAR_RATINGS: { key: keyof SongStars; label: MessageKey }[] = [
  { key: 'easy', label: 'metadata.difficulty.easy' },
  { key: 'normal', label: 'metadata.difficulty.normal' },
  { key: 'hard', label: 'metadata.difficulty.hard' },
  { key: 'oni', label: 'metadata.difficulty.oni' },
  { key: 'ura', label: 'metadata.difficulty.ura' },
];

export function SongMetadataLine({
  songId,
  songNo,
  genreNo,
  stars,
  layout = 'split',
  active = false,
}: {
  songId: string;
  songNo: number;
  genreNo: number | undefined;
  stars: SongStars;
  layout?: 'split' | 'inline';
  active?: boolean;
}) {
  const t = useT();
  const genre = t(genreMessageKey(genreNo));
  const identity = `${songId} · #${songNo}`;
  const separator = layout === 'inline' ? ' ·' : '';

  return (
    <span className={`tk-song-meta ${layout}${active ? ' active' : ''}`}>
      <span className="tk-song-meta-left" title={`${genre} · ${identity}`}>
        <span className="tk-song-meta-copy tk-song-meta-genre">
          {genre}{separator}
        </span>
        <span className="tk-song-meta-copy tk-song-meta-identity" aria-hidden="true">
          {identity}{separator}
        </span>
      </span>
      <span className="tk-song-meta-stars">
        {STAR_RATINGS.map((rating) => {
          const value = stars[rating.key];
          if (rating.key === 'ura' && value <= 0) return null;
          const label = t('songmeta.starRating', {
            difficulty: t(rating.label),
            stars: value,
          });
          return (
            <span
              key={rating.key}
              className={`tk-song-star ${rating.key}`}
              role="img"
              aria-label={label}
              title={label}
            >
              ★{value}
            </span>
          );
        })}
      </span>
    </span>
  );
}
