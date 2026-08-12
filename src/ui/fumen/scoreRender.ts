// Canvas drawing for the score sheet, split into two layers (Phase 9.5):
//
//   - drawStatic:  the heavy, rarely-changing chart — sheet background, row
//                  gutters, measures (gogo tint, barlines, staves, snap grid,
//                  BPM/HS markers, branch tags) and every note. Redrawn only
//                  when the layout / snap / branch-focus changes.
//   - drawOverlay: the lightweight interaction layer — placement ghost, note
//                  selection outlines, the marquee rect, and the measure-
//                  selection box. Redrawn on every pointer move WITHOUT touching
//                  the static layer, so hovering/selecting never repaints notes.
//
// Kept free of React so it stays unit-testable (see test/codec/score-render).
import { FUMEN_NOTE_TYPE_NAMES, type FumenNote } from '../../codec';
import { ChartMeasureRef, ChartNoteRef } from '../../model/fumenEdits';
import {
  barNoteHeight,
  BRANCH_POINT_LABEL,
  longNoteSegmentsForRange,
  MARKER_BADGE_HEIGHT,
  noteHeadRadius,
  noteTargetRadius,
  snapDivisions,
  STAVE_SNAP_INSET,
  type LongNoteSegment,
  type MeasureLayout,
  type NoteLayout,
  type RowLayout,
  type ScoreLayout,
  type SnapValue,
  type TimingMarker,
} from './scoreLayout';

// The score sheet is drawn on <canvas>, so it can't read the CSS theme tokens —
// it carries its own light/dark palettes and swaps the live `COLORS` object by
// theme (see setScoreTheme). The canvas is the one loud surface; everything
// around it stays calm warm paper. selectionFill / marqueeFill are the accent
// tints used for the branch-focus band, measure box and rubber-band marquee.
export interface ScorePalette {
  bg: string;
  gutterBg: string;
  stave: string;
  measureLine: string;
  barlineOff: string;
  beatLine: string;
  snapLine: string;
  gogo: string;
  hsBg: string;
  hsText: string;
  bpmBg: string;
  bpmText: string;
  branchPointBg: string;
  branchPointText: string;
  text: string;
  dim: string;
  don: string;
  donDeep: string;
  ka: string;
  kaDeep: string;
  roll: string;
  rollDeep: string;
  balloon: string;
  balloonDeep: string;
  unknown: string;
  accent: string;
  warningText: string;
  selectionFill: string;
  marqueeFill: string;
}

// Bachi light palette (mirrors styles.css tokens).
export const COLORS_LIGHT: ScorePalette = {
  bg: '#ffffff',         // sheet panel
  gutterBg: '#fbfaf7',
  stave: '#ddd9d1',      // line-2
  measureLine: '#ddd9d1',
  barlineOff: 'rgba(221,217,209,0.42)',
  beatLine: 'rgba(221,217,209,0.36)',
  snapLine: 'rgba(221,217,209,0.26)',
  gogo: 'rgba(238,169,40,0.11)',
  hsBg: '#4b53c4',
  hsText: '#ecebf8',
  bpmBg: '#211f1b',
  bpmText: '#ffffff',
  // Branch-point flag flavour: a distinct teal-green so it reads apart from the
  // near-black BPM pill and the indigo HS badge it may sit beside.
  branchPointBg: '#2f9e6f',
  branchPointText: '#ffffff',
  text: '#211f1b',       // ink
  dim: '#9c968b',        // ink-3
  don: '#df433b',
  donDeep: '#c2362f',
  ka: '#2f7cc2',
  kaDeep: '#2367a4',
  roll: '#eea928',
  rollDeep: '#d28d0e',
  balloon: '#d97817',
  balloonDeep: '#a94f0d',
  unknown: '#bcb6ab',
  accent: '#4b53c4',
  warningText: '#d98f12',
  selectionFill: 'rgba(75,83,196,0.06)',
  marqueeFill: 'rgba(75,83,196,0.10)',
};

// Bachi dark palette (mirrors the dark-mode reference). The sheet sits a touch
// above the canvas backdrop; notes are brightened so they stay loud on it.
export const COLORS_DARK: ScorePalette = {
  bg: '#221f1a',
  gutterBg: '#1c1915',
  stave: '#3b372f',
  measureLine: '#3b372f',
  barlineOff: 'rgba(124,116,103,0.42)',
  beatLine: 'rgba(124,116,103,0.30)',
  snapLine: 'rgba(124,116,103,0.18)',
  gogo: 'rgba(242,180,65,0.10)',
  hsBg: '#8990f2',
  hsText: '#161410',
  bpmBg: '#f3f1ec',
  bpmText: '#161410',
  branchPointBg: '#46b98a',
  branchPointText: '#0f231b',
  text: '#f3f1ec',
  dim: '#918a7d',
  don: '#f15a50',
  donDeep: '#d2463c',
  ka: '#4d97da',
  kaDeep: '#3a7fc0',
  roll: '#f2b441',
  rollDeep: '#d4951a',
  balloon: '#ec8c3a',
  balloonDeep: '#c46c1c',
  unknown: '#685f55',
  accent: '#8990f2',
  warningText: '#e3a63f',
  selectionFill: 'rgba(137,144,242,0.10)',
  marqueeFill: 'rgba(137,144,242,0.16)',
};

