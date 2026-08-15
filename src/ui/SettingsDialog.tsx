import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { validateG719EncoderWasm, validateG719Wasm } from '../codec';
import {
  clearG719EncoderWasm,
  clearG719DecoderWasm,
  loadG719EncoderWasm,
  loadG719DecoderWasm,
  saveG719EncoderWasm,
  saveG719DecoderWasm,
  type StoredG719EncoderWasm,
  type StoredG719DecoderWasm,
} from '../fs/idb';
import type { OpenValidationError } from '../fs/project';
import { type TFn, useT } from '../i18n';
import { useAppStore } from '../model/store';
import { soundbankPlayer } from '../audio';
import { Icon } from './shell/Icon';

type DecoderState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'ready'; record: StoredG719DecoderWasm }
  | { kind: 'invalid'; record: StoredG719DecoderWasm }
  | { kind: 'error' };

type EncoderState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'ready'; record: StoredG719EncoderWasm }
  | { kind: 'invalid'; record: StoredG719EncoderWasm }
  | { kind: 'error' };

function setupErrorMessage(t: TFn, err: OpenValidationError): string {
  switch (err.field) {
    case 'folder':
      return t('setup.error.folder');
    case 'datatable':
      return err.reason === 'format' ? t('setup.error.datatableKeyFormat') : t('setup.error.datatableKey');
    case 'fumen':
      return err.reason === 'format' ? t('setup.error.fumenKeyFormat') : t('setup.error.fumenKey');
    case 'generic':
      return err.message || t('setup.error.generic');
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export function SettingsDialog() {
  const project = useAppStore((s) => s.project);
  const setup = useAppStore((s) => s.setup);
  const close = useAppStore((s) => s.closeSettings);
  const pickFolder = useAppStore((s) => s.setupPickFolder);
  const setKey = useAppStore((s) => s.setupSetKey);
  const openProject = useAppStore((s) => s.setupOpenProject);
  // The export bundle is launched from the overflow menu, not from here, but its
  // dialog stacks above Settings and must keep owning Esc while it is open.
  const exportOpen = useAppStore((s) => s.ui.exportDialogOpen);
  const reconnect = useAppStore((s) => s.reconnect);
  const forget = useAppStore((s) => s.forgetProject);
  const notifyDecoderChanged = useAppStore((s) => s.notifyG719DecoderChanged);
  const decoderInputRef = useRef<HTMLInputElement>(null);
  const encoderInputRef = useRef<HTMLInputElement>(null);
  const [decoder, setDecoder] = useState<DecoderState>({ kind: 'loading' });
  const [decoderBusy, setDecoderBusy] = useState(false);
  const [decoderError, setDecoderError] = useState<string>();
  const [encoder, setEncoder] = useState<EncoderState>({ kind: 'loading' });
  const [encoderBusy, setEncoderBusy] = useState(false);
  const [encoderError, setEncoderError] = useState<string>();
  // Pending "close project" confirmation, holding the edit count that triggered
  // it. Shown inline in place of the action row rather than as a second modal.
  const [closeConfirm, setCloseConfirm] = useState<number>();
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const record = await loadG719DecoderWasm();
        if (!record) {
          if (!cancelled) setDecoder({ kind: 'missing' });
          return;
        }
        try {
          await validateG719Wasm(new Uint8Array(record.bytes));
          if (!cancelled) setDecoder({ kind: 'ready', record });
        } catch {
          if (!cancelled) setDecoder({ kind: 'invalid', record });
        }
      } catch {
        if (!cancelled) setDecoder({ kind: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const record = await loadG719EncoderWasm();
        if (!record) {
          if (!cancelled) setEncoder({ kind: 'missing' });
          return;
        }
        try {
          await validateG719EncoderWasm(new Uint8Array(record.bytes));
          if (!cancelled) setEncoder({ kind: 'ready', record });
        } catch {
          if (!cancelled) setEncoder({ kind: 'invalid', record });
        }
      } catch {
        if (!cancelled) setEncoder({ kind: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The export dialog stacks on top of Settings; let it own Esc while open.
      if (event.key !== 'Escape' || setup.busy || decoderBusy || encoderBusy || exportOpen) return;
      // Esc backs out of the inline close-project confirmation first.
      if (closeConfirm !== undefined) setCloseConfirm(undefined);
      else close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close, closeConfirm, decoderBusy, encoderBusy, exportOpen, setup.busy]);

  const onDecoderFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setDecoderBusy(true);
    setDecoderError(undefined);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await validateG719Wasm(bytes);
      const record: StoredG719DecoderWasm = {
        name: file.name,
        size: bytes.byteLength,
        storedAt: Date.now(),
        bytes: bytes.slice().buffer,
      };
      await saveG719DecoderWasm(record);
      soundbankPlayer.release();
      notifyDecoderChanged();
      setDecoder({ kind: 'ready', record });
    } catch (error) {
      setDecoderError((error as Error).message);
    } finally {
      setDecoderBusy(false);
    }
  };

  const removeDecoder = async () => {
    setDecoderBusy(true);
    setDecoderError(undefined);
    try {
      await clearG719DecoderWasm();
      soundbankPlayer.release();
      notifyDecoderChanged();
      setDecoder({ kind: 'missing' });
    } catch {
      setDecoderError(t('settings.decoder.storageError'));
    } finally {
      setDecoderBusy(false);
    }
  };

  const onEncoderFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    setEncoderBusy(true);
    setEncoderError(undefined);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      await validateG719EncoderWasm(bytes);
      const record: StoredG719EncoderWasm = {
        name: file.name,
        size: bytes.byteLength,
        storedAt: Date.now(),
        bytes: bytes.slice().buffer,
      };
      await saveG719EncoderWasm(record);
      setEncoder({ kind: 'ready', record });
    } catch (error) {
      setEncoderError((error as Error).message);
    } finally {
      setEncoderBusy(false);
    }
  };

  const removeEncoder = async () => {
    setEncoderBusy(true);
    setEncoderError(undefined);
    try {
      await clearG719EncoderWasm();
      setEncoder({ kind: 'missing' });
    } catch {
      setEncoderError(t('settings.encoder.storageError'));
    } finally {
      setEncoderBusy(false);
    }
  };

  // Closing a project drops every in-memory draft, so unsaved edits get a
  // confirmation step first.
  const closeProject = () => {
    const edits = useAppStore.getState().getEditCount();
    if (edits > 0) {
      setCloseConfirm(edits);
      return;
    }
    void forget();
  };

  const discardAndClose = () => {
    setCloseConfirm(undefined);
    void forget();
  };

  const selectedFolder =
    setup.folderName
    ?? (project.kind === 'open' ? project.project.root.handle.name : undefined);
  const hasFolder = !!setup.handle;
  const canOpen =
    hasFolder
    && setup.datatableKey.trim() !== ''
    && setup.fumenKey.trim() !== ''
    && !setup.busy;
  const errField = setup.error?.field;
  const decoderRecord = decoder.kind === 'ready' || decoder.kind === 'invalid' ? decoder.record : undefined;
  const encoderRecord = encoder.kind === 'ready' || encoder.kind === 'invalid' ? encoder.record : undefined;
  const codecBusy = decoderBusy || encoderBusy;

  return (
    <div
      className="tk-modal-overlay"
      onClick={setup.busy || codecBusy ? undefined : close}
    >
      <div className="tk-modal tk-settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="tk-modal-head">
          <div className="row">
            <Icon name="settings" />
            <h2>{t('settings.title')}</h2>
          </div>
          <p>{t('settings.description')}</p>
        </div>

        <div className="tk-modal-body">
          <section className="tk-settings-section">
            <div className="tk-settings-section-head">
              <div>
                <h3>{t('settings.project.title')}</h3>
                <p>{t('settings.project.hint')}</p>
              </div>
              {project.kind === 'open' && (
                <span className="tk-settings-ok"><Icon name="check" size={13} /> {t('settings.project.open')}</span>
              )}
            </div>

            {project.kind === 'needs-permission' ? (
              <div className="tk-settings-fields">
                <div className="tk-modal-note">
                  {t('setup.remembered', { name: project.handle.name })}
                </div>
                <div className="tk-settings-actions">
                  <button className="tk-btn tk-btn-primary" onClick={reconnect} disabled={setup.busy}>
                    <Icon name="folder" /> {t('setup.reconnect', { name: project.handle.name })}
                  </button>
                  <button className="tk-btn" onClick={forget} disabled={setup.busy}>
                    {t('setup.forget')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="tk-settings-fields">
                <div className="tk-field">
                  <label>{t('setup.step1.title')}</label>
                  {selectedFolder ? (
                    <div className="tk-folder-row">
                      <div className={'tk-folder-chosen' + (errField === 'folder' ? ' bad' : '')}>
                        <Icon name="check" size={14} />
                        <code>{selectedFolder}</code>
                      </div>
                      <button className="tk-btn" onClick={pickFolder} disabled={setup.busy}>
                        <Icon name="folder" size={15} /> {t('setup.step1.change')}
                      </button>
                    </div>
                  ) : (
                    <button className="tk-btn" onClick={pickFolder} disabled={setup.busy}>
                      <Icon name="folder" size={15} /> {t('setup.step1.button')}
                    </button>
                  )}
                </div>

                <div className="tk-row2">
                  <div className="tk-field">
                    <label>{t('setup.step2.datatableKey')}</label>
                    <input
                      className="tk-input tk-key-input"
                      type="text"
                      spellCheck={false}
                      autoComplete="off"
                      autoCapitalize="off"
                      placeholder={t('setup.step2.placeholder')}
                      value={setup.datatableKey}
                      aria-invalid={errField === 'datatable'}
                      onChange={(event) => setKey('datatable', event.currentTarget.value)}
                      disabled={setup.busy}
                    />
                  </div>
                  <div className="tk-field">
                    <label>{t('setup.step2.fumenKey')}</label>
                    <input
                      className="tk-input tk-key-input"
                      type="text"
                      spellCheck={false}
                      autoComplete="off"
                      autoCapitalize="off"
                      placeholder={t('setup.step2.placeholder')}
                      value={setup.fumenKey}
                      aria-invalid={errField === 'fumen'}
                      onChange={(event) => setKey('fumen', event.currentTarget.value)}
                      disabled={setup.busy}
                    />
                  </div>
                </div>

                {project.kind === 'error' && <div className="tk-modal-note err">{project.message}</div>}
                {setup.error && (
                  <div className="tk-error-banner tk-setup-error" role="alert">
                    <h3><Icon name="alert" size={14} /> {t('setup.error.title')}</h3>
                    <p>{setupErrorMessage(t, setup.error)}</p>
                    <p className="tk-setup-error-hint">{t('setup.error.checkHint')}</p>
                  </div>
                )}

                {closeConfirm !== undefined ? (
                  <div className="tk-inline-confirm" role="alert">
                    <Icon name="alert" size={18} />
                    <div className="tk-inline-confirm-text">
                      <strong>{t('settings.project.closeConfirm')}</strong>
                      <span>
                        {t(
                          closeConfirm === 1 ? 'settings.project.closeUnsaved.one' : 'settings.project.closeUnsaved.other',
                          { n: closeConfirm },
                        )}
                      </span>
                    </div>
                    <div className="tk-settings-actions">
                      <button className="tk-btn" onClick={() => setCloseConfirm(undefined)}>
                        {t('common.cancel')}
                      </button>
                      <button className="tk-btn tk-btn-danger tk-btn-primary" onClick={discardAndClose}>
                        {t('settings.project.discardAndClose')}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="tk-settings-actions">
                    <button className="tk-btn tk-btn-primary" onClick={openProject} disabled={!canOpen}>
                      {setup.busy ? (
                        <><span className="tk-spin" /> {t('setup.opening')}</>
                      ) : (
                        <><Icon name="folder" /> {t('setup.step3.button')}</>
                      )}
                    </button>
                    <button
                      className="tk-btn tk-btn-danger"
                      onClick={closeProject}
                      disabled={project.kind !== 'open' || setup.busy}
                    >
                      <Icon name="close" /> {t('settings.project.close')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="tk-settings-section">
            <div className="tk-settings-section-head">
              <div>
                <h3>{t('settings.decoder.title')}</h3>
                <p>{t('settings.decoder.hint')}</p>
              </div>
              <span className={'tk-settings-decoder-state ' + decoder.kind}>
                {decoder.kind === 'loading'
                  ? t('settings.decoder.checking')
                  : decoder.kind === 'ready'
                    ? t('settings.decoder.ready')
                    : decoder.kind === 'invalid'
                      ? t('settings.decoder.invalid')
                      : decoder.kind === 'error'
                        ? t('settings.decoder.storageError')
                        : t('settings.decoder.missing')}
              </span>
            </div>

            {/* Laid out like the project section above: the current file reads as
                a chip with its action beside it, then the destructive action on
                its own row, present but disabled until it applies. */}
            <div className="tk-settings-fields">
              <div className="tk-field">
                {decoderRecord ? (
                  <div className="tk-folder-row">
                    <div className="tk-folder-chosen">
                      <Icon name={decoder.kind === 'ready' ? 'check' : 'alert'} size={14} />
                      <code>{decoderRecord.name}</code>
                      <span className="tk-settings-file-size">{formatBytes(decoderRecord.size)}</span>
                    </div>
                    <button className="tk-btn" onClick={() => decoderInputRef.current?.click()} disabled={decoderBusy}>
                      <Icon name="import" size={15} /> {t('settings.decoder.replace')}
                    </button>
                  </div>
                ) : (
                  <button className="tk-btn" onClick={() => decoderInputRef.current?.click()} disabled={decoderBusy}>
                    <Icon name="import" size={15} /> {t('settings.decoder.choose')}
                  </button>
                )}
              </div>

              {decoderError && (
                <div className="tk-modal-note err">
                  {t('settings.decoder.fileError')} <span className="tk-mono">{decoderError}</span>
                </div>
              )}
              <input
                ref={decoderInputRef}
                type="file"
                accept=".wasm,application/wasm"
                onChange={onDecoderFile}
                hidden
              />
              <div className="tk-settings-actions">
                <button
                  className="tk-btn tk-btn-danger"
                  onClick={removeDecoder}
                  disabled={!decoderRecord || decoderBusy}
                >
                  <Icon name="trash" /> {t('settings.decoder.remove')}
                </button>
              </div>
            </div>
          </section>

          <section className="tk-settings-section">
            <div className="tk-settings-section-head">
              <div>
                <h3>{t('settings.encoder.title')}</h3>
                <p>{t('settings.encoder.hint')}</p>
              </div>
              <span className={'tk-settings-decoder-state ' + encoder.kind}>
                {encoder.kind === 'loading'
                  ? t('settings.encoder.checking')
                  : encoder.kind === 'ready'
                    ? t('settings.encoder.ready')
                    : encoder.kind === 'invalid'
                      ? t('settings.encoder.invalid')
                      : encoder.kind === 'error'
                        ? t('settings.encoder.storageError')
                        : t('settings.encoder.missing')}
              </span>
            </div>

            <div className="tk-settings-fields">
              <div className="tk-field">
                {encoderRecord ? (
                  <div className="tk-folder-row">
                    <div className="tk-folder-chosen">
                      <Icon name={encoder.kind === 'ready' ? 'check' : 'alert'} size={14} />
                      <code>{encoderRecord.name}</code>
                      <span className="tk-settings-file-size">{formatBytes(encoderRecord.size)}</span>
                    </div>
                    <button className="tk-btn" onClick={() => encoderInputRef.current?.click()} disabled={encoderBusy}>
                      <Icon name="import" size={15} /> {t('settings.encoder.replace')}
                    </button>
                  </div>
                ) : (
                  <button className="tk-btn" onClick={() => encoderInputRef.current?.click()} disabled={encoderBusy}>
                    <Icon name="import" size={15} /> {t('settings.encoder.choose')}
                  </button>
                )}
              </div>

              {encoderError && (
                <div className="tk-modal-note err">
                  {t('settings.encoder.fileError')} <span className="tk-mono">{encoderError}</span>
                </div>
              )}
              <input
                ref={encoderInputRef}
                type="file"
                accept=".wasm,application/wasm"
                onChange={onEncoderFile}
                hidden
              />
              <div className="tk-settings-actions">
                <button
                  className="tk-btn tk-btn-danger"
                  onClick={removeEncoder}
                  disabled={!encoderRecord || encoderBusy}
                >
                  <Icon name="trash" /> {t('settings.encoder.remove')}
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="tk-modal-foot">
          <div style={{ flex: 1 }} />
          <button className="tk-btn" onClick={close} disabled={setup.busy || codecBusy}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
