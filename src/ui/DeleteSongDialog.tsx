// Delete Song confirmation. Removing a song drops it from all six datatables
// immediately (undoable); its on-disk fumen folder + sound file are removed
// when the project is next saved.

import { useAppStore } from '../model/store';
import { preferredTitle, hasAudioFile, hasChartFile } from '../model/songlist';
import { useT } from '../i18n';
import { Icon } from './shell/Icon';

export function DeleteSongDialog() {
  const project = useAppStore((s) => s.project);
  const locale = useAppStore((s) => s.ui.locale);
  const deleteSongId = useAppStore((s) => s.ui.deleteSongId);
  const deleteSong = useAppStore((s) => s.deleteSong);
  const closeDeleteSong = useAppStore((s) => s.closeDeleteSong);
  const t = useT();

  const open = project.kind === 'open' ? project.project : undefined;
  if (!open || deleteSongId === undefined) return null;
  const row = open.songs.byUniqueId.get(deleteSongId);
  if (!row) return null;

  const hasChart = hasChartFile(open.assets, row);
  const hasAudio = hasAudioFile(open.assets, row);
  const filesNote = hasChart && hasAudio
    ? t('deletesong.filesBoth')
    : hasChart
      ? t('deletesong.filesChart')
      : hasAudio
        ? t('deletesong.filesSound')
        : t('deletesong.filesNone');

  return (
    <div className="tk-modal-overlay" onClick={closeDeleteSong}>
      <div className="tk-modal" style={{ width: 460 }} onClick={(e) => e.stopPropagation()}>
        <div className="tk-modal-head">
          <div className="row">
            <h2>{t('deletesong.title')}</h2>
            <span className="tk-mono pill">{t('deletesong.pill', { id: row.id, no: row.uniqueId })}</span>
          </div>
          <p>{t('deletesong.confirm', { title: preferredTitle(row, locale) })}</p>
        </div>

        <div className="tk-modal-form">
          <div className="tk-modal-note">{filesNote}</div>
          <div className="tk-modal-note">{t('deletesong.undoNote')}</div>
        </div>

        <div className="tk-modal-foot">
          <div style={{ flex: 1 }} />
          <button className="tk-btn" onClick={closeDeleteSong}>{t('common.cancel')}</button>
          <button
            className="tk-btn tk-btn-danger tk-btn-primary"
            onClick={() => deleteSong(deleteSongId)}
          >
            <Icon name="eraser" /> {t('deletesong.title')}
          </button>
        </div>
      </div>
    </div>
  );
}
