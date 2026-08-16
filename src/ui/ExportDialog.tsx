// Export server bundle: choose which of the server-facing data sets go into the
// zip and in which format, then build and download it.
//
// Each part has its own independent source — the open game project backs the two
// datatable parts, each Dani Dojo file slot backs one dan part — so the dialog is
// useful with only one of them present, and a part with nothing behind it is
// disabled with the reason rather than exporting empty or stale data.
//
// The format choice and the part selection are remembered (best-effort
// localStorage) so a repeated workflow survives reopening the dialog and the app.

import { useMemo, useState } from 'react';
import {
  buildServerBundle,
  downloadServerBundle,
  SERVER_BUNDLE_PARTS,
  SERVER_DATA_PATH,
  serverBundlePaths,
  type ServerBundle,
  type ServerBundleFormat,
  type ServerBundlePart,
  type ServerBundleSelection,
} from '../fs/exportBundle';
import { danSectionEdited } from '../model/danEdits';
import { diffDatatables } from '../model/diff';
import { useAppStore } from '../model/store';
import { useT, type MessageKey } from '../i18n';
import { Icon } from './shell/Icon';
import { PartHeader } from './shell/PartHeader';

const PREFS_STORAGE_KEY = 'tk-export-bundle';

interface ExportPrefs {
  format: ServerBundleFormat;
  parts: ServerBundleSelection;
}

const DEFAULT_PREFS: ExportPrefs = {
  format: 'bin',
  parts: { musicMetadata: true, musicOrder: true, dan: true, gaiden: true },
};

function loadPrefs(): ExportPrefs {
  try {
    const raw = localStorage.getItem(PREFS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ExportPrefs>;
      const parts = { ...DEFAULT_PREFS.parts };
      for (const part of SERVER_BUNDLE_PARTS) {
        if (parsed.parts?.[part] === false) parts[part] = false;
      }
      return { format: parsed.format === 'json' ? 'json' : 'bin', parts };
    }
  } catch {
    // ignore — fall through to the all-on .bin default
  }
  return DEFAULT_PREFS;
}

function persistPrefs(prefs: ExportPrefs): void {
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore — persistence is best-effort
  }
}

const PART_LABELS: Record<ServerBundlePart, MessageKey> = {
  musicMetadata: 'export.part.musicMetadata',
  musicOrder: 'export.part.musicOrder',
  dan: 'export.part.dan',
  gaiden: 'export.part.gaiden',
};

const PART_SUMS: Record<ServerBundlePart, MessageKey> = {
  musicMetadata: 'export.part.musicMetadataSum',
  musicOrder: 'export.part.musicOrderSum',
  dan: 'export.part.danSum',
  gaiden: 'export.part.gaidenSum',
};

const FORMATS: { value: ServerBundleFormat; label: MessageKey; sum: MessageKey }[] = [
  { value: 'bin', label: 'export.format.bin', sum: 'export.format.binSum' },
  { value: 'json', label: 'export.format.json', sum: 'export.format.jsonSum' },
];

/** Why a part cannot go in the bundle, or undefined when it can. */
type PartIssue = MessageKey | undefined;

type ExportState =
  | { kind: 'idle' }
  | { kind: 'building' }
  | { kind: 'done'; bundle: ServerBundle }
  | { kind: 'error'; message: string };

