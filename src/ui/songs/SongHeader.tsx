import { useAppStore } from '../../model/store';
import { preferredTitle, SongRow } from '../../model/songlist';
import { genreMessageKey } from '../../model/genres';
import { useT } from '../../i18n';

function formatBpm(bpm: number): string {
  if (Number.isInteger(bpm)) return String(bpm);
  return bpm.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function SongHeader({ row }: { row: SongRow }) {
  const locale = useAppStore((s) => s.ui.locale);
  const fumen = useAppStore((s) => s.fumen);
  const t = useT();
  const bpm =
    fumen.kind === 'ready' && fumen.loaded.fumen.measures.length > 0
      ? formatBpm(fumen.loaded.fumen.measures[0].bpm)
      : '—';

  return (
    <div className="tk-songhead">
      <div>
        <h1>{preferredTitle(row, locale)}</h1>
        <div className="ro">
          <span>{t('metadata.songId')} <b>{row.id}</b></span>
          <span>{t('metadata.songNo')} <b>{row.uniqueId}</b></span>
          <span>{t('metadata.genre')} <b>{t(genreMessageKey(row.genreNo))}</b></span>
          <span>{t('metadata.initialBpm')} <b>{bpm}</b></span>
        </div>
      </div>
      <div style={{ flex: 1 }} />
    </div>
  );
}
