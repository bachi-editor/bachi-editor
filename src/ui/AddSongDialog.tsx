// Add Song dialog — requires catalog identity plus an initial title up front.
// Song No., Song ID, and canonical genre stay immutable after creation; title
// and the remaining supported metadata can be edited afterwards.

import { useMemo, useState } from 'react';
import { useAppStore } from '../model/store';
import { nextUniqueId } from '../model/edits';
import { GENRES, genreMessageKey } from '../model/genres';
import { useT } from '../i18n';
import { Icon } from './shell/Icon';

const ID_RE = /^[a-z0-9_]+$/;

export function AddSongDialog() {
  const project = useAppStore((s) => s.project);
  const addSong = useAppStore((s) => s.addSong);
  const closeAddSong = useAppStore((s) => s.closeAddSong);
  const t = useT();

  const open = project.kind === 'open' ? project.project : undefined;

  const [songNo, setSongNo] = useState('');
  const [id, setId] = useState('');
  const [genreNo, setGenreNo] = useState<number | ''>('');
  const [title, setTitle] = useState('');

  const existingIds = useMemo(() => open?.songs.byId ?? new Map(), [open]);
  const existingSongNos = useMemo(() => open?.songs.byUniqueId ?? new Map(), [open]);
  const nextSongNo = open ? nextUniqueId(open.datatables) : undefined;

  const trimmed = id.trim();
  const trimmedTitle = title.trim();
  const parsedSongNo = /^\d+$/.test(songNo.trim()) ? Number(songNo.trim()) : undefined;
  const error: string | undefined = (() => {
    if (songNo.trim().length > 0 && parsedSongNo === undefined) return t('addsong.errNonNeg');
    if (parsedSongNo !== undefined && (!Number.isSafeInteger(parsedSongNo) || parsedSongNo > 2_147_483_647)) {
      return t('addsong.errRange');
    }
    if (parsedSongNo !== undefined && existingSongNos.has(parsedSongNo)) return t('addsong.errSongNoExists', { n: parsedSongNo });
    if (trimmed.length === 0) return undefined; // empty: no error yet, just disabled
    if (!ID_RE.test(trimmed)) return t('addsong.errIdChars');
    if (existingIds.has(trimmed)) return t('addsong.errIdExists', { id: trimmed });
    return undefined;
  })();
  const canAdd = parsedSongNo !== undefined && trimmed.length > 0 && genreNo !== '' && trimmedTitle.length > 0 && !error;

  const submit = () => {
    if (!canAdd || parsedSongNo === undefined) return;
    addSong({ uniqueId: parsedSongNo, id: trimmed, genreNo, title: trimmedTitle });
  };

  return (
    <div className="tk-modal-overlay" onClick={closeAddSong}>
      <div className="tk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tk-modal-head">
          <div className="row">
            <h2>{t('addsong.addSong')}</h2>
          </div>
          <p>{t('addsong.intro')}</p>
        </div>

        <div className="tk-modal-form">
          <div className="tk-row2">
            <div className="tk-field">
              <label>{t('metadata.songNo')}</label>
              <input
                className="tk-input"
                autoFocus
                inputMode="numeric"
                placeholder={nextSongNo === undefined ? t('metadata.songNo') : t('addsong.eg', { n: nextSongNo })}
                value={songNo}
                onChange={(e) => setSongNo(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              />
            </div>
            <div className="tk-field">
              <label>{t('metadata.songId')}</label>
              <input
                className="tk-input"
                placeholder="my_song"
                value={id}
                onChange={(e) => setId(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              />
            </div>
            <div className="tk-field">
              <label>{t('metadata.genre')}</label>
              <select
                className="tk-input ui"
                value={genreNo}
                onChange={(e) => setGenreNo(e.target.value === '' ? '' : Number(e.target.value))}
              >
                <option value="" disabled>{t('addsong.selectGenre')}</option>
                {GENRES.map((g) => (
                  <option key={g.no} value={g.no}>{t(genreMessageKey(g.no))}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="tk-field">
            <label>{t('addsong.titleAllLocales')}</label>
            <input
              className="tk-input ui"
              placeholder={t('addsong.requiredTitle')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
            />
          </div>
          {error ? (
            <div className="tk-modal-note err">{error}</div>
          ) : (
            <div className="tk-modal-note">
              {t('addsong.idNote', {
                folder: `fumen/${trimmed || 'id'}/`,
                bank: `sound/song_${trimmed || 'id'}.nus3bank`,
              })}
            </div>
          )}
        </div>

        <div className="tk-modal-foot">
          <div style={{ flex: 1 }} />
          <button className="tk-btn" onClick={closeAddSong}>{t('common.cancel')}</button>
          <button className="tk-btn tk-btn-primary" onClick={submit} disabled={!canAdd}>
            <Icon name="plus" /> {t('addsong.addSong')}
          </button>
        </div>
      </div>
    </div>
  );
}
