import { useMemo } from 'react';
import { useAppStore, type Area } from '../../model/store';
import { diffDatatables } from '../../model/diff';
import { collectFumenDiffs } from '../../model/fumenDrafts';
import { collectSoundMetadataDiffs } from '../../model/soundMetadata';
import { BrandMark, Icon } from './Icon';
import { Menu } from './Menu';
import { ThemeToggle } from './ThemeToggle';
import { LanguagePicker } from './LanguagePicker';
import { type MessageKey, useT } from '../../i18n';

const AREAS: { value: Area; labelKey: MessageKey }[] = [
  { value: 'songs', labelKey: 'nav.songs' },
  { value: 'order', labelKey: 'nav.order' },
  { value: 'dani', labelKey: 'nav.dani' },
];

export function TopBar() {
  const project = useAppStore((s) => s.project);
  const area = useAppStore((s) => s.ui.area);
  const setArea = useAppStore((s) => s.setArea);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const openExportDialog = useAppStore((s) => s.openExportDialog);
  const openSettings = useAppStore((s) => s.openSettings);
  const openAbout = useAppStore((s) => s.openAbout);
  const saveStatus = useAppStore((s) => s.save);
  const t = useT();

  const open = project.kind === 'open' ? project.project : undefined;
  const edits = useMemo(
    () =>
      open
        ? diffDatatables(open.baseline, open.datatables).totalEdits +
          collectFumenDiffs(open.fumenBaselines, open.fumenDrafts).length +
          collectSoundMetadataDiffs(open.soundMetadataBaselines, open.soundMetadataDrafts).length
        : 0,
    [open],
  );
  const canUndo = !!open && open.undo.length > 0;
  const canRedo = !!open && open.redo.length > 0;
  const dirty = edits > 0;

  return (
    <header className="tk-topbar">
      <div className="tk-brand">
        <BrandMark />
        <span className="tk-brand-name">Bachi <span>· {t('brand.tagline')}</span></span>
      </div>

      <div className="tk-topnav">
        {AREAS.map((ar) => (
          <button
            key={ar.value}
            type="button"
            className={'tk-toparea' + (area === ar.value ? ' on' : '')}
            aria-pressed={area === ar.value}
            onClick={() => setArea(ar.value)}
          >
            {t(ar.labelKey)}
          </button>
        ))}
      </div>

      <div className="tk-spacer" />

      {open && area !== 'dani' && (
        <>
          {saveStatus.kind === 'done' && !dirty && (
            <button
              className="tk-tag ok tk-tag-btn"
              onClick={openExportDialog}
              title={t('topbar.serverBundleReadyTitle')}
            >
              {t('topbar.serverBundleReady')}
            </button>
          )}

          <div className="tk-btn-grp" title={t('topbar.undoRedo')}>
            <button disabled={!canUndo} onClick={undo} title={t('topbar.undoTitle')}><Icon name="undo" /></button>
            <button disabled={!canRedo} onClick={redo} title={t('topbar.redoTitle')}><Icon name="redo" /></button>
          </div>
        </>
      )}

      <ThemeToggle />
      <LanguagePicker />
      <Menu
        trigger={<Icon name="kebab" size={16} />}
        triggerClassName="tk-iconbtn"
        triggerTitle={t('topbar.menu')}
        minWidth={168}
      >
        {(close) => (
          <>
            <button
              className="tk-menu-item"
              role="menuitem"
              onClick={() => { close(); openSettings(); }}
            >
              <span className="ic"><Icon name="settings" size={15} /></span>
              {t('topbar.settings')}
            </button>
            <button
              className="tk-menu-item"
              role="menuitem"
              onClick={() => { close(); openAbout(); }}
            >
              <span className="ic"><Icon name="info" size={15} /></span>
              {t('topbar.about')}
            </button>
          </>
        )}
      </Menu>
    </header>
  );
}
