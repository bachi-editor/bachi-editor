// Save dialog — grouped diff preview + direct save, mirroring
// resources/UI-design-reference/screens.jsx:SaveDialog.
//
// The diff is semantic (decoded field changes), not byte-level: the on-disk
// JSON whitespace isn't reproducible so a byte diff would be noise. A
// Only intended production targets are written (handled in fs/write.ts).
// Validation errors block the save.

import { useMemo } from 'react';
import { useAppStore } from '../model/store';
import { diffDatatables, FileDiff } from '../model/diff';
import { scopedDatatables } from '../model/saveScope';
import { collectFumenDiffs, FumenFileDiff } from '../model/fumenDrafts';
import { collectCreatedFumens, collectRemovedFumens, FumenSlotChange } from '../model/fumenSlots';
import { collectSoundMetadataDiffs, SoundMetadataDiff } from '../model/soundMetadata';
import { validate } from '../model/validation';
import { validateDirtyFumens } from '../model/fumenValidation';
import { useT } from '../i18n';
import { Icon } from './shell/Icon';
import { verifyEncoderSelfConsistent } from '../codec';

function dirBadge(fd: FileDiff): '+' | '−' | '·' {
  if (!fd.dirty) return '·';
  if (fd.changes.some((c) => c.label.startsWith('−'))) return '−';
  if (fd.changes.some((c) => c.label.startsWith('+'))) return '+';
  return '·';
}

function FileRow({ fd }: { fd: FileDiff }) {
  const t = useT();
  const badge = dirBadge(fd);
  const cls = badge === '+' ? 'add' : badge === '−' ? 'del' : 'same';
  return (
    <div className="tk-save-row">
      <span className={'tk-save-badge ' + cls}>{badge}</span>
      <div className="tk-save-rowmain">
        <div className="tk-mono tk-save-file">{fd.file}</div>
        <div className="tk-save-sum">{fd.summary}</div>
        {fd.changes.slice(0, 6).map((c, i) => (
          <div className="tk-save-change" key={i}>
            <span className="k">{c.label}</span>
            <span className="v"><span className="from">{c.from}</span> → <span className="to">{c.to}</span></span>
          </div>
        ))}
        {fd.changes.length > 6 && (
          <div className="tk-save-change more">{t('savedialog.more', { n: fd.changes.length - 6 })}</div>
        )}
      </div>
    </div>
  );
}

function FumenRow({ fd }: { fd: FumenFileDiff }) {
  const cls = fd.byteDelta > 0 ? 'add' : fd.byteDelta < 0 ? 'del' : 'same';
  const badge = fd.byteDelta > 0 ? '+' : fd.byteDelta < 0 ? '−' : '·';
  return (
    <div className="tk-save-row">
      <span className={'tk-save-badge ' + cls}>{badge}</span>
      <div className="tk-save-rowmain">
        <div className="tk-mono tk-save-file">fumen/{fd.songId}/{fd.filename}</div>
        <div className="tk-save-sum">{fd.summary} · {fd.byteDelta >= 0 ? '+' : ''}{fd.byteDelta} B</div>
      </div>
    </div>
  );
}

function FumenSlotRow({ change }: { change: FumenSlotChange }) {
  const t = useT();
  const created = change.kind === 'created';
  return (
    <div className="tk-save-row">
      <span className={'tk-save-badge ' + (created ? 'add' : 'del')}>{created ? '+' : '−'}</span>
      <div className="tk-save-rowmain">
        <div className="tk-mono tk-save-file">fumen/{change.songId}/{change.filename}</div>
        <div className="tk-save-sum">{created ? t('savedialog.newChart') : t('savedialog.removeChart')}</div>
      </div>
    </div>
  );
}

