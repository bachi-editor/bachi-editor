// Per-section save review: the added/edited/removed dans, warnings, and blocking
// errors. Mirrors the game-data SaveDialog
// but scoped to one dani file (its own dirty context; see PLAN.md, Dani Dojo).

import { useAppStore } from '../../model/store';
import {
  danCourseLabel,
  danTitleParts,
  type DanConfig,
  type DanEntry,
} from '../../codec/serverdata';
import { validateSection, type DanSongResolver } from '../../model/danValidation';
import { TFn, useT } from '../../i18n';
import { Icon } from '../shell/Icon';
import { useDanResolver } from './useDani';

interface SaveRow {
  key: string;
  badge: string;
  badgeCls: string;
  title: string;
  sum: string;
  changes: { k: string; v: string }[];
}

function labelOf(section: 'normal' | 'gaiden', d: DanEntry): string {
  return section === 'gaiden' ? d.title : danTitleParts(d.title).en;
}

function songTitle(songNo: number, resolve: DanSongResolver | undefined): string {
  if (!songNo) return '—';
  return resolve?.(songNo)?.title ?? `Song No. ${songNo}`;
}

function diffDan(base: DanEntry, draft: DanEntry, resolve: DanSongResolver | undefined): { k: string; v: string }[] {
  const changes: { k: string; v: string }[] = [];
  if (draft.title !== base.title) changes.push({ k: 'title', v: `${base.title} → ${draft.title}` });
  if (draft.verupNo !== base.verupNo) changes.push({ k: 'verupNo', v: `${base.verupNo} → ${draft.verupNo}` });
  draft.aryOdaiSong.forEach((s, i) => {
    const b = base.aryOdaiSong[i] ?? { songNo: 0, level: 0, isHiddenSongName: false };
    if (s.songNo !== b.songNo) changes.push({ k: `song ${i + 1}`, v: `${songTitle(b.songNo, resolve)} → ${songTitle(s.songNo, resolve)}` });
    if (s.level !== b.level) changes.push({ k: `song ${i + 1} course`, v: `${danCourseLabel(b.level)} → ${danCourseLabel(s.level)}` });
    if (s.isHiddenSongName !== b.isHiddenSongName) changes.push({ k: `song ${i + 1} name`, v: `${b.isHiddenSongName ? 'hidden' : 'shown'} → ${s.isHiddenSongName ? 'hidden' : 'shown'}` });
  });
  if (draft.aryOdaiBorder.length !== base.aryOdaiBorder.length) {
    changes.push({ k: 'criteria', v: `${base.aryOdaiBorder.length} → ${draft.aryOdaiBorder.length} rows` });
  } else if (JSON.stringify(draft.aryOdaiBorder) !== JSON.stringify(base.aryOdaiBorder)) {
    changes.push({ k: 'criteria', v: 'thresholds edited' });
  }
  return changes;
}

function computeRows(section: 'normal' | 'gaiden', baseline: DanConfig, draft: DanConfig, resolve: DanSongResolver | undefined, t: TFn): SaveRow[] {
  const baseById = new Map(baseline.map((d) => [d.danId, d]));
  const rows: SaveRow[] = [];
  const danTitle = (d: DanEntry) => `${labelOf(section, d)} · ${t('dani.danN', { id: d.danId })}`;
  for (const d of draft) {
    const base = baseById.get(d.danId);
    if (!base) {
      rows.push({ key: `+${d.danId}`, badge: '+', badgeCls: 'tk-save-badge add', title: danTitle(d), sum: t('dani.newDanAdded'), changes: [] });
      continue;
    }
    if (JSON.stringify(d) === JSON.stringify(base)) continue;
    const changes = diffDan(base, d, resolve);
    rows.push({
      key: `~${d.danId}`, badge: '✎', badgeCls: 'tk-save-badge edit',
      title: danTitle(d),
      sum: t(changes.length === 1 ? 'dani.changeCount.one' : 'dani.changeCount.other', { n: changes.length }),
      changes: changes.slice(0, 8),
    });
  }
  const draftIds = new Set(draft.map((d) => d.danId));
  for (const b of baseline) {
    if (!draftIds.has(b.danId)) {
      rows.push({ key: `-${b.danId}`, badge: '−', badgeCls: 'tk-save-badge del', title: danTitle(b), sum: t('dani.danRemoved'), changes: [] });
    }
  }
  return rows;
}

