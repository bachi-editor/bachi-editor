// Pure layout: given a decoded Fumen, compute pixel rectangles for each
// measure + note. Separated from rendering so it stays unit-testable.
//
// Conventions:
//   - pxPerMs is the base scale: measure width is purely time-proportional
//     (durationMs * pxPerMs), independent of BPM, so the playhead crosses every
//     measure at the same pixel speed regardless of tempo or high-speed markers.
//   - A measure's width follows its real time span. Long note durations never
//     widen a measure; their bars are split into row-local segments instead.
//   - Rows pack as many measures as fit in the available content width,
//     starting a new row when adding the next measure would overflow, unless
//     measuresPerRow is set to a fixed count.
//   - When the chart is branched, each measure occupies 3 stacked sub-staves
//     (normal / professional / master). For non-branched, one stave.

import type { Fumen, FumenMeasure, FumenNote } from '../../codec';
import { DRUMROLL_NOTE_TYPES } from '../../codec';
import { isBranchPoint } from '../../model/fumenEdits';
import { measureDurations } from '../../model/fumenTiming';
export { chartIntroDelayMs, measureDurations, measureTimings } from '../../model/fumenTiming';

export const SNAP_VALUES = ['1/4', '1/8', '1/12', '1/16', '1/24', '1/32', '1/48'] as const;
export type SnapValue = typeof SNAP_VALUES[number];

export type MeasuresPerRow = 2 | 4 | 'auto';

export function snapDivisions(snap: SnapValue): number {
  return Number(snap.slice(2));
}

export interface LayoutConfig {
  /** Horizontal scale: pixels per millisecond of chart time. */
  pxPerMs: number;
  measureMinBeats: number;
  measuresPerRow: MeasuresPerRow;
  rowGap: number;
  measureGap: number;
  staveHeight: number;
  staveGap: number;
  /**
   * Note glyph scale (1 = default). Independent of both the horizontal `pxPerMs`
   * zoom and the vertical row layout: it grows or shrinks only the note radii /
   * bar heights (see noteHeadRadius/barNoteHeight) and the matching hit target, so
   * notes can be enlarged for clarity without moving the staves, rows or timing
   * tags. The stave lane height, inter-branch gap and tag positions are
   * deliberately fixed, so a large note may visually overflow its lane.
   */
  noteScale: number;
  headerHeight: number;
  paddingX: number;
  paddingY: number;
  rowGutterWidth: number;
  branchTagGutterWidth: number;
  /** Max width available for rows, excluding paddingX*2. Branch tags consume part of this. */
  contentWidth: number;
  /**
   * Build the stacked BPM/HS badges and reserve the vertical space they need.
   * The Sound tab's read-only preview turns this off so the chart shows just
   * notes + authored barlines and the rows pack tight (no empty marker bands).
   */
  showTimingMarkers: boolean;
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  // 0.12 px/ms keeps a 4-beat 120 BPM measure (2000 ms) at its familiar 240 px.
  // The editor view doubles this via a presentation baseline (ScoreCanvas) so the
  // chart reads less dense; tests use this raw reference scale directly.
  pxPerMs: 0.12,
  measureMinBeats: 4,
  measuresPerRow: 4,
  // Vertical metrics doubled from their original (28/36/8/18) to de-densify the
  // sheet: rows are twice as tall and twice as spaced. Barlines and snap lines
  // span the stave, so they grow with staveHeight automatically.
  rowGap: 56,
  measureGap: 0,
  staveHeight: 72,
  staveGap: 16,
  noteScale: 1,
  headerHeight: 36,
  paddingX: 36,
  paddingY: 16,
  rowGutterWidth: 64,
  // Wide enough that the left-biased N/E/M tag clears both the measure-number
  // box and a downbeat note's left overhang with a small gap on either side.
  branchTagGutterWidth: 40,
  contentWidth: 1200,
  showTimingMarkers: true,
};

export interface MeasureLayout {
  index: number;
  measure: FumenMeasure;
  x: number;
  y: number;
  width: number;
  durationMs: number;
  /** Per-branch stave Y offsets (relative to measure row top). */
  staveYs: number[];
  rowIndex: number;
  branchCount: number;
  speedMarkers: SpeedMarker[];
  /**
   * BPM/HS badges anchored to this measure, with their stacking already resolved
   * (level, badge Y and connector geometry). Empty when nothing changes here.
   */
  timingMarkers: TimingMarker[];
}

export interface RowLayout {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  gutterX: number;
  gutterWidth: number;
  firstMeasureIndex: number;
  lastMeasureIndex: number;
  branchCount: number;
}

export interface SpeedMarker {
  /** Undefined means the speed change applies to all rendered branches. */
  branchIndex?: number;
  speed: number;
}

/**
 * A BPM / HS / branch-point badge with its anti-overlap stacking resolved. When
 * several neighbouring badges would collide horizontally they are pushed onto
 * higher stack `level`s — top tags (BPM + branch) upward, HS downward — so each
 * stays legible. The connector (`arrowFromY`) follows the badge, while the
 * arrowhead (`arrowToY`, the stave anchor) stays put. A `branch` marker is a
 * standalone flag with no connector (arrowFromY == arrowToY). Geometry is
 * computed in the layout so the row can reserve the extra vertical space and
 * renders deterministically.
 */
