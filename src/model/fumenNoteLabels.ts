import type { Fumen, FumenNote } from '../codec';
import { measureTimings } from './fumenTiming';

export type FumenBranchIndex = 0 | 1 | 2;

const SMALL_DON_TYPES = new Set([0x1, 0x2, 0x3]);
const SMALL_KA_TYPES = new Set([0x4, 0x5]);
const BIG_HIT_TYPES = new Set([0x7, 0x8, 0xb, 0xd]);
const MIN_RECOGNIZED_NOTE_TYPE = 0x1;
const MAX_RECOGNIZED_NOTE_TYPE = 0xd;
const MISSING_DISTANCE = 1_000_000_000;
const DISTANCE_EQUALITY_EPSILON = 0.025;

interface NoteLabelEvent {
  note: FumenNote;
  unit: number;
  scroll: number;
  order: number;
}

/**
 * Corpus-derived timing coordinate for small-note label variants.
 *
 * One unit is a sixteenth note. For a note in measure m:
 *
 *   u = sum(k < m, duration[k] * bpm[k] / 15000)
 *       + positionMs * bpm[m] / 15000
 *
 * The visual distance from the current note i to another event j follows
 * TJAPlayer3's convention and uses the other event's scroll speed:
 *
 *   d(i, j) = round3(abs(u[j] - u[i]) * abs(scroll[j]))
 *
 * Exact rhythmic comparisons allow 0.025 units of float slack. This cleaned
 * TJAPlayer3 V2 rule set (without its low-BPM exceptions) matched 95.79% of
 * deduplicated CHN chart-track label ids and 95.95% on held-out songs. A direct
 * implementation check over all 15,075 physical files scored 95.83%.
 */
function branchLabelEvents(fumen: Fumen, branchIndex: FumenBranchIndex): NoteLabelEvent[] {
  const timing = measureTimings(fumen);
  const events: NoteLabelEvent[] = [];
  let unitStart = 0;
  let order = 0;

  for (let measureIndex = 0; measureIndex < fumen.measures.length; measureIndex++) {
    const measure = fumen.measures[measureIndex];
    const bpm = Number.isFinite(measure.bpm) && measure.bpm > 0 ? measure.bpm : 120;
    const branch = measure.branches[branchIndex];
    for (const note of branch.notes) {
      if (note.type >= MIN_RECOGNIZED_NOTE_TYPE && note.type <= MAX_RECOGNIZED_NOTE_TYPE) {
        const position = Number.isFinite(note.position) ? note.position : 0;
        events.push({
          note,
          unit: unitStart + position * bpm / 15000,
          scroll: Number.isFinite(branch.speed) ? branch.speed : 1,
          order: order++,
        });
      }
    }
    unitStart += timing.durations[measureIndex] * bpm / 15000;
  }

  events.sort((a, b) => a.unit - b.unit || a.order - b.order);
  return events;
}

function isSmallDon(event: NoteLabelEvent | undefined): boolean {
  return event !== undefined && SMALL_DON_TYPES.has(event.note.type);
}

function isSmallKa(event: NoteLabelEvent | undefined): boolean {
  return event !== undefined && SMALL_KA_TYPES.has(event.note.type);
}

function isBigHit(event: NoteLabelEvent | undefined): boolean {
  return event !== undefined && BIG_HIT_TYPES.has(event.note.type);
}

function eventAt(events: NoteLabelEvent[], index: number, offset: number): NoteLabelEvent | undefined {
  return events[index + offset];
}

function visualDistance(events: NoteLabelEvent[], index: number, offset: number): number {
  const current = events[index];
  const other = eventAt(events, index, offset);
  if (!current || !other) return MISSING_DISTANCE;
  const raw = Math.abs(other.unit - current.unit) * Math.abs(other.scroll);
  return Math.round(raw * 1000) / 1000;
}

function distanceEquals(value: number, target: number): boolean {
  return Math.abs(value - target) <= DISTANCE_EQUALITY_EPSILON;
}