export type ScoreTheme = 'light' | 'dark';

// The live palette every draw function reads. It's a mutable binding swapped by
// theme: module-internal `COLORS.x` lookups and any importer both see the swap.
export let COLORS: ScorePalette = COLORS_LIGHT;

/** Point the canvas palette at the light or dark theme. Call before drawing
 *  (ScoreCanvas does this when the app theme changes). */
export function setScoreTheme(theme: ScoreTheme): void {
  COLORS = theme === 'dark' ? COLORS_DARK : COLORS_LIGHT;
}

interface BranchTag { label: string; bg: string; fg: string; }

// Built per-draw from the live palette so the N/E/M flags re-theme with it.
function branchTags(): BranchTag[] {
  return [
    { label: 'N', bg: COLORS.unknown, fg: COLORS.text },
    { label: 'E', bg: COLORS.ka, fg: '#ffffff' },
    { label: 'M', bg: COLORS.don, fg: '#ffffff' },
  ];
}

const BRANCH_TAG_WIDTH = 22;
const BRANCH_TAG_HEIGHT = 18;
// A downbeat note sits at the measure's left edge and overhangs left by its
// radius, so keep the tag's right edge that far clear of the edge — plus a small
// gap — so a default-size note can't paint over the N/E/M label. The offset uses
// the base (noteScale 1) radius against a fixed gutter, so the tag stays put as
// the note-size slider grows notes (see scoreLayout's fixed branchTagGutterWidth).
const BRANCH_TAG_NOTE_GAP = 6;

// Clearance from the arrowhead point to its target. The timing-tag arrows now aim
// at the stave's near edge (the snap-line tip), which carries no note glyphs, so
// only a hair of gap is needed — the old larger gap kept the head clear of notes
// near the centreline the arrows used to point at.
const TIMING_POINTER_GAP = 4;
const TIMING_ARROW_SIZE = 2;
const longNoteCountFont = (noteScale: number) =>
  `700 ${10 * noteScale}px 'JetBrains Mono', ui-monospace, monospace`;

/** A ghost / drag preview of the note a placement tool would drop. */
export interface PlacementPreview {
  measureIndex: number;
  branchIndex: 0 | 1 | 2;
  position: number;
  duration: number;
  type: number;
  scoreInit: number;
  /** When true, draw a "replace existing note here" hint ring (Cmd/Ctrl held). */
  replace?: boolean;
}