export interface TimingMarker {
  kind: 'bpm' | 'hs' | 'branch';
  /** Badge label, e.g. `♩140` or `»1.5×` (unused for the branch flag). */
  text: string;
  /** Raw value (BPM, or HS speed multiplier). */
  value: number;
  /** Badge left edge (absolute) — the measure's left edge. */
  x: number;
  /** Reserved badge width; render draws exactly this so stacking never overlaps. */
  width: number;
  /** Stack level (0 = baseline, nearest the stave). */
  level: number;
  /** Badge top-left Y (absolute), already shifted for its level. */
  badgeY: number;
  /** Y where the connector leaves the badge — moves up/down with the level. */
  arrowFromY: number;
  /** Y the arrowhead targets (the stave anchor) — fixed regardless of level. */
  arrowToY: number;
  /** HS only: branch the change applies to (undefined = all rendered branches). */
  branchIndex?: number;
  /** Branch flag paired with a BPM tag: the BPM pill's right edge, where the
   *  half-black/half-green join line to this flag begins. Standalone branch flags
   *  (no BPM) leave this undefined and draw a vertical arrow instead. */
  joinFromX?: number;
}

/** Timing badge geometry — shared with scoreRender so overlap math matches drawing. */
export const MARKER_BADGE_HEIGHT = 16;
export const MARKER_CORNER_OVERLAP = 5;
/** Vertical shift applied per stack level. A hair over the badge height so two
 *  stacked badges clear each other with a small visible gap. */
export const MARKER_LEVEL_STEP = MARKER_BADGE_HEIGHT + 2;
/** Min horizontal gap kept between two badges sharing one stack level. */
const MARKER_H_GAP = 4;
/** Per-character advance estimate for the 10px monospace badge font. Deliberately
 *  generous so the reserved slot is never narrower than the drawn glyphs. */
const MARKER_CHAR_PX = 6.5;
const MARKER_TEXT_PADDING = 10;

function estimateBadgeWidth(text: string): number {
  return Math.ceil([...text].length * MARKER_CHAR_PX) + MARKER_TEXT_PADDING;
}

/** Branch-point flag (top tag), drawn in its own flavour colour. */
export const BRANCH_POINT_LABEL = 'branch';
/** Gap between a measure's BPM pill and its branch-point pill when both show — wide
 *  enough for the half-black/half-green join line drawn across it (scoreRender). */
export const TOP_TAG_JOIN_GAP = 7;

function branchPointBadgeWidth(): number {
  return estimateBadgeWidth(BRANCH_POINT_LABEL);
}