function usesTerminalLabel(events: NoteLabelEvent[], index: number): boolean {
  const previous = visualDistance(events, index, -1);
  const next = visualDistance(events, index, 1);
  const nextNext = visualDistance(events, index, 2);
  return next > 2
    || (next >= 1.4 && previous <= 1.4)
    || (next >= 2 && nextNext <= 3)
    || (next >= 2 && isBigHit(eventAt(events, index, 1)));
}

function setPrediction(
  predictions: Map<FumenNote, number>,
  event: NoteLabelEvent | undefined,
  type: number,
): void {
  if (event) predictions.set(event.note, type);
}

/**
 * Calculate all small-note label ids for one branch track. Big notes and
 * non-hit notes participate as neighboring events but never receive a new id.
 */
export function calculateBranchNoteLabels(
  fumen: Fumen,
  branchIndex: FumenBranchIndex,
): ReadonlyMap<FumenNote, number> {
  const events = branchLabelEvents(fumen, branchIndex);
  const predictions = new Map<FumenNote, number>();
  for (const event of events) {
    if (isSmallDon(event)) predictions.set(event.note, 0x1);
    else if (isSmallKa(event)) predictions.set(event.note, 0x4);
  }

  let docoCount = 0;
  for (let i = 0; i < events.length; i++) {
    const current = events[i];
    if (isSmallDon(current)) {
      const previous = visualDistance(events, i, -1);
      const next = visualDistance(events, i, 1);
      const nextNext = visualDistance(events, i, 2);

      // A separated run of at least four red eighth notes alternates ド / コ,
      // ending in ドン. The state can propagate through an arbitrarily long run.
      if (
        previous > 2
        && distanceEquals(next, 2)
        && isSmallDon(eventAt(events, i, 1))
        && distanceEquals(nextNext, 4)
        && isSmallDon(eventAt(events, i, 2))
        && distanceEquals(visualDistance(events, i, 3), 6)
        && isSmallDon(eventAt(events, i, 3))
      ) {
        predictions.set(current.note, 0x2);
        docoCount = 1;
        continue;
      }
      if (
        docoCount !== 0
        && distanceEquals(previous, 2)
        && distanceEquals(next, 2)
        && isSmallDon(eventAt(events, i, 1))
      ) {
        predictions.set(current.note, docoCount % 2 === 0 ? 0x2 : 0x3);
        docoCount++;
        continue;
      }
      docoCount = 0;

      // Isolated five-note sixteenth figure: ド・コ・ド・コ・ドン.
      if (
        visualDistance(events, i, -3) >= 3.4
        && distanceEquals(visualDistance(events, i, -2), 2)
        && distanceEquals(previous, 1)
        && distanceEquals(next, 1)
        && distanceEquals(nextNext, 2)
        && visualDistance(events, i, 3) >= 3.4
        && isSmallDon(eventAt(events, i, -2))
        && isSmallDon(eventAt(events, i, -1))
        && isSmallDon(eventAt(events, i, 1))
        && isSmallDon(eventAt(events, i, 2))
      ) {
        setPrediction(predictions, eventAt(events, i, -2), 0x2);
        setPrediction(predictions, eventAt(events, i, -1), 0x3);
        predictions.set(current.note, 0x2);
        setPrediction(predictions, eventAt(events, i, 1), 0x3);
        setPrediction(predictions, eventAt(events, i, 2), 0x1);
        i += 2;
        continue;
      }

      // Middle of an isolated three-note sixteenth figure: ド・コ・ドン.
      if (
        visualDistance(events, i, -2) >= 2.4
        && distanceEquals(previous, 1)
        && distanceEquals(next, 1)
        && visualDistance(events, i, 2) >= 2.4
        && isSmallDon(eventAt(events, i, -1))
        && isSmallDon(eventAt(events, i, 1))
      ) {
        predictions.set(current.note, 0x3);
      } else {
        predictions.set(current.note, usesTerminalLabel(events, i) ? 0x1 : 0x2);
      }
    } else if (isSmallKa(current)) {
      docoCount = 0;
      predictions.set(current.note, usesTerminalLabel(events, i) ? 0x4 : 0x5);
    } else {
      docoCount = 0;
    }
  }

  return predictions;
}
