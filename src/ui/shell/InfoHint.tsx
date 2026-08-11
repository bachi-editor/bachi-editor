// A small info icon that reveals an explanatory popup on hover/focus. Used in
// place of terse inline tags (e.g. the Sound tab's file-scope hints) so the
// label stays compact while the full explanation is one hover away.

import type { ReactNode } from 'react';
import { useT } from '../../i18n';
import { Icon } from './Icon';

export function InfoHint({ children, label }: { children: ReactNode; label?: string }) {
  const t = useT();
  return (
    <span className="tk-hint" tabIndex={0} role="note" aria-label={label ?? t('infohint.more')}>
      <Icon name="info" size={14} className="tk-hint-ic" />
      <span className="tk-hint-pop" role="tooltip">{children}</span>
    </span>
  );
}