export function formatBpm(bpm: number): string {
  if (Number.isInteger(bpm)) return String(bpm);
  return bpm.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function formatSpeed(speed: number): string {
  if (Number.isInteger(speed)) return String(speed);
  return speed.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function bpmTagText(bpm: number): string {
  return `♩${formatBpm(bpm)}`;
}

function hsTagText(speed: number): string {
  return `»${formatSpeed(speed)}×`;
}

/**
 * Greedy interval-partitioning over badges already sorted left-to-right: each
 * badge takes the LOWEST stack level whose previous badge has cleared its x
 * (plus a gap). This naturally collapses a rising staircase back down the moment
 * a lower level frees up, instead of stacking every badge one step higher.
 * Mutates each badge's `level` in place.
 */
function assignStackLevels(badges: { x: number; width: number; level: number }[]): number {
  const levelEndX: number[] = [];
  let maxLevel = 0;
  for (const badge of badges) {
    let level = 0;
    while (level < levelEndX.length && levelEndX[level] > badge.x - MARKER_H_GAP) level++;
    badge.level = level;
    levelEndX[level] = badge.x + badge.width;
    if (level > maxLevel) maxLevel = level;
  }
  return maxLevel;
}

export interface LongNoteSegment {
  /** Absolute X of this visible segment's start. */
  x: number;
  /** Absolute X of this visible segment's end. */
  endX: number;
  /** Absolute Y of the stave centreline for this segment's row. */
  y: number;
  /** Score row containing this segment. */
  rowIndex: number;
  /** True when this segment contains the note head. */
  startsAtHead: boolean;
  /** True when this segment contains the note tail or the chart-visible tail. */
  endsAtTail: boolean;
}

export interface NoteLayout {
  measureIndex: number;
  branchIndex: 0 | 1 | 2;
  noteIndex: number;
  note: FumenNote;
  /** Absolute X of the note centre. */
  x: number;
  /** Absolute Y of the stave centreline for this branch. */
  y: number;
  /** Legacy terminal X for long notes; use segments for row-aware rendering. */
  endX?: number;
  /** Row-local drumroll/balloon bar pieces. Undefined for instantaneous notes. */
  segments?: LongNoteSegment[];
}

export interface ScoreLayout {
  config: LayoutConfig;
  hasBranches: boolean;
  rows: RowLayout[];
  measures: MeasureLayout[];
  /** Cumulative chart time, in ms, at the start of each measure. */
  measureStartMs: number[];
  notes: NoteLayout[];
  /** Note layout indexes that touch each score row, including row-spanning long-note segments. */
  notesByRow: number[][];
  totalHeight: number;
  totalWidth: number;
}

export interface ScoreGridHit {
  measureIndex: number;
  branchIndex: 0 | 1 | 2;
  position: number;
  snappedX: number;
  y: number;
  measureDurationMs: number;
}

export interface ScoreNoteHit {
  measureIndex: number;
  branchIndex: 0 | 1 | 2;
  noteIndex: number;
}

export interface ScoreMeasureHit {
  measureIndex: number;
  /** Set only in branch-focus mode, narrowing the selection to one stave. */
  branchIndex?: 0 | 1 | 2;
}

function isLongNote(type: number): boolean {
  return DRUMROLL_NOTE_TYPES.has(type) || type === 0xa || type === 0xc;
}

/** Floor so a near-zero-duration measure still renders as a clickable sliver. */
const MIN_MEASURE_PX = 3;

/**
 * Fixed horizontal gap reserved to the left of every row's first note, between it
 * and the measure-# gutter. A downbeat note sits at the measure's left edge and
 * overhangs left by its radius; this clearance keeps even a note grown to the
 * maximum note size from sliding over the gutter. Deliberately a fixed value (not
 * scaled with the note size) so the layout never reflows as notes resize.
 */
export const FIRST_NOTE_GUTTER_PAD = 24;

/**
 * Inset from a stave's top/bottom edge to where the snap-line ticks stop — and
 * where the BPM/HS/branch arrow tips land. Shared with scoreRender so a timing
 * tag's arrow points exactly at the snap-line tip on the measure's near edge.
 */
export const STAVE_SNAP_INSET = 4;

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function sameSpeed(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.001;
}

function speedMarkersForMeasure(measure: FumenMeasure, branchCount: number, prevSpeeds: number[]): SpeedMarker[] {
  const speeds = measure.branches.slice(0, branchCount).map((branch) => branch.speed);
  const markers: SpeedMarker[] = [];

  if (branchCount === 1) {
    if (!sameSpeed(speeds[0], prevSpeeds[0])) markers.push({ speed: speeds[0] });
  } else {
    const allSame = speeds.every((speed) => sameSpeed(speed, speeds[0]));
    const prevAllSame = prevSpeeds.slice(0, branchCount).every((speed) => sameSpeed(speed, prevSpeeds[0]));
    if (allSame && (!prevAllSame || !sameSpeed(speeds[0], prevSpeeds[0]))) {
      markers.push({ speed: speeds[0] });
    } else {
      for (let b = 0; b < branchCount; b++) {
        if (!sameSpeed(speeds[b], prevSpeeds[b])) markers.push({ branchIndex: b, speed: speeds[b] });
      }
    }
  }

  for (let b = 0; b < branchCount; b++) prevSpeeds[b] = speeds[b];
  return markers;
}

function branchHasNotes(f: Fumen, idx: 0 | 1 | 2): boolean {
  return f.measures.some((m) => m.branches[idx].notes.length > 0);
}

const TIME_EPSILON = 0.0001;

type LongSegmentLayout = Pick<ScoreLayout, 'rows' | 'measures' | 'measureStartMs'>;

function chartEndTime(layout: LongSegmentLayout): number {
  const lastMeasure = layout.measures[layout.measures.length - 1];
  if (!lastMeasure) return 0;
  return layout.measureStartMs[layout.measures.length - 1] + lastMeasure.durationMs;
}

function rowStartTime(layout: LongSegmentLayout, row: RowLayout): number {
  return layout.measureStartMs[row.firstMeasureIndex] ?? 0;
}

function rowEndTime(layout: LongSegmentLayout, row: RowLayout): number {
  const measure = layout.measures[row.lastMeasureIndex];
  if (!measure) return rowStartTime(layout, row);
  return (layout.measureStartMs[row.lastMeasureIndex] ?? 0) + measure.durationMs;
}

function xForChartTimeInRow(layout: LongSegmentLayout, row: RowLayout, chartTime: number): number {
  for (let i = row.firstMeasureIndex; i <= row.lastMeasureIndex; i++) {
    const measure = layout.measures[i];
    if (!measure) continue;
    const measureStart = layout.measureStartMs[i] ?? 0;
    const measureEnd = measureStart + measure.durationMs;
    if (chartTime <= measureEnd + TIME_EPSILON || i === row.lastMeasureIndex) {
      const ratio = clamp01((chartTime - measureStart) / measure.durationMs);
      return measure.x + ratio * measure.width;
    }
  }

  const lastMeasure = layout.measures[row.lastMeasureIndex];
  return lastMeasure ? lastMeasure.x + lastMeasure.width : 0;
}

export interface PlayheadGeometry {
  /** Absolute X of the playhead line within the score canvas. */
  x: number;
  /** Absolute Y of the playhead line's top (the containing row's top). */
  y: number;
  /** Height the line should span (the row height). */
  height: number;
  /** True when the input time fell outside the chart's [0, end] range. */
  clamped: boolean;
}

/** Total chart time in ms (start of the last measure + its duration). */
export function chartDurationMs(layout: ScoreLayout): number {
  return chartEndTime(layout);
}

/**
 * Locate the vertical playhead for a chart time (ms). The time is clamped into
 * the chart's [0, end] range, so out-of-range audio (intro silence or trailing
 * tail) parks the line at the first/last row edge. Returns undefined for an
 * empty chart.
 */
export function playheadGeometry(layout: ScoreLayout, chartTimeMs: number): PlayheadGeometry | undefined {
  if (layout.rows.length === 0) return undefined;
  const end = chartEndTime(layout);
  const clampedTime = chartTimeMs < 0 ? 0 : chartTimeMs > end ? end : chartTimeMs;
  let row = layout.rows[layout.rows.length - 1];
  for (const r of layout.rows) {
    if (clampedTime <= rowEndTime(layout, r) + TIME_EPSILON) {
      row = r;
      break;
    }
  }
  return {
    x: xForChartTimeInRow(layout, row, clampedTime),
    y: row.y,
    height: row.height,
    clamped: chartTimeMs < 0 || chartTimeMs > end,
  };
}

export function longNoteSegmentsForRange(
  layout: LongSegmentLayout,
  measureIndex: number,
  branchIndex: 0 | 1 | 2,
  position: number,
  duration: number,
): LongNoteSegment[] {
  const startMeasure = layout.measures[measureIndex];
  if (!startMeasure || !Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return [];

  const startTime = (layout.measureStartMs[measureIndex] ?? 0) + position;
  const rawEndTime = startTime + duration;
  const visibleEndTime = Math.min(rawEndTime, chartEndTime(layout));
  if (visibleEndTime <= startTime + TIME_EPSILON) return [];

  const segments: LongNoteSegment[] = [];
  for (const row of layout.rows) {
    const rowStart = rowStartTime(layout, row);
    const rowEnd = rowEndTime(layout, row);
    const segmentStart = Math.max(startTime, rowStart);
    const segmentEnd = Math.min(visibleEndTime, rowEnd);
    if (segmentEnd <= segmentStart + TIME_EPSILON) continue;

    const rowFirstMeasure = layout.measures[row.firstMeasureIndex];
    const y = rowFirstMeasure?.staveYs[branchIndex];
    if (y === undefined) continue;

    segments.push({
      x: xForChartTimeInRow(layout, row, segmentStart),
      endX: xForChartTimeInRow(layout, row, segmentEnd),
      y,
      rowIndex: row.index,
      startsAtHead: segmentStart <= startTime + TIME_EPSILON,
      endsAtTail: segmentEnd >= visibleEndTime - TIME_EPSILON,
    });

    if (segmentEnd >= visibleEndTime - TIME_EPSILON) break;
  }

  return segments;
}

interface RowSpan {
  firstMeasureIndex: number;
  lastMeasureIndex: number;
}

interface PartialMeasure {
  x: number;
  width: number;
  durationMs: number;
  rowIndex: number;
  speedMarkers: SpeedMarker[];
  bpmChanged: boolean;
}

interface PendingTag {
  kind: 'bpm' | 'hs' | 'branch';
  measureIndex: number;
  value: number;
  text: string;
  x: number;
  width: number;
  level: number;
  branchIndex?: number;
  joinFromX?: number;
}

function makeMarker(tag: PendingTag): TimingMarker {
  return {
    kind: tag.kind,
    text: tag.text,
    value: tag.value,
    x: tag.x,
    width: tag.width,
    level: tag.level,
    badgeY: 0,
    arrowFromY: 0,
    arrowToY: 0,
    branchIndex: tag.branchIndex,
    joinFromX: tag.joinFromX,
  };
}

/** Layout a Fumen into measure rects + note positions. */
export function layoutScore(fumen: Fumen, config: Partial<LayoutConfig> = {}): ScoreLayout {
  const cfg = { ...DEFAULT_LAYOUT, ...config };
  // noteScale affects ONLY the drawn note glyphs (radii / bar heights, read via
  // noteHeadRadius/barNoteHeight) and the matching hit target — never the row
  // layout. The stave lane height, inter-branch gap, row height and tag positions
  // all stay fixed as notes resize, so adjusting the note-size slider leaves the
  // surrounding layout put (a very large note may overflow its lane).
  // Branched when the stored header flag is on OR the Expert/Master tracks carry
  // notes — must match model/fumenEdits.ts:fumenIsBranched so flipping the flag
  // (Phase 8.5) immediately renders 3 staves to author a branch on a flat chart.
  const hasBranches =
    fumen.header.hasBranches !== 0 || branchHasNotes(fumen, 1) || branchHasNotes(fumen, 2);
  const branchCount = hasBranches ? 3 : 1;
  // Lane height with no timing-badge spacing inserted — the empty-chart fallback
  // and the floor each row grows from when its per-branch HS badges need room.
  const baseMeasureRowHeight =
    cfg.headerHeight + branchCount * cfg.staveHeight + (branchCount - 1) * cfg.staveGap;

  // The N/E/M tag gutter is a fixed width: note size never reflows the layout, so
  // the tag — and the first measure's left edge — stay put as notes resize. A very
  // large downbeat note may overhang under the tag, an accepted trade-off for a
  // stable layout (matches scoreRender's fixed branch-tag placement).
  const branchTagGutterWidth = hasBranches ? cfg.branchTagGutterWidth : 0;
  // FIRST_NOTE_GUTTER_PAD is fixed empty space between the measure-# gutter and the
  // first note, so a large downbeat note can't slide over the measure number.
  const gutterWidth = cfg.rowGutterWidth + branchTagGutterWidth + FIRST_NOTE_GUTTER_PAD;
  const effectiveContentWidth = Math.max(cfg.contentWidth, gutterWidth + 1);
  const rowStartX = cfg.paddingX + gutterWidth;
  const limitX = cfg.paddingX + effectiveContentWidth;
  const maxMeasureWidth = Math.max(1, effectiveContentWidth - gutterWidth);

  const measureSlotWidth =
    typeof cfg.measuresPerRow === 'number'
      ? Math.max(1, (maxMeasureWidth - cfg.measureGap * (cfg.measuresPerRow - 1)) / cfg.measuresPerRow)
      : undefined;

  const laneTopRel = cfg.headerHeight;
  // Stave centreline Y for branch b (relative to a row's content top), given the
  // per-row extra gaps inserted below each higher stave so its HS badges clear the
  // next stave. With no extras this is the uniform `headerHeight + b*(h+gap) + h/2`.
  const staveCenterRel = (b: number, staveExtra: number[]): number => {
    let c = laneTopRel + cfg.staveHeight / 2;
    for (let k = 0; k < b; k++) c += cfg.staveHeight + cfg.staveGap + (staveExtra[k] ?? 0);
    return c;
  };
  // Lane bottom (= a row's content height) once the inter-stave extras are applied.
  const laneBottomRelFor = (staveExtra: number[]): number =>
    staveCenterRel(branchCount - 1, staveExtra) + cfg.staveHeight / 2;
  // Where an HS badge's top sits (before its level shift), relative to row top: a
  // per-branch badge hangs below its own stave; an all-branch badge below the lane.
  const hsAnchorRel = (branchIndex: number | undefined, staveExtra: number[]): number =>
    branchIndex === undefined
      ? laneBottomRelFor(staveExtra)
      : staveCenterRel(branchIndex, staveExtra) + cfg.staveHeight / 2;

  // --- Pass 1: horizontal layout. x / width / row membership per measure; the
  // BPM + HS change set per measure. Vertical placement is deferred until we know
  // how tall each row must grow to fit its stacked timing badges.
  const partials: PartialMeasure[] = [];
  const rowSpans: RowSpan[] = [];
  const measureStartMs: number[] = [];

  let cursorX = rowStartX;
  let rowIndex = 0;
  let rowMeasureCount = 0;
  let rowFirstMeasureIndex = 0;
  let chartCursorMs = 0;
  const prevSpeeds = [1, 1, 1];

  const durations = measureDurations(fumen.measures, cfg.measureMinBeats);
  for (let i = 0; i < fumen.measures.length; i++) {
    const m = fumen.measures[i];
    const durationMs = durations[i];
    measureStartMs[i] = chartCursorMs;
    // Width is purely time-proportional (ms * pxPerMs), independent of BPM, so the
    // playhead crosses every measure at a constant pixel speed — BPM changes and
    // high-speed markers no longer make it visually speed up or slow down. A 3/4
    // measure is narrower than 4/4 and a 56 ms gimmick measure collapses to a
    // sliver, both for the same reason.
    const naturalWidth = durationMs * cfg.pxPerMs;
    const width = Math.max(MIN_MEASURE_PX, Math.min(naturalWidth, measureSlotWidth ?? maxMeasureWidth));
    const speedMarkers = speedMarkersForMeasure(m, branchCount, prevSpeeds);
    const bpmChanged = i === 0 || m.bpm !== fumen.measures[i - 1]?.bpm;

    const fixedRowFull = typeof cfg.measuresPerRow === 'number' && rowMeasureCount >= cfg.measuresPerRow;
    const autoRowFull = cfg.measuresPerRow === 'auto' && cursorX !== rowStartX && cursorX + width > limitX;
    if (fixedRowFull || autoRowFull) {
      rowSpans.push({ firstMeasureIndex: rowFirstMeasureIndex, lastMeasureIndex: i - 1 });
      cursorX = rowStartX;
      rowIndex++;
      rowMeasureCount = 0;
      rowFirstMeasureIndex = i;
    }

    partials.push({ x: cursorX, width, durationMs, rowIndex, speedMarkers, bpmChanged });
    rowMeasureCount++;
    cursorX += width + cfg.measureGap;
    chartCursorMs += durationMs;
  }
  if (fumen.measures.length > 0) {
    rowSpans.push({ firstMeasureIndex: rowFirstMeasureIndex, lastMeasureIndex: fumen.measures.length - 1 });
  }

  // --- Pass 2: per-row badge stacking + vertical-space reservation. Top tags
  // (BPM + branch-point flag) stack upward in one pool; HS badges stack downward,
  // pooled per anchor (each branch's stave, plus the all-branch lane bottom) so a
  // per-branch change never collides with another branch's column. A per-branch HS
  // stack deeper than the inter-stave gap pushes the staves below it apart
  // (rowStaveExtra); all-branch / last-branch depth pushes the row's bottom down
  // (rowExtraBelow). Stacking is recomputed each row, so a build-up near a row
  // break simply resets on the next row.
  const rowTopTags: PendingTag[][] = rowSpans.map(() => []);
  const rowHsTags: PendingTag[][] = rowSpans.map(() => []);
  const rowExtraAbove: number[] = rowSpans.map(() => 0);
  // Extra gap inserted below stave b — one slot per inter-stave gap (b in 0..count-2).
  const rowStaveExtra: number[][] = rowSpans.map(() => new Array(Math.max(0, branchCount - 1)).fill(0));
  const rowExtraBelow: number[] = rowSpans.map(() => 0);

  for (let r = 0; cfg.showTimingMarkers && r < rowSpans.length; r++) {
    const span = rowSpans[r];

    // Top tags: one stacking unit per measure, concatenating that measure's BPM
    // change and/or branch-point flag side by side so they never stack on each
    // other — only a LATER measure's unit climbs a level when it horizontally
    // overlaps an earlier one (assignStackLevels over the combined unit widths).
    const topUnits: { x: number; width: number; level: number; measureIndex: number; bpm?: number; bpmWidth: number; branch: boolean }[] = [];
    for (let i = span.firstMeasureIndex; i <= span.lastMeasureIndex; i++) {
      const p = partials[i];
      const m = fumen.measures[i];
      const isBranch = hasBranches && isBranchPoint(m);
      if (!p.bpmChanged && !isBranch) continue;
      const bpmWidth = p.bpmChanged ? estimateBadgeWidth(bpmTagText(m.bpm)) : 0;
      const branchWidth = isBranch ? branchPointBadgeWidth() : 0;
      const join = bpmWidth > 0 && branchWidth > 0 ? TOP_TAG_JOIN_GAP : 0;
      topUnits.push({ x: p.x, width: bpmWidth + join + branchWidth, level: 0, measureIndex: i, bpm: p.bpmChanged ? m.bpm : undefined, bpmWidth, branch: isBranch });
    }
    rowExtraAbove[r] = assignStackLevels(topUnits) * MARKER_LEVEL_STEP;
    for (const u of topUnits) {
      if (u.bpm !== undefined) {
        const text = bpmTagText(u.bpm);
        rowTopTags[r].push({ kind: 'bpm', measureIndex: u.measureIndex, value: u.bpm, text, x: u.x, width: u.bpmWidth, level: u.level });
      }
      if (u.branch) {
        const paired = u.bpmWidth > 0;
        const join = paired ? TOP_TAG_JOIN_GAP : 0;
        rowTopTags[r].push({
          kind: 'branch',
          measureIndex: u.measureIndex,
          value: 0,
          text: BRANCH_POINT_LABEL,
          x: u.x + u.bpmWidth + join,
          width: u.width - u.bpmWidth - join,
          level: u.level,
          // Paired with a BPM pill: remember its right edge for the join line.
          joinFromX: paired ? u.x + u.bpmWidth : undefined,
        });
      }
    }

    // HS tags, grouped per anchor and stacked independently.
    const hsTags: PendingTag[] = [];
    for (let i = span.firstMeasureIndex; i <= span.lastMeasureIndex; i++) {
      const p = partials[i];
      for (const sm of p.speedMarkers) {
        const text = hsTagText(sm.speed);
        hsTags.push({ kind: 'hs', measureIndex: i, value: sm.speed, text, x: p.x, width: estimateBadgeWidth(text), level: 0, branchIndex: sm.branchIndex });
      }
    }
    const hsGroups = new Map<number | 'all', PendingTag[]>();
    for (const t of hsTags) {
      const key = t.branchIndex ?? 'all';
      const group = hsGroups.get(key);
      if (group) group.push(t);
      else hsGroups.set(key, [t]);
    }
    // One badge height below the lane is absorbed by the row gap; only a deeper
    // all-branch / last-branch stack pushes the row's bottom down past that.
    let belowLaneDepth = MARKER_BADGE_HEIGHT;
    for (const [key, group] of hsGroups) {
      const depth = assignStackLevels(group) * MARKER_LEVEL_STEP + MARKER_BADGE_HEIGHT;
      if (key === 'all' || key === branchCount - 1) {
        if (depth > belowLaneDepth) belowLaneDepth = depth;
      } else {
        // Per-branch badges hang in the gap below their stave; grow it if they overflow.
        rowStaveExtra[r][key as number] = Math.max(rowStaveExtra[r][key as number], depth - cfg.staveGap);
      }
    }
    rowExtraBelow[r] = belowLaneDepth - MARKER_BADGE_HEIGHT;
    rowHsTags[r] = hsTags;
  }

  // --- Pass 3: vertical placement. Each row's content top drops by its own top-tag
  // stack and is pushed down by the previous row's HS stack; the row's own height
  // grows with any inter-stave gaps its per-branch HS badges required.
  const rowContentHeight: number[] = rowStaveExtra.map((staveExtra) => laneBottomRelFor(staveExtra));
  const rowY: number[] = [];
  let vCursor = cfg.paddingY;
  for (let r = 0; r < rowSpans.length; r++) {
    rowY[r] = vCursor + rowExtraAbove[r];
    vCursor = rowY[r] + rowContentHeight[r] + rowExtraBelow[r] + cfg.rowGap;
  }

  const rows: RowLayout[] = rowSpans.map((span, r) => ({
    index: r,
    x: rowStartX,
    y: rowY[r],
    width: maxMeasureWidth,
    height: rowContentHeight[r],
    gutterX: cfg.paddingX,
    gutterWidth: cfg.rowGutterWidth,
    firstMeasureIndex: span.firstMeasureIndex,
    lastMeasureIndex: span.lastMeasureIndex,
    branchCount,
  }));

  const measures: MeasureLayout[] = partials.map((p, i) => {
    const y = rowY[p.rowIndex];
    const staveExtra = rowStaveExtra[p.rowIndex];
    const staveYs: number[] = [];
    for (let b = 0; b < branchCount; b++) staveYs.push(y + staveCenterRel(b, staveExtra));
    return {
      index: i,
      measure: fumen.measures[i],
      x: p.x,
      y,
      width: p.width,
      durationMs: p.durationMs,
      staveYs,
      rowIndex: p.rowIndex,
      branchCount,
      speedMarkers: p.speedMarkers,
      timingMarkers: [],
    };
  });

  // Resolve each tag's absolute geometry. The arrowhead targets a fixed stave
  // anchor; only the badge and the connector's start move with the stack level.
  for (let r = 0; r < rowSpans.length; r++) {
    const y0 = rowY[r];
    const staveExtra = rowStaveExtra[r];
    // Arrows point at the stave EDGE nearest their badge (the snap-line tip), not
    // the centreline: top tags (above the lane) target the lane's top edge; HS
    // badges (below) target the bottom edge of the stave they apply to.
    const laneBottomAbs = y0 + laneBottomRelFor(staveExtra);
    // Top tags climb upward as their level rises. BPM points down to the normal
    // (first) stave's top edge; a standalone branch flag gets its own arrow to it;
    // a branch flag paired with BPM uses the join line instead (joinFromX, render).
    for (const tag of rowTopTags[r]) {
      const marker = makeMarker(tag);
      marker.badgeY = y0 - tag.level * MARKER_LEVEL_STEP;
      const wantsArrow = tag.kind === 'bpm' || (tag.kind === 'branch' && tag.joinFromX === undefined);
      if (wantsArrow) {
        marker.arrowFromY = marker.badgeY + MARKER_BADGE_HEIGHT - MARKER_CORNER_OVERLAP;
        marker.arrowToY = measures[tag.measureIndex].staveYs[0] - cfg.staveHeight / 2 + STAVE_SNAP_INSET;
      }
      measures[tag.measureIndex].timingMarkers.push(marker);
    }
    for (const tag of rowHsTags[r]) {
      const marker = makeMarker(tag);
      marker.badgeY = y0 + hsAnchorRel(tag.branchIndex, staveExtra) + tag.level * MARKER_LEVEL_STEP;
      marker.arrowFromY = marker.badgeY + MARKER_CORNER_OVERLAP;
      // Per-branch: bottom edge of that branch's stave. All-branch: bottom edge of
      // the whole lane (the bottom stave). Both pulled in by the snap-line inset.
      marker.arrowToY =
        tag.branchIndex === undefined
          ? laneBottomAbs - STAVE_SNAP_INSET
          : measures[tag.measureIndex].staveYs[tag.branchIndex] + cfg.staveHeight / 2 - STAVE_SNAP_INSET;
      measures[tag.measureIndex].timingMarkers.push(marker);
    }
  }

  const notes: NoteLayout[] = [];
  const segmentLayout: LongSegmentLayout = { rows, measures, measureStartMs };
  const notesByRow: number[][] = rows.map(() => []);
  for (let i = 0; i < fumen.measures.length; i++) {
    const m = fumen.measures[i];
    const ml = measures[i];
    if (!ml) continue;
    for (let b = 0; b < branchCount; b++) {
      const branchIndex = b as 0 | 1 | 2;
      const branch = m.branches[branchIndex];
      for (let noteIndex = 0; noteIndex < branch.notes.length; noteIndex++) {
        const note = branch.notes[noteIndex];
        const px = clamp01(note.position / ml.durationMs) * ml.width;
        const x = ml.x + px;
        const y = ml.staveYs[b];
        const nl: NoteLayout = { measureIndex: i, branchIndex, noteIndex, note, x, y };
        if (isLongNote(note.type)) {
          const segments = longNoteSegmentsForRange(segmentLayout, i, branchIndex, note.position, note.duration);
          nl.segments = segments;
          nl.endX = segments[segments.length - 1]?.endX;
        }
        const layoutNoteIndex = notes.push(nl) - 1;
        const rowIndexes = new Set<number>([ml.rowIndex]);
        for (const segment of nl.segments ?? []) rowIndexes.add(segment.rowIndex);
        for (const rowIndex of rowIndexes) notesByRow[rowIndex]?.push(layoutNoteIndex);
      }
    }
  }

  const lastRow = rowSpans.length - 1;
  const totalHeight =
    rowSpans.length === 0
      ? cfg.paddingY + baseMeasureRowHeight + cfg.paddingY
      : rowY[lastRow] + rowContentHeight[lastRow] + rowExtraBelow[lastRow] + cfg.paddingY;
  const totalWidth = effectiveContentWidth + cfg.paddingX * 2;

  return { config: cfg, hasBranches, rows, measures, measureStartMs, notes, notesByRow, totalHeight, totalWidth };
}

// Note geometry at noteScale 1, shared with scoreRender so drawing, hit-testing
// and selection outlines all agree. A note's diameter always clears the stave
// height by the same proportional margin because both scale by noteScale.
const BASE_HEAD_RADIUS = { normal: 7, big: 11 } as const;
const BASE_BAR_HEIGHT = { normal: 14, big: 22 } as const;
const BASE_TARGET_RADIUS = { normal: 12, big: 16 } as const;

/** Radius (px) of a Don/Ka note head, scaled by the vertical note scale. */
export function noteHeadRadius(big: boolean, noteScale: number): number {
  return (big ? BASE_HEAD_RADIUS.big : BASE_HEAD_RADIUS.normal) * noteScale;
}

/** Full height (px) of a drumroll/balloon bar, scaled by the vertical note scale. */
export function barNoteHeight(big: boolean, noteScale: number): number {
  return (big ? BASE_BAR_HEIGHT.big : BASE_BAR_HEIGHT.normal) * noteScale;
}

/** Generous click/selection radius that sits just outside the head, scaled. */
export function noteTargetRadius(big: boolean, noteScale: number): number {
  return (big ? BASE_TARGET_RADIUS.big : BASE_TARGET_RADIUS.normal) * noteScale;
}

// Only the big *circle* note ids get the larger target; big bars (0x9/0xc) keep
// the standard radius, since their hit-test measures distance to the bar centre.
function noteHitRadius(type: number, noteScale: number): number {
  const big = type === 0x7 || type === 0x8 || type === 0xb || type === 0xd;
  return noteTargetRadius(big, noteScale);
}

/**
 * Return the top-most note under a canvas-space point, if any.
 * When `branchFilter` is set, only notes on that branch are considered (branch
 * focus mode) so a click cannot select a note on a dimmed track.
 */
export function hitTestNote(
  layout: ScoreLayout,
  x: number,
  y: number,
  branchFilter?: 0 | 1 | 2,
): ScoreNoteHit | undefined {
  let best: { hit: ScoreNoteHit; distance: number } | undefined;

  for (const note of layout.notes) {
    if (branchFilter !== undefined && note.branchIndex !== branchFilter) continue;
    const radius = noteHitRadius(note.note.type, layout.config.noteScale);
    let distance = note.segments?.length ? Number.POSITIVE_INFINITY : Math.hypot(x - note.x, y - note.y);

    if (note.segments?.length) {
      for (const segment of note.segments) {
        const minX = Math.min(segment.x, segment.endX);
        const maxX = Math.max(segment.x, segment.endX);
        const nearestX = Math.max(minX, Math.min(maxX, x));
        distance = Math.min(distance, Math.hypot(x - nearestX, y - segment.y));
      }
      distance = Math.min(distance, Math.hypot(x - note.x, y - note.y));
    }

    if (distance <= radius && (!best || distance < best.distance)) {
      best = {
        distance,
        hit: {
          measureIndex: note.measureIndex,
          branchIndex: note.branchIndex,
          noteIndex: note.noteIndex,
        },
      };
    }
  }

  return best?.hit;
}

/** Return every note whose head centre falls inside the canvas-space rectangle. */
export function notesInRect(
  layout: ScoreLayout,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  branchFilter?: 0 | 1 | 2,
): ScoreNoteHit[] {
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const hits: ScoreNoteHit[] = [];
  for (const note of layout.notes) {
    if (branchFilter !== undefined && note.branchIndex !== branchFilter) continue;
    if (note.x >= minX && note.x <= maxX && note.y >= minY && note.y <= maxY) {
      hits.push({
        measureIndex: note.measureIndex,
        branchIndex: note.branchIndex,
        noteIndex: note.noteIndex,
      });
    }
  }
  return hits;
}

/**
 * Return the nearest snapped lane position under a canvas-space point, if any.
 * When `branchFilter` is set, only that branch's stave can be hit (branch focus
 * mode) so placement lands on the intended track.
 */
export function hitTestGrid(
  layout: ScoreLayout,
  x: number,
  y: number,
  snap: SnapValue,
  branchFilter?: 0 | 1 | 2,
): ScoreGridHit | undefined {
  const divisions = snapDivisions(snap);
  for (const measure of layout.measures) {
    if (x < measure.x || x > measure.x + measure.width) continue;
    for (let b = 0; b < measure.branchCount; b++) {
      if (branchFilter !== undefined && b !== branchFilter) continue;
      const staveY = measure.staveYs[b];
      const branchTop = staveY - layout.config.staveHeight / 2;
      const branchBottom = staveY + layout.config.staveHeight / 2;
      if (y < branchTop || y > branchBottom) continue;

      const ratio = clamp01((x - measure.x) / measure.width);
      const snappedRatio = Math.round(ratio * divisions) / divisions;
      const position = snappedRatio * measure.durationMs;
      return {
        measureIndex: measure.index,
        branchIndex: b as 0 | 1 | 2,
        position,
        snappedX: measure.x + snappedRatio * measure.width,
        y: staveY,
        measureDurationMs: measure.durationMs,
      };
    }
  }
  return undefined;
}

/**
 * Locate the measure under a canvas-space point (Phase 11 measure selection).
 * A click in a row's gutter selects that row's first measure; a click anywhere
 * in a measure's column (header + staves) selects that measure. In branch-focus
 * mode `branchFilter` is echoed back so the selection narrows to one stave for
 * branch-specific scroll edits. Note hit-testing has priority and runs first in
 * the canvas, so this never steals a note click.
 */
export function hitTestMeasure(
  layout: ScoreLayout,
  x: number,
  y: number,
  branchFilter?: 0 | 1 | 2,
): ScoreMeasureHit | undefined {
  for (const row of layout.rows) {
    if (y < row.y || y > row.y + row.height) continue;
    if (x >= row.gutterX && x <= row.gutterX + row.gutterWidth) {
      return { measureIndex: row.firstMeasureIndex, branchIndex: branchFilter };
    }
  }
  const cfg = layout.config;
  for (const measure of layout.measures) {
    if (x < measure.x || x > measure.x + measure.width) continue;
    const top = measure.y;
    // Lane bottom = the last stave's bottom edge — robust to the per-row extra
    // gaps that per-branch HS badges insert between staves (uniform spacing can't
    // be assumed anymore).
    const bottom = measure.staveYs[measure.branchCount - 1] + cfg.staveHeight / 2;
    if (y < top || y > bottom) continue;
    return { measureIndex: measure.index, branchIndex: branchFilter };
  }
  return undefined;
}
