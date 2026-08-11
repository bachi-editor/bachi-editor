// Dani Dojo area — a standalone single-file editor with two file slots in the
// rail (Normal = dan_data.json, Gaiden = gaiden_data.json), each independently
// loaded/saved (see PLAN.md, Dani Dojo). The detail panel + modals
// live in sibling files.

import { useState } from 'react';
import { useAppStore, type DanSection } from '../../model/store';
import {
  danTitleParts,
  NORMAL_MAX_DANS,
  normalDanTitleForIndex,
  type DanConfig,
  type DanEntry,
} from '../../codec/serverdata';
import { danSectionEdited, isEmptyDan } from '../../model/danEdits';
import { validateDan } from '../../model/danValidation';
import { TFn, useT } from '../../i18n';
import { ConfirmDialog } from '../shell/ConfirmDialog';
import { Icon } from '../shell/Icon';
import { PageHeader, type SaveAction } from '../shell/PageHeader';
import { useDanResolver } from './useDani';
import { DaniDetail } from './DaniDetail';
import { DaniSongPicker } from './DaniSongPicker';
import { DaniSaveDialog } from './DaniSaveDialog';
import type { DanSongResolver } from '../../model/danValidation';

export function DaniArea() {
  const sel = useAppStore((s) => s.dani.sel);
  const picker = useAppStore((s) => s.dani.picker);
  const saveOpen = useAppStore((s) => s.dani.saveOpen);
  const normal = useAppStore((s) => s.dani.normal);
  const gaiden = useAppStore((s) => s.dani.gaiden);
  const openSave = useAppStore((s) => s.daniOpenSave);
  const t = useT();
  const anyLoaded = normal.loaded || gaiden.loaded;

  // One independent Save target per loaded file. ⌘S saves the selected file, so
  // only that button advertises the shortcut.
  const actions: SaveAction[] = [];
  if (normal.loaded)
    actions.push({ key: 'normal', label: t('dani.saveSection', { name: t('dani.normal') }), dirty: danSectionEdited(normal), onSave: () => openSave('normal'), kbd: sel?.section === 'normal' });
  if (gaiden.loaded)
    actions.push({ key: 'gaiden', label: t('dani.saveSection', { name: t('gaiden.label') }), dirty: danSectionEdited(gaiden), onSave: () => openSave('gaiden'), kbd: sel?.section === 'gaiden' });

  return (
    <>
      <PageHeader title={t('nav.dani')} hint={t('dani.pageHint')} actions={actions} />
      <div className="tk-body">
        <aside className="dd-rail">
          <DaniSection section="normal" />
          <DaniSection section="gaiden" />
        </aside>
        <div className="dd-main">
          {sel ? <DaniDetail /> : <DaniEmpty anyLoaded={anyLoaded} />}
        </div>
      </div>
      {picker && <DaniSongPicker />}
      {saveOpen && <DaniSaveDialog />}
    </>
  );
}

function rankParts(section: DanSection, d: DanEntry, t: TFn): { jp: string; en: string } {
  return section === 'gaiden' ? { jp: '外', en: t('gaiden.label') } : danTitleParts(d.title);
}

function baselineJsonMap(config: DanConfig): Map<number, string> {
  const m = new Map<number, string>();
  for (const d of config) m.set(d.danId, JSON.stringify(d));
  return m;
}

function songSummary(d: DanEntry, resolve: DanSongResolver | undefined, t: TFn): string {
  if (isEmptyDan(d)) return t('dani.cleared');
  return d.aryOdaiSong
    .map((s) => resolve?.(s.songNo)?.title ?? (s.songNo ? t('dani.songNoLabel', { n: s.songNo }) : '—'))
    .join(' · ');
}

