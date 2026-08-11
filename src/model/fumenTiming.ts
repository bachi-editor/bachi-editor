import type { Fumen, FumenMeasure } from '../codec';

export const NOMINAL_MEASURE_BEATS = 4;
export const MIN_MEASURE_MS = 1;

export type MeasureTimingSource = 'offset' | 'fallback';

export interface FumenTimingMap {
  /** True measure durations in chart milliseconds. */
  durations: number[];
  /** Cumulative chart time at each measure start. */
  starts: number[];
  /** Per-measure source: offset-derived or BPM fallback. */
  sources: MeasureTimingSource[];
  /** True when the chart's offset column is usable for non-final measures. */
  derived: boolean;
  /** End time of the final measure in chart milliseconds. */
  totalDurationMs: number;
}

export function beatMs(bpm: number): number {
  return 60000 / Math.max(1, bpm);
}

export function fallbackMeasureDurationMs(
  measure: Pick<FumenMeasure, 'bpm'>,
  beats = NOMINAL_MEASURE_BEATS,
): number {
  return beats * beatMs(measure.bpm);
}

function offsetColumnUsable(measures: FumenMeasure[]): boolean {
  const n = measures.length;
  const first = measures[0]?.offset;
  const last = measures[n - 1]?.offset;
  return n > 1 && Number.isFinite(first) && Number.isFinite(last) && (last as number) > (first as number);
}

/**
 * Real per-measure timing in ms.
 *
 * The CHN fumen measure header has no standalone length field. For real charts,
 * duration is encoded by consecutive measure `offset` values, but each stored
 * offset is biased by one nominal four-beat screen at that measure's BPM:
 *
 *   storedOffset[i] = trueStart[i] - 4 * beatMs(bpm[i]) + C
 *
 * Within a constant-BPM run that bias cancels. At a BPM boundary, the raw offset
 * gap must be corrected by the bias delta:
 *
 *   duration[i] = offset[i+1] - offset[i] + 4 * (beatMs(bpm[i+1]) - beatMs(bpm[i]))
 *
 * Degenerate/backwards gaps collapse to a 1 ms sliver so chart time stays
 * monotonic. The final measure has no following boundary, so it falls back to
 * the nominal BPM duration.
 */
export function measureTimings(
  fumen: Pick<Fumen, 'measures'>,
  minBeats = NOMINAL_MEASURE_BEATS,
): FumenTimingMap {
  const { measures } = fumen;
  const usable = offsetColumnUsable(measures);
  const durations = new Array<number>(measures.length);
  const starts = new Array<number>(measures.length);
  const sources = new Array<MeasureTimingSource>(measures.length);
  let cursor = 0;

  for (let i = 0; i < measures.length; i++) {
    starts[i] = cursor;
    if (usable && i < measures.length - 1) {
      const cur = measures[i];
      const next = measures[i + 1];
      const delta =
        next.offset - cur.offset +
        NOMINAL_MEASURE_BEATS * (beatMs(next.bpm) - beatMs(cur.bpm));
      durations[i] = Number.isFinite(delta) && delta > MIN_MEASURE_MS ? delta : MIN_MEASURE_MS;
      sources[i] = 'offset';
    } else {
      durations[i] = fallbackMeasureDurationMs(measures[i], minBeats);
      sources[i] = 'fallback';
    }
    cursor += durations[i];
  }

  return { durations, starts, sources, derived: usable, totalDurationMs: cursor };
}

export function measureDurations(measures: FumenMeasure[], minBeats = NOMINAL_MEASURE_BEATS): number[] {
  return measureTimings({ measures }, minBeats).durations;
}

export function measureDurationAt(
  fumen: Pick<Fumen, 'measures'>,
  measureIndex: number,
  minBeats = NOMINAL_MEASURE_BEATS,
): number {
  const measure = fumen.measures[measureIndex];
  if (!measure) return 0;
  return measureTimings(fumen, minBeats).durations[measureIndex] ?? fallbackMeasureDurationMs(measure, minBeats);
}

/**
 * Inverse of `measureTimings`' offset model (Phase 12.2): given each measure's
 * true duration (ms), its BPM, and the chart's anchor offset (the stored
 * `offset[0]`, which is the chart/audio offset), produce the stored `offset`
 * column that re-derives to those durations.
 *
 * Rearranging the bias-corrected forward formula
 *   duration[i] = offset[i+1] - offset[i] + 4*(beatMs(bpm[i+1]) - beatMs(bpm[i]))
 * gives the recurrence
 *   offset[i+1] = offset[i] + duration[i] - 4*(beatMs(bpm[i+1]) - beatMs(bpm[i]))
 *
 * The final duration is unused — the last measure has no following boundary. The
 * round-trip holds: `measureTimings(synthesizeOffsets(d, bpms, a)).durations`
 * equals `d` for every non-final measure. Edit transforms use this so callers
 * never hand-edit raw biased offsets.
 */
export function synthesizeOffsets(durations: number[], bpms: number[], anchorOffset: number): number[] {
  const n = durations.length;
  const offsets = new Array<number>(n);
  if (n === 0) return offsets;
  offsets[0] = anchorOffset;
  for (let i = 1; i < n; i++) {
    offsets[i] =
      offsets[i - 1] + durations[i - 1] -
      NOMINAL_MEASURE_BEATS * (beatMs(bpms[i]) - beatMs(bpms[i - 1]));
  }
  return offsets;
}

/**
 * Audio time (ms) of the chart's first downbeat. The first measure's stored
 * offset is the scroll-appearance time, one nominal four-beat screen ahead of
 * judgment, so the playable downbeat is offset[0] + 4*beatMs(bpm[0]).
 */
export function chartIntroDelayMs(fumen: Pick<Fumen, 'measures'>): number {
  const first = fumen.measures[0];
  if (!first) return 0;
  const offset = Number.isFinite(first.offset) ? first.offset : 0;
  return offset + NOMINAL_MEASURE_BEATS * beatMs(first.bpm);
}
