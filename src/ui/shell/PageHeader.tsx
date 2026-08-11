// The consistent page toolbar shown at the top of every editing area (Songs,
// Music Order, Dani Dojo). It carries the page title, optional context, and the
// page's Save action(s) on the right — so every page saves itself from the same
// place instead of the old scattered top-bar / canvas / rail buttons.
//
// Each page owns disjoint files (see model/saveScope.ts), so a page can expose
// more than one independent Save target: Songs/Order have one; the Dojo has one
// per loaded file (Normal, Gaiden).

import { type ReactNode } from 'react';
import { useT } from '../../i18n';
import { Icon } from './Icon';

export interface SaveAction {
  /** Stable key (page/section) for the React list. */
  key: string;
  /** Button text, e.g. "Save" or "Save Normal". */
  label: string;
  dirty: boolean;
  onSave: () => void;
  /** Show the ⌘S hint (only the primary/single target advertises the shortcut). */
  kbd?: boolean;
}

export function PageHeader({
  title,
  hint,
  children,
  actions,
}: {
  title: string;
  hint?: ReactNode;
  children?: ReactNode;
  /** One entry per independent Save target for this page. */
  actions: SaveAction[];
}) {
  const t = useT();

  return (
    <div className="tk-pagehead">
      <h2>{title}</h2>
      {hint && <span className="tk-pagehead-hint">{hint}</span>}
      {children}
      <span className="tk-pagehead-spring" />
      {actions.map((a) => (
        <button
          key={a.key}
          className={'tk-btn tk-pagehead-save' + (a.dirty ? ' tk-btn-primary' : '')}
          disabled={!a.dirty}
          onClick={a.onSave}
          title={a.dirty ? t('topbar.reviewSave') : t('topbar.noUnsaved')}
        >
          <Icon name="save" /> {a.label}
          {a.kbd && <span className="tk-kbd">⌘S</span>}
        </button>
      ))}
    </div>
  );
}