function DaniSection({ section }: { section: DanSection }) {
  const slot = useAppStore((s) => s.dani[section]);
  const sel = useAppStore((s) => s.dani.sel);
  const error = useAppStore((s) => s.dani.error);
  const canOpen = useAppStore((s) => s.canOpenDani());
  const load = useAppStore((s) => s.daniLoad);
  const create = useAppStore((s) => s.daniNew);
  const closeFile = useAppStore((s) => s.daniClose);
  const addDan = useAppStore((s) => s.daniAddDan);
  const selectDan = useAppStore((s) => s.daniSelectDan);
  const resolve = useDanResolver();
  const t = useT();
  const [discardAction, setDiscardAction] = useState<'load' | 'close' | undefined>();

  const title = section === 'normal' ? t('dani.title') : t('gaiden.label');
  const baseMap = baselineJsonMap(slot.baseline);
  const isEdited = (d: DanEntry) => baseMap.get(d.danId) !== JSON.stringify(d);
  const sectionEdited = danSectionEdited(slot);

  const atMax = section === 'normal' && slot.draft.length >= NORMAL_MAX_DANS;
  const addLabel = section === 'normal'
    ? (atMax ? t('dani.allDansAdded', { max: NORMAL_MAX_DANS }) : t('dani.addNextDan', { jp: danTitleParts(normalDanTitleForIndex(slot.draft.length)).jp }))
    : t('gaiden.addSet');
  const countLabel = section === 'normal' ? `${slot.draft.length} / ${NORMAL_MAX_DANS}` : `${slot.draft.length}`;
  // Loading another file (or closing this one) drops the in-memory draft, so an
  // edited section confirms first — held here until the themed dialog resolves.
  const runDiscardable = (action: 'load' | 'close') => {
    if (action === 'load') void load(section);
    else closeFile(section);
  };
  const request = (action: 'load' | 'close') => {
    if (sectionEdited) setDiscardAction(action);
    else runDiscardable(action);
  };

  return (
    <section className="dd-section">
      <div className="dd-section-head">
        <h2>{title}</h2>
        {slot.loaded && <span className="count">{countLabel}</span>}
        <span className="spring" />
        <div className="dd-file-actions">
          <button
            className="tk-iconbtn"
            onClick={() => request('load')}
            disabled={!canOpen}
            title={canOpen ? t('dani.loadTitle') : t('dani.noPickerTitle')}
            aria-label={canOpen ? t('dani.loadTitle') : t('dani.noPickerTitle')}
          >
            <Icon name="folder" size={15} />
          </button>
          {!slot.loaded && (
            <button
              className="tk-iconbtn"
              onClick={() => create(section)}
              title={t('dani.newTitle')}
              aria-label={t('dani.newTitle')}
            >
              <Icon name="plus" size={15} />
            </button>
          )}
          {slot.loaded && (
            <button
              className="tk-iconbtn"
              onClick={() => request('close')}
              title={t('dani.closeFile')}
              aria-label={t('dani.closeFile')}
            >
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
      </div>

      {slot.loaded ? (
        <>
          <div className="dd-list">
            {slot.draft.map((d) => {
              const r = rankParts(section, d, t);
              const empty = isEmptyDan(d);
              const hasError = validateDan(d, resolve).some((i) => i.level === 'error');
              const on = sel?.section === section && sel.danId === d.danId;
              return (
                <button key={d.danId} className={'dd-danrow' + (on ? ' sel' : '')} onClick={() => selectDan(section, d.danId)}>
                  <span className="dd-rank"><span className="jp">{r.jp}</span><span className="en">{r.en}</span></span>
                  <span className="dd-danmain">
                    <span className="dd-danid">{t('dani.danN', { id: d.danId })}</span>
                    <div className={'dd-songsum' + (empty ? ' empty' : '')}>{songSummary(d, resolve, t)}</div>
                  </span>
                  <span className="dd-rowright">
                    {isEdited(d) && <span className="tk-edit-dot" title={t('metadata.edited')} />}
                    {hasError && <span className="dd-errdot" title={t('dani.blocksSave')} />}
                  </span>
                </button>
              );
            })}
          </div>
          <button className="dd-addbtn" onClick={() => addDan(section)} disabled={atMax}>
            <Icon name="plus" size={14} /> {addLabel}
          </button>
        </>
      ) : (
        <div className="dd-secempty">
          {section === 'normal'
            ? t('dani.secEmptyNormal', { file: 'dan_data.json' })
            : t('gaiden.secEmpty', { file: 'gaiden_data.json' })}
        </div>
      )}

      {error && section === 'normal' && <div className="dd-secerr">{error}</div>}

      {discardAction && (
        <ConfirmDialog
          danger
          title={t('dani.discardTitle')}
          body={t('dani.discardUnsaved')}
          confirmLabel={t('dani.discard')}
          onConfirm={() => {
            const action = discardAction;
            setDiscardAction(undefined);
            runDiscardable(action);
          }}
          onCancel={() => setDiscardAction(undefined)}
        />
      )}
    </section>
  );
}

function DaniEmpty({ anyLoaded }: { anyLoaded: boolean }) {
  const t = useT();
  return (
    <div className="dd-empty">
      <div className="dd-empty-inner">
        <div className="dd-empty-ic">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 3v4a1 1 0 0 0 1 1h4" />
            <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z" />
          </svg>
        </div>
        <div className="dd-empty-title">{anyLoaded ? t('dani.emptySelectTitle') : t('dani.emptyOpenTitle')}</div>
        <div className="dd-empty-sub">
          {anyLoaded
            ? t('dani.emptySelectSub')
            : t('dani.emptyOpenSub', { file: 'dan_data.json' })}
        </div>
      </div>
    </div>
  );
}
