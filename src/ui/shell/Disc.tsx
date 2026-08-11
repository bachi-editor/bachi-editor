import { useState, type ReactNode } from 'react';
import { useT } from '../../i18n';
import { Icon } from './Icon';

// Inspector content swaps between chart, note, and measure views. Keep each
// disclosure's last state outside the mounted card so selection changes do not
// reset expanded/collapsed sections.
const OPEN_BY_KEY = new Map<string, boolean>();

export function Disc({
  title,
  count,
  dirty = false,
  defaultOpen = false,
  stateKey,
  children,
}: {
  title: string;
  count?: number;
  dirty?: boolean;
  defaultOpen?: boolean;
  stateKey?: string;
  children: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(() => {
    if (stateKey === undefined) return defaultOpen;
    const remembered = OPEN_BY_KEY.get(stateKey);
    if (remembered !== undefined) return remembered;
    OPEN_BY_KEY.set(stateKey, defaultOpen);
    return defaultOpen;
  });
  const showCount = count !== undefined && count > 0;
  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      if (stateKey !== undefined) OPEN_BY_KEY.set(stateKey, next);
      return next;
    });
  };

  return (
    <section className={`tk-disc${open ? ' open' : ''}`}>
      <button
        className="tk-disc-hd"
        type="button"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className={`tk-chev${open ? ' open' : ''}`}>
          <Icon name="chevron" />
        </span>
        <span className="t">{title}</span>
        {dirty && <span className="dot" title={t('disc.editedInSection')} />}
        {showCount && <span className="ct">{count}</span>}
      </button>
      {open && <div className="tk-disc-body">{children}</div>}
    </section>
  );
}
