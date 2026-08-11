// Bachi iconography — 16/24 stroke icons at 1.7 stroke-width, ported verbatim
// from resources/UI-design-reference/shared.jsx. Single component, no
// icon-library dependency (the asset is small and we own the paths).

import type { ReactNode } from 'react';

export type IconName =
  | 'search' | 'save' | 'export' | 'note' | 'meta' | 'sound' | 'order'
  | 'undo' | 'redo' | 'play' | 'pause' | 'stop' | 'zoom' | 'settings' | 'folder'
  | 'check' | 'plus' | 'select' | 'eraser' | 'flag' | 'grip' | 'import' | 'trash'
  | 'link' | 'chevron' | 'kebab' | 'globe' | 'close' | 'reset' | 'filter'
  | 'compress' | 'expand'
  | 'arrow-up' | 'arrow-down' | 'arrow-top' | 'arrow-bottom'
  | 'drum' | 'alert' | 'info' | 'sun' | 'moon' | 'brand-light' | 'brand-dark';

interface Paths {
  d: ReactNode;
  s?: number;
  sw?: number;
  fill?: string;
  viewBox?: string;
}

const ICONS: Record<IconName, Paths> = {
  search: { s: 15, d: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></> },
  save: { d: <><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></> },
  export: { d: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5M12 15V3" /></> },
  note: { d: <><circle cx="8" cy="18" r="3" /><circle cx="18" cy="16" r="3" /><path d="M11 18V5l10-2v11" /></> },
  meta: { d: <><path d="M4 6h16M4 12h16M4 18h10" /></> },
  sound: { d: <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M19 9a5 5 0 0 1 0 6" /></> },
  order: { d: <><path d="M3 6h13M3 12h9M3 18h13" /><path d="M18 9l3-3-3-3M18 21l3-3-3-3" /></> },
  undo: { s: 15, d: <><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></> },
  redo: { s: 15, d: <><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></> },
  play: { d: <path d="M6 4l14 8-14 8V4z" />, fill: 'currentColor', sw: 0 },
  pause: { d: <><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></>, fill: 'currentColor', sw: 0 },
  stop: { d: <rect x="6" y="6" width="12" height="12" rx="1.5" />, fill: 'currentColor', sw: 0 },
  zoom: { s: 14, d: <><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4M8 11h6M11 8v6" /></> },
  settings: { d: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.4l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2.4-1.4L13.7 2h-3.4l-.4 2.6a7 7 0 0 0-2.4 1.4l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.8l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2.4 1.4l.4 2.6h3.4l.4-2.6a7 7 0 0 0 2.4-1.4l2.4 1 2-3.4-2-1.6c.07-.46.1-.93.1-1.4z" /></> },
  folder: { d: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /> },
  check: { s: 14, d: <path d="M20 6L9 17l-5-5" />, sw: 2.2 },
  plus: { s: 15, d: <><path d="M12 5v14M5 12h14" /></> },
  select: { s: 15, d: <path d="M3 3l7 18 2-7 7-2L3 3z" />, fill: 'currentColor', sw: 0 },
  eraser: { s: 15, d: <><path d="M7 21h10M5 13l6-6 7 7-6 6H8l-3-3z" /></> },
  flag: { s: 15, d: <><path d="M4 22V4M4 4h13l-2 4 2 4H4" /></> },
  grip: { s: 14, d: <><circle cx="9" cy="6" r="1.4" /><circle cx="9" cy="12" r="1.4" /><circle cx="9" cy="18" r="1.4" /><circle cx="15" cy="6" r="1.4" /><circle cx="15" cy="12" r="1.4" /><circle cx="15" cy="18" r="1.4" /></>, fill: 'currentColor', sw: 0 },
  import: { s: 15, d: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 9l5-5 5 5M12 4v12" /></> },
  trash: { s: 15, d: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 15H6L5 6" /><path d="M10 11v6M14 11v6" /></> },
  link: { s: 14, d: <><path d="M7 9V7a5 5 0 0 1 10 0v2" /><path d="M17 15v2a5 5 0 0 1-10 0v-2" /><path d="M12 8v8" /></> },
  chevron: { s: 14, d: <path d="M9 6l6 6-6 6" />, sw: 2 },
  kebab: { s: 16, d: <><circle cx="12" cy="5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="19" r="1.4" /></>, fill: 'currentColor', sw: 0 },
  globe: { s: 15, d: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></> },
  close: { s: 15, d: <path d="M6 6l12 12M18 6L6 18" />, sw: 1.8 },
  reset: { s: 14, d: <><path d="M3 3v6h6" /><path d="M3.5 13a8 8 0 1 0 1.8-6.3L3 9" /></> },
  filter: { s: 14, d: <path d="M3 5h18l-7 8v5l-4 2v-7L3 5z" /> },
  // Density toggle for the Music Order columns: chevrons fold toward the middle
  // line (compact) or open away from it (expand).
  compress: { s: 15, d: <><path d="M4 12h16" /><path d="M8 5l4 4 4-4" /><path d="M8 19l4-4 4 4" /></> },
  expand: { s: 15, d: <><path d="M4 12h16" /><path d="M8 8l4-4 4 4" /><path d="M8 16l4 4 4-4" /></> },
  // Music Order context-menu move actions: single step up/down, and jump to the
  // folder's top/bottom (the extra bar marks the boundary the card lands against).
  'arrow-up': { s: 15, d: <><path d="M12 19V5" /><path d="M6 11l6-6 6 6" /></> },
  'arrow-down': { s: 15, d: <><path d="M12 5v14" /><path d="M6 13l6 6 6-6" /></> },
  'arrow-top': { s: 15, d: <><path d="M5 4h14" /><path d="M12 20V9" /><path d="M7 14l5-5 5 5" /></> },
  'arrow-bottom': { s: 15, d: <><path d="M5 20h14" /><path d="M12 4v11" /><path d="M7 10l5 5 5-5" /></> },
  drum: { s: 22, sw: 1.6, d: <><ellipse cx="12" cy="7" rx="8" ry="3" /><path d="M4 7v8c0 1.7 3.6 3 8 3s8-1.3 8-3V7" /></> },
  alert: { s: 22, sw: 1.6, d: <><path d="M12 3l9 16H3L12 3z" /><path d="M12 10v4M12 17.5v.5" /></> },
  info: { s: 15, d: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></> },
  sun: { s: 16, d: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></> },
  moon: { s: 16, d: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /> },
  'brand-light': {
    s: 26,
    sw: 0,
    viewBox: '0 0 65.968002 65.967995',
    d: (
      <g transform="translate(-124.23218,-92.627653)">
        <rect width="65.967995" height="65.967995" x="124.23218" y="92.627655" rx="9.7943735" ry="9.7943735" fill="#21201c" />
        <path d="m 182.15298,112.64841 a 12.963143,12.963143 0 0 0 -10.98279,6.07715 c 0.97472,2.09798 1.51981,4.43134 1.51981,6.88536 0,2.45434 -0.54487,4.78822 -1.51981,6.88641 a 12.963143,12.963143 0 0 0 10.98279,6.07766 12.963143,12.963143 0 0 0 8.04706,-2.79983 v -20.32692 a 12.963143,12.963143 0 0 0 -8.04706,-2.79983 z" fill="#2e7cc2" />
        <circle cx="156.22691" cy="125.61166" r="12.963143" fill="#df433b" />
      </g>
    ),
  },
  'brand-dark': {
    s: 26,
    sw: 0,
    viewBox: '0 0 65.967995 65.968002',
    d: (
      <g transform="translate(-44.108626,-92.137771)">
        <rect width="65.967995" height="65.967995" x="44.108627" y="92.137772" rx="9.7943735" ry="9.7943735" fill="#f3f1ec" />
        <path d="m 102.02943,112.15853 a 12.963143,12.963143 0 0 0 -10.982791,6.07715 c 0.974714,2.09798 1.519804,4.43134 1.519804,6.88536 0,2.45434 -0.544862,4.78822 -1.519804,6.88641 a 12.963143,12.963143 0 0 0 10.982791,6.07766 12.963143,12.963143 0 0 0 8.04706,-2.79983 v -20.32692 a 12.963143,12.963143 0 0 0 -8.04706,-2.79983 z" fill="#4d97da" />
        <circle cx="76.103355" cy="125.12177" r="12.963143" fill="#f15a4f" />
      </g>
    ),
  },
};

export function Icon({ name, size, className }: { name: IconName; size?: number; className?: string }) {
  const p = ICONS[name];
  const s = size ?? p.s ?? 16;
  return (
    <svg
      className={className}
      width={s}
      height={s}
      viewBox={p.viewBox ?? '0 0 24 24'}
      fill={p.fill ?? 'none'}
      stroke="currentColor"
      strokeWidth={p.sw ?? 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {p.d}
    </svg>
  );
}

/** Theme-aware Bachi mark. Both source SVG variants live in the icon system. */
export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <span className="tk-brand-mark" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="brand-light" size={size} className="tk-brand-mark-light" />
      <Icon name="brand-dark" size={size} className="tk-brand-mark-dark" />
    </span>
  );
}