function SoundRow({ fd }: { fd: SoundMetadataDiff }) {
  return (
    <div className="tk-save-row">
      <span className="tk-save-badge same">·</span>
      <div className="tk-save-rowmain">
        <div className="tk-mono tk-save-file">{fd.displayPath}</div>
        <div className="tk-save-sum">{fd.summary}</div>
        {fd.changes.map((c, i) => (
          <div className="tk-save-change" key={i}>
            <span className="k">{c.label}</span>
            <span className="v"><span className="from">{c.from}</span> → <span className="to">{c.to}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SaveDialog() {
  const project = useAppStore((s) => s.project);
  const saveStatus = useAppStore((s) => s.save);
  const scope = useAppStore((s) => s.ui.saveScope) ?? 'songs';
  const closeSaveDialog = useAppStore((s) => s.closeSaveDialog);
  const commitSave = useAppStore((s) => s.commitSave);
  const t = useT();

  const open = project.kind === 'open' ? project.project : undefined;
  const isSongs = scope === 'songs';

  const { diff, fumenDiffs, createdFumens, removedFumens, soundDiffs, validation, fumenIssues } = useMemo(() => {
    if (!open) {
      return {
        diff: undefined,
        fumenDiffs: [],
        createdFumens: [],
        removedFumens: [],
        soundDiffs: [],
        validation: undefined,
        fumenIssues: [],
      };
    }
    // Diff/validate only the files this page owns; charts and sound banks are
    // Songs-owned, so the Music Order save never lists them.
    const scopedDraft = scopedDatatables(open.baseline, open.datatables, scope);
    return {
      diff: diffDatatables(open.baseline, scopedDraft),
      fumenDiffs: isSongs ? collectFumenDiffs(open.fumenBaselines, open.fumenDrafts) : [],
      createdFumens: isSongs ? collectCreatedFumens(open.fumenCreated) : [],
      removedFumens: isSongs ? collectRemovedFumens(open.fumenRemoved) : [],
      soundDiffs: isSongs ? collectSoundMetadataDiffs(open.soundMetadataBaselines, open.soundMetadataDrafts) : [],
      validation: validate(scopedDraft, open.baseline),
      fumenIssues: isSongs ? validateDirtyFumens(open.fumenBaselines, open.fumenDrafts) : [],
    };
  }, [open, scope, isSongs]);

  const codecSelfCheck = useMemo(() => {
    if (!open) return { ok: true as const };
    // Self-check every chart that will be written: edited drafts + created charts
    // (the created chart uses its edited draft if the user touched it).
    const checks: { key: string; label: string }[] = [
      ...fumenDiffs.map((fd) => ({ key: fd.key, label: `fumen/${fd.songId}/${fd.filename}` })),
      ...createdFumens.map((c) => ({ key: c.key, label: `fumen/${c.songId}/${c.filename}` })),
    ];
    for (const { key, label } of checks) {
      const fumen = open.fumenDrafts.get(key) ?? open.fumenCreated.get(key)?.fumen;
      if (!fumen) continue;
      try {
        if (!verifyEncoderSelfConsistent(fumen).ok) return { ok: false as const, file: label };
      } catch {
        return { ok: false as const, file: label };
      }
    }
    return { ok: true as const };
  }, [fumenDiffs, createdFumens, open]);

  if (!open || !diff || !validation) return null;

  const allIssues = [...validation.issues, ...fumenIssues];
  const dirtyFiles = diff.files.filter((f) => f.dirty);
  const errors = allIssues.filter((i) => i.level === 'error');
  const blockingErrors = codecSelfCheck.ok
    ? errors.map((i) => i.message)
    : [
        ...errors.map((i) => i.message),
        t('savedialog.selfCheckFailedFor', { file: codecSelfCheck.file }),
      ];
  const warnings = allIssues.filter((i) => i.level === 'warn');
  const saving = saveStatus.kind === 'saving';
  const fumenChanges = fumenDiffs.length + createdFumens.length + removedFumens.length;
  const totalDirty = dirtyFiles.length + fumenChanges + soundDiffs.length;
  const canSave = blockingErrors.length === 0 && totalDirty > 0 && !saving;
  const changedCount = diff.totalEdits + fumenChanges + soundDiffs.length;
  const selfCheckCopy = fumenDiffs.length === 0
    ? t('savedialog.selfCheckNone')
    : codecSelfCheck.ok
      ? t('savedialog.selfCheckPassed')
      : t('savedialog.selfCheckFailed');

  return (
    <div className="tk-modal-overlay" onClick={saving ? undefined : closeSaveDialog}>
      <div className="tk-modal" onClick={(e) => e.stopPropagation()}>
        <div className="tk-modal-head">
          <div className="row">
            <h2>{isSongs ? t('savedialog.titleSongs') : t('savedialog.titleOrder')}</h2>
            <span className="tk-mono pill">
              {t(totalDirty === 1 ? 'savedialog.pill.one' : 'savedialog.pill.other', { files: totalDirty, changed: changedCount })}
            </span>
          </div>
          <p>{t('savedialog.description', { selfCheck: selfCheckCopy })}</p>
        </div>

        <div className="tk-modal-body">
          {totalDirty === 0 && <div className="tk-modal-empty">{t('savedialog.noChanges')}</div>}
          {dirtyFiles.length > 0 && (
            <div className="tk-modal-group">
              <div className="tk-modal-grouphd">{t('savedialog.datatable')}</div>
              {dirtyFiles.map((fd) => <FileRow key={fd.file} fd={fd} />)}
            </div>
          )}
          {fumenChanges > 0 && (
            <div className="tk-modal-group">
              <div className="tk-modal-grouphd">{t('savedialog.fumen')}</div>
              {createdFumens.map((c) => <FumenSlotRow key={c.key} change={c} />)}
              {fumenDiffs.map((fd) => <FumenRow key={fd.key} fd={fd} />)}
              {removedFumens.map((c) => <FumenSlotRow key={c.key} change={c} />)}
            </div>
          )}
          {soundDiffs.length > 0 && (
            <div className="tk-modal-group">
              <div className="tk-modal-grouphd">{t('savedialog.soundBank')}</div>
              {soundDiffs.map((fd) => <SoundRow key={fd.key} fd={fd} />)}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="tk-modal-group">
              <div className="tk-modal-grouphd warn">{t('savedialog.warnings')}</div>
              {warnings.map((w, i) => <div className="tk-save-issue warn" key={i}>{w.message}</div>)}
            </div>
          )}
          {blockingErrors.length > 0 && (
            <div className="tk-modal-group">
              <div className="tk-modal-grouphd err">{t('savedialog.errors')}</div>
              {blockingErrors.map((message, i) => <div className="tk-save-issue err" key={i}>{message}</div>)}
            </div>
          )}
        </div>

        <div className="tk-modal-foot">
          {saveStatus.kind === 'error' ? (
            <span className="tk-save-status err">✗ {saveStatus.message}</span>
          ) : blockingErrors.length > 0 ? (
            <span className="tk-save-status err">{t(blockingErrors.length === 1 ? 'savedialog.errorsBlock.one' : 'savedialog.errorsBlock.other', { n: blockingErrors.length })}</span>
          ) : (
            <span className="tk-save-status ok"><Icon name="check" /> {t('savedialog.roundTripVerified')}</span>
          )}
          <div style={{ flex: 1 }} />
          <button className="tk-btn" onClick={closeSaveDialog} disabled={saving}>{t('common.cancel')}</button>
          <button className="tk-btn tk-btn-primary" onClick={() => commitSave(scope)} disabled={!canSave}>
            <Icon name="save" /> {saving ? t('savedialog.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