export function ExportDialog() {
  const project = useAppStore((s) => s.project);
  const normal = useAppStore((s) => s.dani.normal);
  const gaiden = useAppStore((s) => s.dani.gaiden);
  const closeExportDialog = useAppStore((s) => s.closeExportDialog);
  const [prefs, setPrefs] = useState<ExportPrefs>(loadPrefs);
  const [state, setState] = useState<ExportState>({ kind: 'idle' });
  const t = useT();

  const open = project.kind === 'open' ? project.project : undefined;

  // Only the datatables ride along in a bundle, so chart and sound edits — which
  // the project's overall dirty count includes — are deliberately not consulted:
  // an unsaved chart says nothing about whether this zip matches disk.
  const datatableDiff = useMemo(
    () => (open ? diffDatatables(open.baseline, open.datatables) : undefined),
    [open],
  );
  const fileDirty = (name: string) => datatableDiff?.files.some((f) => f.file === name && f.dirty) ?? false;

  // A dani slot that was never opened, or that failed to parse when it was, is
  // simply not loaded; an empty one has nothing worth sending to the server.
  const danIssue = (slot: typeof normal): PartIssue =>
    !slot.loaded ? 'export.needDaniFile' : slot.draft.length === 0 ? 'export.emptyDaniFile' : undefined;
  const hasCompanionTables = Boolean(
    open?.datatables.musicAttribute
    && open.datatables.musicUsbSetting
    && open.datatables.musicAiSection,
  );

  const issues: Record<ServerBundlePart, PartIssue> = {
    musicMetadata: !open
      ? 'export.needProject'
      : hasCompanionTables ? undefined : 'export.needCompanionTables',
    musicOrder: open ? undefined : 'export.needProject',
    dan: danIssue(normal),
    gaiden: danIssue(gaiden),
  };

  const dirty: Record<ServerBundlePart, boolean> = {
    musicMetadata:
      fileDirty('musicinfo.bin')
      || fileDirty('wordlist.bin')
      || fileDirty('music_attribute.bin')
      || fileDirty('music_usbsetting.bin')
      || fileDirty('music_ai_section.bin'),
    musicOrder: fileDirty('music_order.bin'),
    dan: danSectionEdited(normal),
    gaiden: danSectionEdited(gaiden),
  };

  const selected = SERVER_BUNDLE_PARTS.filter((part) => prefs.parts[part] && !issues[part]);
  const dirtySelected = selected.filter((part) => dirty[part]);
  const building = state.kind === 'building';

  const setPart = (part: ServerBundlePart, value: boolean) => {
    setPrefs((previous) => {
      const next = { ...previous, parts: { ...previous.parts, [part]: value } };
      persistPrefs(next);
      return next;
    });
    setState({ kind: 'idle' });
  };

  const setFormat = (format: ServerBundleFormat) => {
    setPrefs((previous) => {
      const next = { ...previous, format };
      persistPrefs(next);
      return next;
    });
    setState({ kind: 'idle' });
  };

  const buildAndDownload = async () => {
    if (selected.length === 0) return;
    setState({ kind: 'building' });
    try {
      const bundle = await buildServerBundle({
        format: prefs.format,
        // Build exactly the selection the dialog showed as exportable: a part
        // whose source is missing stays out even if its box is remembered on.
        parts: {
          musicMetadata: selected.includes('musicMetadata'),
          musicOrder: selected.includes('musicOrder'),
          dan: selected.includes('dan'),
          gaiden: selected.includes('gaiden'),
        },
        sources: {
          project: open ? { root: open.root, datatables: open.datatables } : undefined,
          dan: normal.draft,
          gaiden: gaiden.draft,
        },
        dirty: dirtySelected.length > 0,
      });
      downloadServerBundle(bundle);
      setState({ kind: 'done', bundle });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  };

  return (
    <div className="tk-modal-overlay" onClick={building ? undefined : closeExportDialog}>
      <div className="tk-modal tk-export-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tk-modal-head">
          <div className="row">
            <h2>{t('export.title')}</h2>
            <span className="tk-mono pill">TaikoLocalServer</span>
          </div>
          <p>{t('export.intro', { path: SERVER_DATA_PATH })}</p>
        </div>

        <div className="tk-modal-body">
          {SERVER_BUNDLE_PARTS.map((part) => {
            const issue = issues[part];
            const on = prefs.parts[part] && !issue;
            return (
              <div className="tk-modal-group" key={part}>
                <PartHeader
                  label={t(PART_LABELS[part])}
                  checked={prefs.parts[part]}
                  onChange={(value) => setPart(part, value)}
                  available={!issue}
                  locked={building}
                />
                <div className={on ? undefined : 'tk-skipped'}>
                  <div className="tk-save-row">
                    <span className="tk-save-badge same">·</span>
                    <div className="tk-save-rowmain">
                      <div className="tk-save-sum">{t(PART_SUMS[part])}</div>
                      <div className="tk-mono tk-export-paths">
                        {serverBundlePaths(part, prefs.format).join('  ·  ')}
                      </div>
                    </div>
                  </div>
                </div>
                {issue && (
                  <div className="tk-save-issue tk-issue-row">
                    <Icon name="info" size={14} /> {t(issue)}
                  </div>
                )}
              </div>
            );
          })}

          <div className="tk-modal-group">
            <div className="tk-modal-grouphd">{t('export.formatGroup')}</div>
            {FORMATS.map((format) => (
              <label className="tk-export-opt" key={format.value}>
                <input
                  type="radio"
                  name="tk-export-format"
                  checked={prefs.format === format.value}
                  disabled={building}
                  onChange={() => setFormat(format.value)}
                />
                <div className="tk-save-rowmain">
                  <div className="tk-export-optname">{t(format.label)}</div>
                  <div className="tk-save-sum">{t(format.sum)}</div>
                </div>
              </label>
            ))}
            <div className="tk-save-issue">{t('export.formatDanNote')}</div>
          </div>

          <div className="tk-save-issue">{t('export.readmeAlways')}</div>

          {dirtySelected.length > 0 && (
            <div className="tk-save-issue warn">
              {t('export.dirtyWarn', {
                parts: dirtySelected.map((part) => t(PART_LABELS[part])).join(', '),
              })}
            </div>
          )}

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
          ) : selected.length === 0 ? (
            <span className="tk-save-status warn"><Icon name="alert" /> {t('export.nothingSelected')}</span>
          ) : (
            <span className="tk-save-status ok">
              <Icon name="check" /> {t(selected.length === 1 ? 'export.statusReady.one' : 'export.statusReady.other', { n: selected.length })}
            </span>
          )}
          <div className="tk-spacer" />
          <button className="tk-btn" onClick={closeExportDialog} disabled={building}>
            {state.kind === 'done' ? t('common.close') : t('common.cancel')}
          </button>
          <button
            className="tk-btn tk-btn-primary"
            onClick={() => void buildAndDownload()}
            disabled={building || selected.length === 0}
          >
            <Icon name="export" />
            {' '}
            {building ? t('export.building') : state.kind === 'done' ? t('export.downloadAgain') : t('export.buildZip')}
          </button>
        </div>
      </div>
    </div>
  );
}
