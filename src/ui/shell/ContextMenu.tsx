// Cursor-anchored right-click menu shell. Positions itself at the click point
// (fixed), clamps into the viewport, and dismisses on outside-click / Esc /
// scroll / resize. The chrome is `.tk-menu`, shared with the dropdown menus in
// Menu.tsx; callers supply the items through a render prop receiving `close`.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** Viewport coordinates of the right-click that opened a menu. */
export interface ContextMenuAnchor {
  x: number;
  y: number;
}

interface ContextMenuProps {
  anchor: ContextMenuAnchor;
  onClose: () => void;
  /** Panel width floor, matching `.tk-ctxmenu .tk-menu` unless overridden. */
  minWidth?: number;
  children: (close: () => void) => ReactNode;
}

export function ContextMenu({ anchor, onClose, minWidth, children }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });

  // Keep the panel on-screen: measure once mounted, then nudge left/up if it
  // would overflow the bottom/right edge.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    setPos({
      left: Math.max(margin, Math.min(anchor.x, window.innerWidth - rect.width - margin)),
      top: Math.max(margin, Math.min(anchor.y, window.innerHeight - rect.height - margin)),
    });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onClose);
    // Capture-phase so a scroll inside a pane (not just the window) closes it.
    window.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return (
    <div
      className="tk-ctxmenu"
      style={{ left: pos.left, top: pos.top }}
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
      // The panel is an overlay, never part of what it covers. Callers can sit
      // over a surface that starts a drag on press, so the press that picks an
      // item must stop here instead of also reaching that surface.
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="tk-menu" role="menu" style={minWidth ? { minWidth } : undefined}>
        {children(onClose)}
      </div>
    </div>
  );
}
