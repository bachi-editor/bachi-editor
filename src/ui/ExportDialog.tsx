import { useMemo, useState } from 'react';
import { buildServerBundle, downloadServerBundle, type ServerBundle } from '../fs/exportBundle';
import { diffDatatables } from '../model/diff';
import { collectFumenDiffs } from '../model/fumenDrafts';
import { collectSoundMetadataDiffs } from '../model/soundMetadata';
import { useAppStore } from '../model/store';
import { useT } from '../i18n';
import { Icon } from './shell/Icon';

type ExportState =
  | { kind: 'idle' }
  | { kind: 'building' }
  | { kind: 'done'; bundle: ServerBundle }
  | { kind: 'error'; message: string };

export function ExportDialog() {
  const project = useAppStore((s) => s.project);
  const closeExportDialog = useAppStore((s) => s.closeExportDialog);
  const open = project.kind === 'open' ? project.project : undefined;
  const [state, setState] = useState<ExportState>({ kind: 'idle' });
  const t = useT();

  const dirtyEdits = useMemo(() => {
    if (!open) return 0;
    return (
      diffDatatables(open.baseline, open.datatables).totalEdits +
      collectFumenDiffs(open.fumenBaselines, open.fumenDrafts).length +
      collectSoundMetadataDiffs(open.soundMetadataBaselines, open.soundMetadataDrafts).length
    );
  }, [open]);

  if (!open) return null;

  const building = state.kind === 'building';
  const buildAndDownload = async () => {
    setState({ kind: 'building' });
    try {
      const bundle = await buildServerBundle(open.root, open.datatables, { dirty: dirtyEdits > 0 });
      downloadServerBundle(bundle);
      setState({ kind: 'done', bundle });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  };

  return (
    <div className="tk-modal-overlay" onClick={building ? undefined : closeExportDialog}>
      <div className="tk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tk-modal-head">
          <div className="row">
            <h2>{t('export.title')}</h2>
            <span className="tk-mono pill">TaikoLocalServer</span>
          </div>
          <p>{t('export.intro', { path: 'TaikoLocalServer/Host/wwwroot/data/datatable/' })}</p>
        </div>

        <div className="tk-modal-body">
          {dirtyEdits > 0 && (
            <div className="tk-save-issue warn">
              {t(dirtyEdits === 1 ? 'export.dirtyWarn.one' : 'export.dirtyWarn.other', { n: dirtyEdits })}
            </div>
          )}

          <div className="tk-modal-group">
            <div className="tk-modal-grouphd">{t('export.bundleContents')}</div>
            {['musicinfo', 'music_order', 'wordlist'].map((name) => (
              <div className="tk-save-row" key={name}>
                <span className="tk-save-badge same">·</span>
                <div className="tk-save-rowmain">
                  <div className="tk-mono tk-save-file">{name}.bin + {name}.json</div>
                  <div className="tk-save-sum">{t('export.datatableSum')}</div>
                </div>
              </div>
            ))}
            <div className="tk-save-row">
              <span className="tk-save-badge same">·</span>
              <div className="tk-save-rowmain">
                <div className="tk-mono tk-save-file">neiro.bin + neiro.json</div>
                <div className="tk-save-sum">{t('export.neiroSum')}</div>
              </div>
            </div>
            <div className="tk-save-row">
              <span className="tk-save-badge same">·</span>
              <div className="tk-save-rowmain">
                <div className="tk-mono tk-save-file">README.txt</div>
                <div className="tk-save-sum">{t('export.readmeSum')}</div>
              </div>
            </div>
          </div>

          {state.kind === 'done' && (
            <div className="tk-modal-group">
              <div className="tk-modal-grouphd">{t('export.created')}</div>
              <div className="tk-save-issue ok">
                {t('export.downloaded', { filename: state.bundle.filename, n: state.bundle.files.length })}
              </div>
            </div>
          )}

          {state.kind === 'error' && (
            <div className="tk-modal-group">
              <div className="tk-modal-grouphd err">{t('export.error')}</div>
              <div className="tk-save-issue err">{state.message}</div>
            </div>
          )}
        </div>

        <div className="tk-modal-foot">
          {state.kind === 'done' ? (
            <span className="tk-save-status ok"><Icon name="check" /> {t('export.statusDownloaded')}</span>
          ) : state.kind === 'error' ? (
            <span className="tk-save-status err">{t('export.statusFailed')}</span>
          ) : (
            <span className="tk-save-status ok"><Icon name="check" /> {t('export.statusReady')}</span>
          )}
          <div style={{ flex: 1 }} />
          <button className="tk-btn" onClick={closeExportDialog} disabled={building}>
            {state.kind === 'done' ? t('common.close') : t('common.cancel')}
          </button>
          <button className="tk-btn tk-btn-primary" onClick={buildAndDownload} disabled={building}>
            <Icon name="export" /> {building ? t('export.building') : state.kind === 'done' ? t('export.downloadAgain') : t('export.buildZip')}
          </button>
        </div>
      </div>
    </div>
  );
}
