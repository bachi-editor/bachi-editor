import type { BrowserSupport } from '../fs/support';
import { useT } from '../i18n';

export function BrowserSupportGate({ support }: { support: BrowserSupport }) {
  const t = useT();
  return (
    <div className="tk-center">
      <div className="tk-card">
        <h1>{t('browsergate.title')}</h1>
        <p>{support.reason}</p>
        <p className="tk-mono" style={{ color: 'var(--ink-3)', fontSize: 12.5 }}>
          {t('browsergate.missing', { list: support.missing.join(', ') })}
        </p>
        <p>{t('browsergate.body')}</p>
      </div>
    </div>
  );
}