export function DaniSaveDialog() {
  const section = useAppStore((s) => s.dani.saveOpen);
  const normal = useAppStore((s) => s.dani.normal);
  const gaiden = useAppStore((s) => s.dani.gaiden);
  const saving = useAppStore((s) => s.dani.saving);
  const error = useAppStore((s) => s.dani.error);
  const close = useAppStore((s) => s.daniCloseSave);
  const commit = useAppStore((s) => s.daniCommitSave);
  const resolve = useDanResolver();
  const t = useT();

  if (!section) return null;
  const slot = section === 'normal' ? normal : gaiden;
  const rows = computeRows(section, slot.baseline, slot.draft, resolve, t);
  const { errors, warnings } = validateSection(slot.draft, resolve, section);
  const canSave = errors.length === 0 && rows.length > 0 && !saving;

  return (
    <div className="tk-modal-overlay" onClick={close}>
      <div className="tk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tk-modal-head">
          <div className="row">
            <h2>{section === 'gaiden' ? t('dani.saveGaidenTitle') : t('dani.saveNormalTitle')}</h2>
            <span className="pill">{t(rows.length === 1 ? 'dani.changeCount.one' : 'dani.changeCount.other', { n: rows.length })}</span>
          </div>
          <p>{t('dani.saveDesc', { file: slot.fileName })}</p>
        </div>

        <div className="tk-modal-body">
          {rows.length === 0 && <div className="tk-modal-empty">{t('savedialog.noChanges')}</div>}
          {rows.length > 0 && (
            <>
              <div className="tk-modal-grouphd">{t('dani.changedDans')}</div>
              {rows.map((row) => (
                <div key={row.key} className="tk-save-row">
                  <span className={row.badgeCls}>{row.badge}</span>
                  <div className="tk-save-rowmain">
                    <div className="tk-save-file">{row.title}</div>
                    <div className="tk-save-sum">{row.sum}</div>
                    {row.changes.map((c, i) => (
                      <div key={i} className="tk-save-change"><span className="k">{c.k}</span><span className="v">{c.v}</span></div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
          {warnings.length > 0 && (
            <>
              <div className="tk-modal-grouphd warn">{t('savedialog.warnings')}</div>
              {warnings.map((w, i) => <div key={i} className="tk-save-issue warn">{w.message}</div>)}
            </>
          )}
          {errors.length > 0 && (
            <>
              <div className="tk-modal-grouphd err">{t('dani.errorsBlocked')}</div>
              {errors.map((e, i) => <div key={i} className="tk-save-issue err">{e.message}</div>)}
            </>
          )}
          {error && <div className="tk-save-issue err">{error}</div>}
        </div>

        <div className="tk-modal-foot">
          {errors.length > 0
            ? <span className="tk-save-status err">{t(errors.length === 1 ? 'savedialog.errorsBlock.one' : 'savedialog.errorsBlock.other', { n: errors.length })}</span>
            : rows.length > 0 && <span className="tk-save-status ok"><Icon name="check" size={15} /> {t('dani.readyToSave')}</span>}
          <div className="tk-spacer" />
          <button className="tk-btn tk-btn-sm" onClick={close}>{t('common.cancel')}</button>
          <button className={'tk-btn tk-btn-sm' + (canSave ? ' tk-btn-primary' : '')} onClick={commit} disabled={!canSave}>
            <Icon name="save" size={15} /> {saving ? t('savedialog.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
