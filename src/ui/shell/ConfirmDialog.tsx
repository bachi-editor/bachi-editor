// Themed stand-in for `window.confirm`. Native browser dialogs are reserved for
// the things the page genuinely cannot own — a reload or a tab close (see the
// beforeunload handler in App.tsx). Everything else confirms inside our own
// chrome, so the app never breaks out of its theme mid-action.

import { useEffect, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { Icon } from './Icon';

interface ConfirmDialogProps {
  title: string;
  body: ReactNode;
  /** Label on the confirming button; defaults to a generic "Continue". */
  confirmLabel?: string;
  /** Render the confirming button as destructive (red). */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="tk-modal-overlay" onClick={onCancel}>
      <div
        className="tk-modal tk-confirm-modal"
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="tk-modal-head">
          <div className="row">
            <span className={'tk-confirm-ic' + (danger ? ' danger' : '')}><Icon name="alert" size={20} /></span>
            <h2>{title}</h2>
          </div>
          <p>{body}</p>
        </div>
        <div className="tk-modal-foot">
          <div style={{ flex: 1 }} />
          <button className="tk-btn" onClick={onCancel}>{t('common.cancel')}</button>
          <button
            className={'tk-btn tk-btn-primary' + (danger ? ' tk-btn-danger' : '')}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