/** Live rubber-band marquee rectangle in canvas space. */
export interface MarqueeState {
  pointerId: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Visible chart window, in layout/canvas CSS pixels. */
export interface RenderViewport {
  top: number;
  height: number;
  /** Extra vertical range to include when deciding which rows to draw. */
  overscan?: number;
}

/** Optional Japanese text layer for hit notes. Recommendations are read-only:
 *  a mismatch changes only the text colour and never mutates the chart. */
export interface NoteTextInput {
  recommendations: ReadonlyMap<FumenNote, number>;
}

interface ViewBounds {
  top: number;
  bottom: number;
  viewportTop: number;
  viewportHeight: number;
}

function viewBounds(layout: ScoreLayout, viewport?: RenderViewport): ViewBounds {
  if (!viewport) {
    return { top: 0, bottom: layout.totalHeight, viewportTop: 0, viewportHeight: layout.totalHeight };
  }
  const viewportTop = Math.max(0, Math.min(viewport.top, layout.totalHeight));
  const viewportHeight = Math.max(1, Math.min(viewport.height, Math.max(1, layout.totalHeight - viewportTop)));
  const overscan = viewport.overscan ?? 0;
  return {
    top: Math.max(0, viewportTop - overscan),
    bottom: Math.min(layout.totalHeight, viewportTop + viewportHeight + overscan),
    viewportTop,
    viewportHeight,
  };
}

function intersects(top: number, bottom: number, bounds: ViewBounds): boolean {
  return bottom >= bounds.top && top <= bounds.bottom;
}

function rowIntersects(row: RowLayout, bounds: ViewBounds): boolean {
  return intersects(row.y, row.y + row.height, bounds);
}

function measureIntersects(measure: MeasureLayout, layout: ScoreLayout, bounds: ViewBounds): boolean {
  const cfg = layout.config;
  let top = measure.y;
  // Lane bottom = last stave's bottom edge (per-row inter-stave gaps make uniform
  // spacing wrong); markers below extend it further in the loop next.
  let bottom = measure.staveYs[measure.branchCount - 1] + cfg.staveHeight / 2;
  // Stacked BPM badges climb above the header and HS badges drop below the staves;
  // include them so a measure whose markers reach into the viewport still draws.
  for (const marker of measure.timingMarkers) {
    if (marker.badgeY < top) top = marker.badgeY;
    if (marker.badgeY + MARKER_BADGE_HEIGHT > bottom) bottom = marker.badgeY + MARKER_BADGE_HEIGHT;
  }
  return intersects(top, bottom, bounds);
}

function noteHeadIntersects(note: NoteLayout, radius: number, bounds: ViewBounds): boolean {
  return intersects(note.y - radius, note.y + radius, bounds);
}

function segmentIntersects(segment: LongNoteSegment, height: number, bounds: ViewBounds): boolean {
  return intersects(segment.y - height / 2, segment.y + height / 2, bounds);
}

export function noteRender(
  type: number,
): { color: string; deep: string; big: boolean; shape: 'circle' | 'bar'; headDisc?: boolean } | undefined {
  switch (type) {
    case 0x1: case 0x2: case 0x3: return { color: COLORS.don, deep: COLORS.donDeep, big: false, shape: 'circle' };
    case 0x4: case 0x5: return { color: COLORS.ka, deep: COLORS.kaDeep, big: false, shape: 'circle' };
    // 0xb (DON2) / 0xd (KA2) are "both-players" co-op notes (2P-session): identical
    // big red/blue notes in-game (same kana ドン(大)/カッ(大), same sound) — in 2P
    // mode both players hit them together; solo play replaces them with a normal
    // big note. They render exactly like 0x7/0x8, and are NOT a sound variant,
    // NOT a "both-hands" hard hit, and NOT the purple "kadon".
    case 0x7: case 0xb: return { color: COLORS.don, deep: COLORS.donDeep, big: true, shape: 'circle' };
    case 0x8: case 0xd: return { color: COLORS.ka, deep: COLORS.kaDeep, big: true, shape: 'circle' };
    // Drumrolls read as one uniform bar — no highlighted head (headDisc off).
    case 0x6: return { color: COLORS.roll, deep: COLORS.rollDeep, big: false, shape: 'bar' };
    case 0x9: return { color: COLORS.roll, deep: COLORS.rollDeep, big: true, shape: 'bar' };
    // Balloons highlight the head you keep hitting (deep disc + hit count).
    case 0xa: return { color: COLORS.balloon, deep: COLORS.balloonDeep, big: false, shape: 'bar', headDisc: true };
    case 0xc: return { color: COLORS.balloon, deep: COLORS.balloonDeep, big: true, shape: 'bar', headDisc: true };
    default: return { color: COLORS.unknown, deep: COLORS.unknown, big: false, shape: 'circle' };
  }
}

/** Japanese note text used by the arcade display. Long notes and balloons have
 *  no entry because this optional layer deliberately omits them. */
export function noteTextForType(type: number): string | undefined {
  switch (type) {
    case 0x1: return 'ドン';
    case 0x2: return 'ド';
    case 0x3: return 'コ';
    case 0x4: return 'カッ';
    case 0x5: return 'カ';
    case 0x7: case 0xb: return 'ドン(大)';
    case 0x8: case 0xd: return 'カッ(大)';
    default: return undefined;
  }
}

function drawNoteText(
  ctx: CanvasRenderingContext2D,
  noteLayout: NoteLayout,
  big: boolean,
  noteScale: number,
  input: NoteTextInput,
): void {
  const text = noteTextForType(noteLayout.note.type);
  if (!text) return;
  const recommendation = input.recommendations.get(noteLayout.note);
  const mismatch = recommendation !== undefined && recommendation !== noteLayout.note.type;
  const radius = noteHeadRadius(big, noteScale);
  const fontSize = (big ? 8 : 10) * noteScale;

  ctx.save();
  ctx.fillStyle = mismatch ? COLORS.warningText : COLORS.text;
  ctx.font = `700 ${fontSize}px 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(text, noteLayout.x, noteLayout.y + radius + 2 * noteScale);
  ctx.restore();
}

function fillRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}

function drawBranchTag(ctx: CanvasRenderingContext2D, x: number, y: number, tag: BranchTag) {
  const w = BRANCH_TAG_WIDTH;
  const h = BRANCH_TAG_HEIGHT;
  ctx.save();
  ctx.fillStyle = tag.bg;
  fillRoundedRect(ctx, x - w / 2, y - h / 2, w, h, 6);
  ctx.fillStyle = tag.fg;
  ctx.font = "700 11px 'JetBrains Mono', ui-monospace, monospace";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(tag.label, x, y + 0.5);
  ctx.restore();
}

// The badge width is supplied by the layout (the same value its stacking math
// reserved), so the drawn rectangle can never be wider than its slot — that's
// what keeps stacked badges from overlapping. Text is centred within it.
function drawBadge(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  bg: string,
  fg: string,
) {
  const h = MARKER_BADGE_HEIGHT;
  ctx.save();
  ctx.fillStyle = bg;
  fillRoundedRect(ctx, x, y, width, h, 5);
  ctx.font = "700 10px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + width / 2, y + h / 2 + 0.5);
  ctx.restore();
}

function drawTimingPointer(ctx: CanvasRenderingContext2D, x: number, fromY: number, targetY: number, color: string) {
  const dir = Math.sign(targetY - fromY);
  if (dir === 0) return;
  const arrowY = targetY - dir * TIMING_POINTER_GAP;
  if (Math.abs(arrowY - fromY) < TIMING_ARROW_SIZE) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, fromY);
  ctx.lineTo(x + 0.5, arrowY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, arrowY + dir * TIMING_ARROW_SIZE);
  ctx.lineTo(x - TIMING_ARROW_SIZE, arrowY - dir * TIMING_ARROW_SIZE);
  ctx.lineTo(x + TIMING_ARROW_SIZE, arrowY - dir * TIMING_ARROW_SIZE);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Draw one row-piece of a drumroll/balloon bar as a capsule. The head end
// (`roundedStart`) rounds into a half-height semicircle CENTRED on the note's
// start point — exactly like a balloon's head disc — so the capsule reaches a full
// cap radius to the LEFT of that point rather than starting at it. The tail end
// (`roundedEnd`) rounds off right at the tail point. Interior segments keep both
// ends flat so the pieces of a multi-row roll butt together seamlessly.
//
// Only the tail cap is clamped to the segment's own length, so a stubby roll —
// e.g. butou#'s short drumrolls at large note sizes — keeps its tail inside the
// [start, end] span instead of inverting; the head always extends left by its full
// radius, matching the balloon head.
function drawLongNoteBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  endX: number,
  h: number,
  color: string,
  roundedStart: boolean,
  roundedEnd: boolean,
) {
  const startX = Math.min(x, endX);
  const right = Math.max(x, endX);
  const rStart = roundedStart ? h / 2 : 0;
  // The tail cap can't bulge left of the start point, or the top/bottom edges cross.
  const rEnd = roundedEnd ? Math.min(h / 2, right - startX) : 0;
  // Extend left so the rounded head cap is centred on the start point (startX).
  const left = startX - rStart;
  if (right - left <= 0) return;
  const top = y - h / 2;
  const bottom = y + h / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(left + rStart, top);
  ctx.lineTo(right - rEnd, top);
  ctx.arcTo(right, top, right, bottom, rEnd);
  ctx.arcTo(right, bottom, left, bottom, rEnd);
  ctx.lineTo(left + rStart, bottom);
  ctx.arcTo(left, bottom, left, top, rStart);
  ctx.arcTo(left, top, right, top, rStart);
  ctx.closePath();
  ctx.fill();
}

function longNoteCountText(note: { type: number; scoreInit: number }): string | undefined {
  const hasCount = note.type === 0xa || note.type === 0xc;
  if (!hasCount || !Number.isFinite(note.scoreInit) || note.scoreInit <= 0) return undefined;
  return String(Math.round(note.scoreInit));
}

function drawLongNoteCount(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, h: number, noteScale: number) {
  ctx.save();
  ctx.font = longNoteCountFont(noteScale);
  const capInnerWidth = Math.max(1, h - 2);
  const overflow = Math.max(0, ctx.measureText(text).width - capInnerWidth);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + overflow / 2, y + 0.5);
  ctx.restore();
}

function sameNoteRef(a: ChartNoteRef | undefined, b: ChartNoteRef): boolean {
  return !!a
    && a.measureIndex === b.measureIndex
    && a.branchIndex === b.branchIndex
    && a.noteIndex === b.noteIndex;
}

function drawSelection(
  ctx: CanvasRenderingContext2D,
  nl: { x: number; y: number; segments?: LongNoteSegment[]; note: { type: number } },
  noteScale: number,
) {
  const r = noteRender(nl.note.type);
  // Keep the frame a fixed gap outside the note head instead of scaling the
  // whole target radius: the offset stays at its 100%-size value (the gap
  // measured at noteScale 1) so the dotted box doesn't drift wider as the
  // note-size slider grows the head.
  const big = !!r?.big;
  const gap = noteTargetRadius(big, 1) - noteHeadRadius(big, 1);
  const radius = noteHeadRadius(big, noteScale) + gap;
  ctx.save();
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  if (nl.segments?.length) {
    for (const segment of nl.segments) {
      const padLeft = segment.startsAtHead ? radius : 0;
      const padRight = segment.endsAtTail ? radius : 0;
      const left = Math.min(segment.x, segment.endX) - padLeft;
      const width = Math.abs(segment.endX - segment.x) + padLeft + padRight;
      ctx.strokeRect(left, segment.y - radius, width, radius * 2);
    }
  } else {
    ctx.beginPath();
    ctx.arc(nl.x, nl.y, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Outline the selected measure (Phase 11). A measure-level selection
 * (branchIndex undefined) frames the stave lane — every stave, centred on the
 * centre line; a branch-focused selection frames just that stave for
 * branch-specific edits.
 */
function drawMeasureSelection(ctx: CanvasRenderingContext2D, layout: ScoreLayout, ref: ChartMeasureRef) {
  const measure = layout.measures[ref.measureIndex];
  if (!measure) return;
  const cfg = layout.config;
  let y: number;
  let h: number;
  if (ref.branchIndex !== undefined && ref.branchIndex < measure.branchCount) {
    const sy = measure.staveYs[ref.branchIndex];
    y = sy - cfg.staveHeight / 2 - 3;
    h = cfg.staveHeight + 6;
  } else {
    // Frame the stave lane only (skip the header band): this keeps the box
    // centred on the staves' centre line, so neither edge reaches the BPM
    // badges above the header nor the HS badges below the staves.
    y = measure.y + cfg.headerHeight + 1;
    h = measure.branchCount * cfg.staveHeight + (measure.branchCount - 1) * cfg.staveGap - 2;
  }
  const x = measure.x + 1;
  const w = Math.max(1, measure.width - 2);
  ctx.save();
  ctx.fillStyle = COLORS.selectionFill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.restore();
}

function drawBranchPointBadge(ctx: CanvasRenderingContext2D, marker: TimingMarker) {
  drawBadge(
    ctx,
    BRANCH_POINT_LABEL,
    marker.x,
    marker.badgeY,
    marker.width,
    COLORS.branchPointBg,
    COLORS.branchPointText,
  );
}

/** The half-black/half-green segment joining a measure's BPM pill to its branch
 *  flag — black at the BPM end, green at the branch end — so the two read as one. */
function drawTagJoin(ctx: CanvasRenderingContext2D, fromX: number, toX: number, y: number) {
  const midX = (fromX + toX) / 2;
  ctx.save();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.strokeStyle = COLORS.bpmBg;
  ctx.moveTo(fromX, y);
  ctx.lineTo(midX, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = COLORS.branchPointBg;
  ctx.moveTo(midX, y);
  ctx.lineTo(toX, y);
  ctx.stroke();
  ctx.restore();
}

// Pre-stacked BPM/HS/branch badges paint in two passes (see drawStatic): every
// connector first, then every badge on top. Drawing all connectors before any
// badge keeps a stacked neighbour's arrow line from landing over an adjacent
// badge's text — the badges are always the topmost layer.
function drawTimingConnector(ctx: CanvasRenderingContext2D, marker: TimingMarker) {
  if (marker.kind === 'branch') {
    if (marker.joinFromX !== undefined) {
      // Paired with BPM: the join line stands in for a connector.
      drawTagJoin(ctx, marker.joinFromX, marker.x, marker.badgeY + MARKER_BADGE_HEIGHT / 2);
    } else {
      // Standalone flag: a green arrow down to the normal stave, like BPM's.
      drawTimingPointer(ctx, marker.x, marker.arrowFromY, marker.arrowToY, COLORS.branchPointBg);
    }
    return;
  }
  const bg = marker.kind === 'bpm' ? COLORS.bpmBg : COLORS.hsBg;
  drawTimingPointer(ctx, marker.x, marker.arrowFromY, marker.arrowToY, bg);
}

function drawTimingBadge(ctx: CanvasRenderingContext2D, marker: TimingMarker) {
  if (marker.kind === 'branch') {
    drawBranchPointBadge(ctx, marker);
    return;
  }
  const bg = marker.kind === 'bpm' ? COLORS.bpmBg : COLORS.hsBg;
  const fg = marker.kind === 'bpm' ? COLORS.bpmText : COLORS.hsText;
  drawBadge(ctx, marker.text, marker.x, marker.badgeY, marker.width, bg, fg);
}

/**
 * Measure-number chip at the row's left edge. It brackets the stave lane only —
 * the header band above the staves is badge space, so including it would push the
 * chip's midpoint half a header above the centre line and leave the row reading
 * top-heavy. Framing the lane keeps the chip centred on the (middle) stave's
 * centre line, matching drawMeasureSelection.
 */
function drawRowGutter(ctx: CanvasRenderingContext2D, row: RowLayout, headerHeight: number) {
  const laneTop = row.y + headerHeight;
  const laneHeight = Math.max(1, row.height - headerHeight);
  ctx.save();
  ctx.fillStyle = COLORS.gutterBg;
  fillRoundedRect(ctx, row.gutterX, laneTop, row.gutterWidth - 10, laneHeight, 6);
  ctx.strokeStyle = COLORS.beatLine;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(row.gutterX + row.gutterWidth - 10.5, laneTop + 2);
  ctx.lineTo(row.gutterX + row.gutterWidth - 10.5, laneTop + laneHeight - 2);
  ctx.stroke();

  // Measure number only — no time-signature or start/branch tags.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = "700 11px 'JetBrains Mono', ui-monospace, monospace";
  ctx.fillStyle = COLORS.text;
  ctx.fillText(`M${String(row.firstMeasureIndex + 1).padStart(3, '0')}`, row.gutterX + 10, laneTop + 5);
  ctx.restore();
}

function drawMarquee(ctx: CanvasRenderingContext2D, m: MarqueeState) {
  const x = Math.min(m.x0, m.x1);
  const y = Math.min(m.y0, m.y1);
  const w = Math.abs(m.x1 - m.x0);
  const h = Math.abs(m.y1 - m.y0);
  ctx.save();
  ctx.fillStyle = COLORS.marqueeFill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(x + 0.5, y + 0.5, w, h);
  ctx.restore();
}

/**
 * Draw the static chart layer: sheet background, row gutters, measures (gogo
 * tint, barlines, staves, snap grid, BPM/HS markers, branch tags) and notes.
 * Cheap to call but heavy relative to the overlay, so only re-run when the
 * layout / snap / branch-focus changes — never on a bare pointer move.
 *
 * BPM/HS badges come from `layout` already stacked; the Sound tab's read-only
 * preview suppresses them at layout time (config.showTimingMarkers = false), so
 * here they simply don't exist and the rows stay compact.
 */
export function drawStatic(
  ctx: CanvasRenderingContext2D,
  layout: ScoreLayout,
  dpr: number,
  snap: SnapValue,
  showSnapLines: boolean,
  branchFilter?: 0 | 1 | 2,
  viewport?: RenderViewport,
  noteText?: NoteTextInput,
) {
  const cfg = layout.config;
  const noteScale = cfg.noteScale;
  const snapParts = snapDivisions(snap);
  const bounds = viewBounds(layout, viewport);
  ctx.save();
  ctx.scale(dpr, dpr);
  if (viewport) ctx.translate(0, -bounds.viewportTop);
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, bounds.viewportTop, layout.totalWidth, bounds.viewportHeight);

  const MONO = "11px 'JetBrains Mono', ui-monospace, monospace";
  ctx.font = MONO;
  ctx.textBaseline = 'top';

  const visibleRowIndexes: number[] = [];
  for (const row of layout.rows) {
    if (!rowIntersects(row, bounds)) continue;
    visibleRowIndexes.push(row.index);
    drawRowGutter(ctx, row, cfg.headerHeight);
  }

  // BPM/HS markers from every visible measure, collected so their connectors and
  // badges can paint in two separate passes after the measure loop.
  const visibleMarkers: TimingMarker[] = [];

  for (let mi = 0; mi < layout.measures.length; mi++) {
    const m = layout.measures[mi];
    if (!measureIntersects(m, layout, bounds)) continue;
    const laneTop = m.y + cfg.headerHeight;
    // Last stave's bottom edge — honours any per-row inter-stave gaps inserted to
    // clear per-branch HS badges, instead of assuming uniform stave spacing.
    const laneBottom = m.staveYs[m.branchCount - 1] + cfg.staveHeight / 2;
    // gogo background tint
    if (m.measure.gogo) {
      ctx.fillStyle = COLORS.gogo;
      ctx.fillRect(m.x, laneTop - 2, m.width, laneBottom - laneTop + 4);
    }
    // measure left line
    if (m.measure.barline || showSnapLines) {
      ctx.strokeStyle = m.measure.barline ? COLORS.measureLine : COLORS.barlineOff;
      ctx.lineWidth = m.measure.barline ? 1.5 : 1;
      if (!m.measure.barline) ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(m.x + 0.5, laneTop);
      ctx.lineTo(m.x + 0.5, laneBottom);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (showSnapLines) {
      ctx.strokeStyle = COLORS.barlineOff;
      ctx.beginPath();
      ctx.moveTo(m.x + m.width + 0.5, laneTop);
      ctx.lineTo(m.x + m.width + 0.5, laneBottom);
      ctx.stroke();
    }

    // staves
    for (let b = 0; b < m.branchCount; b++) {
      const y = m.staveYs[b];
      // Branch focus: tint the band of the track being edited.
      if (branchFilter !== undefined && b === branchFilter) {
        ctx.fillStyle = COLORS.selectionFill;
        ctx.fillRect(m.x, y - cfg.staveHeight / 2, m.width, cfg.staveHeight);
      }
      ctx.strokeStyle = COLORS.stave;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(m.x, y);
      ctx.lineTo(m.x + m.width, y);
      ctx.stroke();
      if (showSnapLines) {
        // snap grid overlay; beat ticks get a stronger hairline.
        const beatEvery = Math.max(1, snapParts / cfg.measureMinBeats);
        for (let part = 1; part < snapParts; part++) {
          const bx = m.x + (part / snapParts) * m.width;
          const isBeat = Math.abs(part % beatEvery) < 0.001;
          ctx.strokeStyle = isBeat ? COLORS.beatLine : COLORS.snapLine;
          ctx.lineWidth = isBeat ? 1 : 0.75;
          ctx.beginPath();
          ctx.moveTo(bx + 0.5, y - cfg.staveHeight / 2 + STAVE_SNAP_INSET);
          ctx.lineTo(bx + 0.5, y + cfg.staveHeight / 2 - STAVE_SNAP_INSET);
          ctx.stroke();
        }
      }
    }

    // BPM/HS badges, pre-stacked in the layout so neighbours never overlap.
    // Empty in preview mode (config.showTimingMarkers = false). Collected here
    // and drawn below so every connector paints under every badge.
    for (const marker of m.timingMarkers) visibleMarkers.push(marker);

    if (layout.hasBranches && (mi === 0 || layout.measures[mi - 1].rowIndex !== m.rowIndex)) {
      // Seat the tag at a fixed offset from the measure's left edge (base note
      // size), so the N/E/M label never moves as the note-size slider grows the
      // notes. A very large downbeat note may overhang under it — accepted so the
      // layout stays put (matches the fixed gutter in scoreLayout).
      const tagX = m.x - (noteTargetRadius(true, 1) + BRANCH_TAG_NOTE_GAP) - BRANCH_TAG_WIDTH / 2;
      const tags = branchTags();
      for (let b = 0; b < m.branchCount; b++) {
        drawBranchTag(ctx, tagX, m.staveYs[b], tags[b]);
      }
    }
  }

  // Two-pass timing markers: all connectors first, then all badges on top, so a
  // stacked neighbour's arrow line can never obstruct an adjacent badge's text.
  for (const marker of visibleMarkers) drawTimingConnector(ctx, marker);
  for (const marker of visibleMarkers) drawTimingBadge(ctx, marker);

  // notes — drawn back-to-front (last note first) so earlier notes paint on top
  // of later ones, matching the arcade's note layering.
  const noteIndexes = viewport
    ? Array.from(new Set(visibleRowIndexes.flatMap((rowIndex) => layout.notesByRow[rowIndex] ?? []))).sort((a, b) => b - a)
    : layout.notes.map((_, i) => i).reverse();
  for (const i of noteIndexes) {
    const nl = layout.notes[i];
    const r = noteRender(nl.note.type);
    if (!r) continue;
    // Branch focus: fade notes on the tracks that aren't being edited.
    ctx.globalAlpha = branchFilter !== undefined && nl.branchIndex !== branchFilter ? 0.16 : 1;
    if (r.shape === 'bar') {
      const h = barNoteHeight(r.big, noteScale);
      const visibleSegments = (nl.segments ?? []).filter((segment) => segmentIntersects(segment, h, bounds));
      const headVisible = noteHeadIntersects(nl, h / 2, bounds);
      if (!visibleSegments.length && !headVisible) continue;
      for (const segment of visibleSegments) {
        drawLongNoteBar(ctx, segment.x, segment.y, segment.endX, h, r.color, segment.startsAtHead, segment.endsAtTail);
      }
      // Balloon head: a deep disc stamped with the hit count. Drumrolls stay
      // one uniform colour — the bar's own rounded head is all the cap they get.
      if (headVisible && r.headDisc) {
        ctx.fillStyle = r.deep;
        ctx.beginPath();
        ctx.arc(nl.x, nl.y, h / 2, 0, Math.PI * 2);
        ctx.fill();
        const countText = longNoteCountText(nl.note);
        if (countText) drawLongNoteCount(ctx, countText, nl.x, nl.y, h, noteScale);
      }
    } else {
      const radius = noteHeadRadius(r.big, noteScale);
      const text = noteText ? noteTextForType(nl.note.type) : undefined;
      const cullRadius = text ? radius + 14 * noteScale : radius + 2;
      if (!noteHeadIntersects(nl, cullRadius, bounds)) continue;
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.arc(nl.x, nl.y, radius, 0, Math.PI * 2);
      ctx.fill();
      if (r.big) {
        // big notes get a sheet-coloured gap ring + deep outline, matching the
        // swatch (whose inner ring is var(--panel)). Using the sheet colour
        // keeps it white in light mode but dark in dark mode, so the ring reads
        // as a gap in the sheet rather than a stray white band.
        ctx.strokeStyle = COLORS.bg;
        ctx.lineWidth = 2.5 * noteScale;
        ctx.stroke();
        ctx.strokeStyle = r.deep;
        ctx.lineWidth = 1.5 * noteScale;
        ctx.beginPath();
        ctx.arc(nl.x, nl.y, radius + 1.8 * noteScale, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeStyle = r.deep;
        ctx.lineWidth = 1.5 * noteScale;
        ctx.stroke();
      }
      // Special/unknown note types (e.g. the wii5op medley's 0x0e–0x19) have no
      // named glyph — stamp the hex id on them so they're visible and tellable
      // apart instead of rendering as anonymous muted dots.
      if (!FUMEN_NOTE_TYPE_NAMES[nl.note.type]) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${8 * noteScale}px 'JetBrains Mono', ui-monospace, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(nl.note.type.toString(16), nl.x, nl.y + 0.5);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
      }
      if (noteText && text) drawNoteText(ctx, nl, r.big, noteScale, noteText);
    }
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

export interface OverlayInput {
  selectedNote?: ChartNoteRef;
  selectedNotes?: ChartNoteRef[];
  selectedMeasure?: ChartMeasureRef;
  preview?: PlacementPreview;
  marquee?: MarqueeState;
}

function drawPlacementPreview(ctx: CanvasRenderingContext2D, layout: ScoreLayout, preview: PlacementPreview) {
  const measure = layout.measures[preview.measureIndex];
  const y = measure?.staveYs[preview.branchIndex];
  const r = noteRender(preview.type);
  if (!measure || y === undefined || !r) return;
  const noteScale = layout.config.noteScale;
  const x = measure.x + (preview.position / measure.durationMs) * measure.width;
  ctx.save();
  ctx.globalAlpha = 0.5;
  let headRadius: number;
  if (r.shape === 'bar') {
    const h = barNoteHeight(r.big, noteScale);
    headRadius = h / 2;
    const segments = longNoteSegmentsForRange(
      layout,
      preview.measureIndex,
      preview.branchIndex,
      preview.position,
      preview.duration,
    );
    for (const segment of segments) {
      drawLongNoteBar(ctx, segment.x, segment.y, segment.endX, h, r.color, segment.startsAtHead, segment.endsAtTail);
    }
    if (r.headDisc) {
      ctx.fillStyle = r.deep;
      ctx.beginPath();
      ctx.arc(x, y, h / 2, 0, Math.PI * 2);
      ctx.fill();
      const countText = longNoteCountText(preview);
      if (countText) drawLongNoteCount(ctx, countText, x, y, h, noteScale);
    }
  } else {
    const radius = noteHeadRadius(r.big, noteScale);
    headRadius = radius;
    ctx.fillStyle = r.color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = r.deep;
    ctx.lineWidth = 1.5 * noteScale;
    ctx.stroke();
  }
  ctx.restore();
  // "Replace note at this slot" hint: a solid accent ring around the ghost head.
  if (preview.replace) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = COLORS.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, headRadius + 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Draw the interaction overlay: placement ghost, selection outlines, the
 * marquee rect and the event-selection box. Clears its own (transparent)
 * canvas first, so it can be redrawn on every pointer move without disturbing
 * the static chart layer beneath it.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  layout: ScoreLayout,
  dpr: number,
  input: OverlayInput,
  viewport?: RenderViewport,
) {
  const { selectedNote, selectedNotes, selectedMeasure, preview, marquee } = input;
  const bounds = viewBounds(layout, viewport);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, Math.ceil(layout.totalWidth * dpr), Math.ceil(bounds.viewportHeight * dpr));
  ctx.restore();

  ctx.save();
  ctx.scale(dpr, dpr);
  if (viewport) ctx.translate(0, -bounds.viewportTop);

  if (preview) drawPlacementPreview(ctx, layout, preview);

  const noteScale = layout.config.noteScale;
  if (selectedNotes) {
    for (const ref of selectedNotes) {
      const nl = layout.notes.find((n) => sameNoteRef(ref, n));
      if (nl) drawSelection(ctx, nl, noteScale);
    }
  }
  const selectedLayout = selectedNote
    ? layout.notes.find((nl) => sameNoteRef(selectedNote, nl))
    : undefined;
  if (selectedLayout) drawSelection(ctx, selectedLayout, noteScale);
  if (selectedMeasure) drawMeasureSelection(ctx, layout, selectedMeasure);
  if (marquee) drawMarquee(ctx, marquee);

  ctx.restore();
}
