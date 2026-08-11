// Dismissable overflow menu / popover (Phase 13.4). The app had no generic
// menu primitive; this wraps a trigger button + an absolutely-positioned panel
// that closes on outside-click and Esc. `children` is a render prop receiving
// `close` so menu items can dismiss the menu after firing their action.

import { useEffect, useRef, useState, type ReactNode } from 'react';

interface MenuProps {
  trigger: ReactNode;
  triggerClassName?: string;
  triggerTitle?: string;
  minWidth?: number;
  children: (close: () => void) => ReactNode;
}

export function Menu({ trigger, triggerClassName, triggerTitle, minWidth, children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="tk-menuwrap" ref={wrapRef}>
      <button
        type="button"
        className={triggerClassName}
        title={triggerTitle}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {trigger}
      </button>
      {open && (
        <div className="tk-menu" role="menu" style={minWidth ? { minWidth } : undefined}>
          {children(close)}
        </div>
      )}
    </div>
  );
}
