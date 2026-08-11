// The selected dan's editor: title/rank head, three odai-song slots, the clear
// criteria (borders), and an inline per-dan validation panel.

import { useAppStore, type DanSection } from '../../model/store';
import {
  BORDER_TYPE_ALL,
  BORDER_TYPE_PER_SONG,
  DAN_CONDITION_TYPES,
  DAN_COURSES,
  danConditionType,
  danTitleParts,
  EXPECTED_ODAI_SONGS,
  ODAI_TYPE_SCORE,
  type OdaiBorder,
  type OdaiSong,
} from '../../codec/serverdata';
import { isEmptyDan, type BorderValueKey } from '../../model/danEdits';
import { validateDan, type DanSongResolver } from '../../model/danValidation';
import { genreFor } from '../../model/genres';
import { useT } from '../../i18n';
import { Icon } from '../shell/Icon';
import { MarqueeText } from '../shell/MarqueeText';
import { SongMetadataLine } from '../SongMetadataLine';
import { useDanResolver } from './useDani';

function intVal(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>): number {
  const n = parseInt(e.target.value, 10);
  return Number.isFinite(n) ? n : 0;
}

export function DaniDetail() {
  const sel = useAppStore((s) => s.dani.sel);
  const normal = useAppStore((s) => s.dani.normal);
  const gaiden = useAppStore((s) => s.dani.gaiden);
  const setGaidenTitle = useAppStore((s) => s.daniSetGaidenTitle);
  const clearDan = useAppStore((s) => s.daniClearDan);
  const removeDan = useAppStore((s) => s.daniRemoveDan);
  const addBorder = useAppStore((s) => s.daniAddBorder);
  const addSong = useAppStore((s) => s.daniAddSong);
  const resolve = useDanResolver();
  const t = useT();

  if (!sel) return null;
  const section = sel.section;
  const slot = section === 'normal' ? normal : gaiden;
  const d = slot.draft.find((x) => x.danId === sel.danId);
  if (!d) return null;

  const rank = section === 'gaiden' ? { jp: '外', en: t('gaiden.label') } : danTitleParts(d.title);
  const isLast = slot.draft.length > 0 && slot.draft[slot.draft.length - 1].danId === d.danId;
  const empty = isEmptyDan(d);
  const issues = validateDan(d, resolve);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');

  return (
    <>
      <div className="dd-detail-head">
        <div className="dd-dantitle">
          <span className="kanji">{rank.jp}</span>
          <div>
            {section === 'gaiden'
              ? <input className="dd-titleinput" value={d.title} onChange={(e) => setGaidenTitle(d.danId, e.target.value)}
                  title={t('gaiden.titleKeyTitle')} />
              : <h1>{rank.en}</h1>}
            <div className="crumb">
              <span>{slot.fileName}</span>
              <b>{t('dani.danN', { id: d.danId })}</b>
              <span>{t('dani.verupNo', { n: d.verupNo })}</span>
              <span>{t('dani.titleCrumb', { title: d.title })}</span>
            </div>
          </div>
        </div>
        <div className="tk-spacer" />
        <div className="tk-tooldiv" />
        <button className="tk-btn tk-btn-sm" onClick={() => clearDan(section, d.danId)}
          title={t('dani.clearDataTitle')}>{t('dani.clearData')}</button>
        <button className="tk-btn tk-btn-sm tk-btn-danger" onClick={() => removeDan(section)} disabled={!isLast}
          title={isLast ? t('dani.removeThisDan') : t('dani.removeTrailingOnly')}>
          {t('dani.removeDan')}
        </button>
      </div>

      <div className="dd-scroll">
        <div className="dd-detail">
          {empty && (
            <div className="dd-clearedbanner">
              <span className="ic"><Icon name="alert" size={18} /></span>
              <div>
                <b>{t('dani.clearedTitle')}</b> {t('dani.clearedBody')}
              </div>
            </div>
          )}

          <div className="dd-detail-cols">
            <section>
              <div className="dd-sec-h">
                {t('dani.odaiSongs')} <span className="sub">{t(d.aryOdaiSong.length === 1 ? 'dani.songCount.one' : 'dani.songCount.other', { n: d.aryOdaiSong.length })}</span>
                <span className="spring" />
                <button className="tk-btn tk-btn-sm" onClick={() => addSong(section, d.danId)}
                  disabled={d.aryOdaiSong.length >= EXPECTED_ODAI_SONGS}
                  title={d.aryOdaiSong.length >= EXPECTED_ODAI_SONGS ? t('dani.exactSongs', { n: EXPECTED_ODAI_SONGS }) : t('dani.addSongSlot')}>
                  <Icon name="plus" size={13} /> {t('addsong.addSong')}
                </button>
              </div>
              <div className="dd-songs">
                {d.aryOdaiSong.map((song, i) => (
                  <SongSlot key={i} section={section} danId={d.danId} slot={i} song={song} resolve={resolve} />
                ))}
              </div>
            </section>

            <section>
              <div className="dd-sec-h">
                {t('dani.clearCriteria')} <span className="sub">{t('dani.evaluatedOver')}</span>
                <span className="spring" />
                <button className="tk-btn tk-btn-sm" onClick={() => addBorder(section, d.danId)}>
                  <Icon name="plus" size={13} /> {t('dani.addCriterion')}
                </button>
              </div>
              {d.aryOdaiBorder.length === 0 ? (
                <div className="dd-secempty" style={{ margin: 0 }}>
                  {t('dani.noCriteria')}
                </div>
              ) : (
                <div className="dd-borders">
                  {d.aryOdaiBorder.map((b, i) => (
                    <BorderCard key={i} section={section} danId={d.danId} index={i} border={b} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <DanValidation errors={errors} warnings={warnings} />
        </div>
      </div>
    </>
  );
}

function SongSlot({ section, danId, slot, song, resolve }: {
  section: DanSection; danId: number; slot: number; song: OdaiSong; resolve: DanSongResolver | undefined;
}) {
  const setCourse = useAppStore((s) => s.daniSetCourse);
  const setHidden = useAppStore((s) => s.daniSetHidden);
  const openPicker = useAppStore((s) => s.daniOpenPicker);
  const removeSong = useAppStore((s) => s.daniRemoveSong);
  const t = useT();

  // songNo 0 is the "no song" sentinel — never resolve it (uniqueId 0 is a real,
  // title-less song in the catalog, which used to leak in as a bogus placeholder).
  const c = song.songNo > 0 ? resolve?.(song.songNo) : undefined;
  const empty = song.songNo <= 0;

  let title: string;
  let sub: string | undefined;
  if (c) {
    title = c.title;
  } else if (!empty) {
    title = t('dani.songNoLabel', { n: song.songNo });
    sub = resolve ? t('dani.notFound') : t('dani.openProjectForTitle');
  } else {
    title = t('dani.noSongSelected');
    sub = t('dani.tapToChoose');
  }
  const genreColor = c ? genreFor(c.genreNo).color : 'var(--line-2)';

  return (
    <div className={'dd-slot' + (empty ? ' empty' : '')}>
      <div className="dd-slot-head">
        <span className="dd-slot-n">{t('dani.slotN', { n: slot + 1 })}</span>
        <span className="spring" />
        <button className="dd-pick" onClick={() => openPicker(section, danId, slot)} title={t('dani.chooseSong')}>
          <Icon name="note" size={15} />
        </button>
        <button className="dd-x" onClick={() => removeSong(section, danId, slot)} title={t('songheader.deleteTitle')}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="dd-slot-body">
        <span className="dd-genre" style={{ background: genreColor }} />
        <div className="dd-slot-txt">
          {/* Titles roll forever here — the cards never take focus, so long ones
              would otherwise be silently clipped in the fixed-width grid. */}
          <div className={'dd-slot-title' + (empty ? ' ph' : '')}>
            {c ? <MarqueeText text={title} active /> : title}
          </div>
          {c ? (
            <SongMetadataLine
              songId={c.id}
              songNo={song.songNo}
              genreNo={c.genreNo}
              stars={c.stars}
              layout="inline"
            />
          ) : (
            <div className="dd-slot-sub">{sub}</div>
          )}
        </div>
      </div>
      <div className="dd-slot-ctrls">
        <div className="dd-mini-field course">
          <label>{t('dani.course')}</label>
          <select className="dd-mini ui" value={song.level} onChange={(e) => setCourse(section, danId, slot, intVal(e))}>
            {DAN_COURSES.map((c2) => <option key={c2.value} value={c2.value}>{c2.label}</option>)}
          </select>
        </div>
        <div className="dd-mini-field">
          <label>{t('dani.songName')}</label>
          <div className="tk-seg">
            <button className={song.isHiddenSongName ? 'on' : ''} onClick={() => setHidden(section, danId, slot, true)}>{t('dani.hidden')}</button>
            <button className={song.isHiddenSongName ? '' : 'on'} onClick={() => setHidden(section, danId, slot, false)}>{t('dani.shown')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function BorderCard({ section, danId, index, border }: {
  section: DanSection; danId: number; index: number; border: OdaiBorder;
}) {
  const setOdaiType = useAppStore((s) => s.daniSetBorderOdaiType);
  const setBorderType = useAppStore((s) => s.daniSetBorderType);
  const setValue = useAppStore((s) => s.daniSetBorderValue);
  const removeBorder = useAppStore((s) => s.daniRemoveBorder);
  const t = useT();

  const meta = danConditionType(border.odaiType);
  const cmp = meta?.comparison ?? '≥';
  const upperLimit = cmp === '<';
  const isAll = border.borderType === BORDER_TYPE_ALL;
  const redWord = upperLimit ? t('dani.passLt') : t('dani.passGeq');
  const goldWord = upperLimit ? t('dani.goldLt') : t('dani.goldGeq');
  const set = (key: BorderValueKey, e: React.ChangeEvent<HTMLInputElement>) => setValue(section, danId, index, key, intVal(e));

  return (
    <div className={'dd-border' + (isAll ? '' : ' per')}>
      <select className="dd-typesel" value={border.odaiType} onChange={(e) => setOdaiType(section, danId, index, intVal(e))}>
        {DAN_CONDITION_TYPES
          .filter((t) => t.value !== ODAI_TYPE_SCORE || border.odaiType === ODAI_TYPE_SCORE)
          .map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <span className="dd-unit">{meta?.unit ?? '?'}</span>
      <div className="tk-seg">
        <button className={isAll ? 'on' : ''} onClick={() => setBorderType(section, danId, index, BORDER_TYPE_ALL)}>{t('dani.wholeSet')}</button>
        <button className={isAll ? '' : 'on'} onClick={() => setBorderType(section, danId, index, BORDER_TYPE_PER_SONG)}>{t('dani.perSong')}</button>
      </div>
      <span className="spring" />

      {isAll ? (
        <div className="dd-thr-all">
          <div className="cell" title={t('dani.redBorder', { word: redWord })}>
            <span className="pip red" /><span className="cmp">{cmp}</span>
            <input type="number" value={border.redBorderTotal} onChange={(e) => set('redBorderTotal', e)} />
          </div>
          <div className="cell" title={t('dani.goldBorder', { word: goldWord })}>
            <span className="pip gold" /><span className="cmp">{cmp}</span>
            <input type="number" value={border.goldBorderTotal} onChange={(e) => set('goldBorderTotal', e)} />
          </div>
        </div>
      ) : (
        <div className="dd-persong">
          {([1, 2, 3] as const).map((n) => (
            <PerSongRow key={n} n={n} cmp={cmp} border={border} onSet={set} />
          ))}
        </div>
      )}

      <button className="dd-x" onClick={() => removeBorder(section, danId, index)} title={t('dani.removeCriterion')}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

function PerSongRow({ n, cmp, border, onSet }: {
  n: 1 | 2 | 3;
  cmp: string;
  border: OdaiBorder;
  onSet: (key: BorderValueKey, e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const t = useT();
  const redKey = `redBorder_${n}` as BorderValueKey;
  const goldKey = `goldBorder_${n}` as BorderValueKey;
  return (
    <>
      <span className="rowh">{t('dani.songN', { n })}</span>
      <div className="cell">
        <span className="pip red" /><span className="cmp">{cmp}</span>
        <input type="number" value={border[redKey]} onChange={(e) => onSet(redKey, e)} />
      </div>
      <div className="cell">
        <span className="pip gold" /><span className="cmp">{cmp}</span>
        <input type="number" value={border[goldKey]} onChange={(e) => onSet(goldKey, e)} />
      </div>
    </>
  );
}

function DanValidation({ errors, warnings }: { errors: { message: string }[]; warnings: { message: string }[] }) {
  const t = useT();
  if (errors.length === 0 && warnings.length === 0) {
    return (
      <div className="dd-valid">
        <div className="dd-issue ok"><span className="ic"><Icon name="check" size={15} /></span>{t('dani.noIssues')}</div>
      </div>
    );
  }
  return (
    <div className="dd-valid">
      <div className="dd-valid-h">{t('dani.validation')} <span className="ct">{errors.length + warnings.length}</span></div>
      {errors.map((i, k) => (
        <div key={`e${k}`} className="dd-issue err"><span className="ic"><Icon name="alert" size={15} /></span>{i.message}</div>
      ))}
      {warnings.map((i, k) => (
        <div key={`w${k}`} className="dd-issue warn"><span className="ic"><Icon name="alert" size={15} /></span>{i.message}</div>
      ))}
    </div>
  );
}
