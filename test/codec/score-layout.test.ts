import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeFumen, makeFumenHeader, openEnvelope, type Fumen, type FumenMeasure, type FumenNote } from '../../src/codec';
import { FUMEN_KEY_HEX } from '../helpers/keys';
import {
  barNoteHeight,
  chartDurationMs,
  chartIntroDelayMs,
  FIRST_NOTE_GUTTER_PAD,
  hitTestGrid,
  hitTestMeasure,
  hitTestNote,
  layoutScore,
  measureTimings,
  noteHeadRadius,
  noteTargetRadius,
  notesInRect,
  playheadGeometry,
  STAVE_SNAP_INSET,
} from '../../src/ui/fumen/scoreLayout';
import { HAS_CORPUS } from '../helpers/resources';

const FIXTURE = path.resolve(
  __dirname,
  '../../../resources/TaikoCHN/Data/x64/fumen/10binz/10binz_m.bin',
);
const SWEEP1_URA_FIXTURE = path.resolve(
  __dirname,
  '../../../resources/TaikoCHN/Data/x64/fumen/sweep1/sweep1_x.bin',
);
// doncam: extreme gimmick chart, 286 measures most far shorter than 4 beats.
const DONCAM_FIXTURE = path.resolve(
  __dirname,
  '../../../resources/TaikoCHN/Data/x64/fumen/doncam/doncam_m.bin',
);
// butou6: 4/4 body with a 1-beat pickup measure 0 and a 281 ms intro offset.
const BUTOU6_FIXTURE = path.resolve(
  __dirname,
  '../../../resources/TaikoCHN/Data/x64/fumen/butou6/butou6_m.bin',
);
// cls10: opens at 160 BPM with a 537 ms offset.
const CLS10_FIXTURE = path.resolve(
  __dirname,
  '../../../resources/TaikoCHN/Data/x64/fumen/cls10/cls10_m.bin',
);

function makeNote(type: number, position = 0, duration = 0, scoreInit = 0): FumenNote {
  return { type, position, item: 0, padding: 0, scoreInit, scoreDiff: 0, duration };
}

function makeMeasure(branchNotes: [FumenNote[], FumenNote[], FumenNote[]] = [[], [], []]): FumenMeasure {
  return {
    bpm: 120,
    offset: 0,
    gogo: 0,
    barline: 1,
    padding1: 0,
    branchInfo: [0, 0, 0, 0, 0, 0],
    padding2: 0,
    branches: [
      { padding: 0, speed: 1, notes: branchNotes[0] },
      { padding: 0, speed: 1, notes: branchNotes[1] },
      { padding: 0, speed: 1, notes: branchNotes[2] },
    ],
  };
}

function makeMeasureAt(offset: number, bpm = 120, branchNotes: [FumenNote[], FumenNote[], FumenNote[]] = [[], [], []]): FumenMeasure {
  return { ...makeMeasure(branchNotes), offset, bpm };
}

function makeFumen(measures: FumenMeasure[]): Fumen {
  return {
    header: makeFumenHeader({ measureCount: measures.length }),
    measures,
    trailer: new Uint8Array(),
  };
}

describe('layoutScore', () => {
  it.skipIf(!HAS_CORPUS)('produces positive-area rectangles for every measure and assigns notes to a stave', async () => {
    const bytes = new Uint8Array(fs.readFileSync(FIXTURE));
    const { payload } = await openEnvelope(bytes, FUMEN_KEY_HEX);
    const fumen = decodeFumen(payload);

    const layout = layoutScore(fumen, { contentWidth: 1200 });

    expect(layout.measures.length).toBe(fumen.measures.length);
    for (const m of layout.measures) {
      expect(m.width).toBeGreaterThan(0);
      expect(m.durationMs).toBeGreaterThan(0);
      expect(m.staveYs.length).toBe(m.branchCount);
    }

    // Every note must land in (or at the edge of) some measure's x range.
    for (const n of layout.notes) {
      const m = layout.measures[n.measureIndex];
      expect(n.x).toBeGreaterThanOrEqual(m.x - 0.5);
      expect(n.x).toBeLessThanOrEqual(m.x + m.width + 0.5);
    }

    expect(layout.totalHeight).toBeGreaterThan(0);
    expect(layout.totalWidth).toBeGreaterThan(0);
  });

  it('derives real measure durations and widths from consecutive measure offsets', () => {
    // bpm 120 => one beat is 500 ms. The offsets describe a 3-beat, 3-beat and
    // 2-beat measure; the final measure has no following offset so it falls back
    // to four beats at its BPM.
    const layout = layoutScore(
      makeFumen([makeMeasureAt(0), makeMeasureAt(1500), makeMeasureAt(3000), makeMeasureAt(4000)]),
      { contentWidth: 2000, measuresPerRow: 'auto' },
    );

    expect(layout.measures.map((m) => m.durationMs)).toEqual([1500, 1500, 1000, 2000]);
    expect(layout.measureStartMs).toEqual([0, 1500, 3000, 4000]);
    // Width is time-proportional (durationMs * pxPerMs), independent of BPM.
    const px = layout.config.pxPerMs;
    expect(layout.measures.map((m) => m.width)).toEqual([1500 * px, 1500 * px, 1000 * px, 2000 * px]);
  });

  it('collapses backwards/instant offset gaps instead of ballooning them to four beats', () => {
    // A zero-length gimmick measure (same offset) and a backwards "rewind" gap
    // must not each expand into a full four-beat block.
    const layout = layoutScore(
      makeFumen([makeMeasureAt(0), makeMeasureAt(0), makeMeasureAt(2000), makeMeasureAt(1000)]),
      { contentWidth: 2000, measuresPerRow: 'auto' },
    );

    expect(layout.measures[0].durationMs).toBe(1); // collapsed gap, not 2000
    expect(layout.measures[2].durationMs).toBe(1); // backwards gap, clamped
    expect(layout.measureStartMs).toEqual([0, 1, 2001, 2002]);
  });

  it('falls back to four-beat bpm timing when the offset column is unusable', () => {
    // Synthetic fumens leave every offset at 0; timing must come from the BPM.
    const layout = layoutScore(makeFumen([makeMeasure(), makeMeasure(), makeMeasure()]), {
      contentWidth: 1200,
    });
    expect(layout.measures.map((m) => m.durationMs)).toEqual([2000, 2000, 2000]);
    expect(layout.measureStartMs).toEqual([0, 2000, 4000]);
  });

  it.skipIf(!HAS_CORPUS)('lays out doncam gimmick measures at their real sub-four-beat width', async () => {
    const bytes = new Uint8Array(fs.readFileSync(DONCAM_FIXTURE));
    const { payload } = await openEnvelope(bytes, FUMEN_KEY_HEX);
    const fumen = decodeFumen(payload);

    const layout = layoutScore(fumen, { contentWidth: 1200, measuresPerRow: 'auto' });

    // The old layout assumed 4 beats per measure; the real chart is far shorter.
    const fourBeatTotal = fumen.measures.reduce((s, m) => s + 4 * (60000 / Math.max(1, m.bpm)), 0);
    expect(chartDurationMs(layout)).toBeLessThan(fourBeatTotal * 0.6);

    // Early measures alternate ~0.25 and ~0.75 beats, so widths vary and the
    // narrowest is nowhere near the old uniform four-beat (240px) block.
    const widths = layout.measures.slice(0, 8).map((m) => Math.round(m.width));
    expect(new Set(widths).size).toBeGreaterThan(1);
    expect(Math.min(...widths)).toBeLessThan(60);
  });

  it.skipIf(!HAS_CORPUS)('aligns butou6 measure starts to the real audio offsets', async () => {
    const bytes = new Uint8Array(fs.readFileSync(BUTOU6_FIXTURE));
    const { payload } = await openEnvelope(bytes, FUMEN_KEY_HEX);
    const fumen = decodeFumen(payload);

    const layout = layoutScore(fumen, { contentWidth: 1200, measuresPerRow: 'auto' });
    const offset0 = fumen.measures[0].offset;

    // butou6's body is clean 4/4, so each measure start equals its real offset
    // relative to the chart's intro delay.
    for (const i of [1, 2, 5, 10]) {
      expect(layout.measureStartMs[i]).toBeCloseTo(fumen.measures[i].offset - offset0, 1);
    }
    // Measure 0 is a one-beat pickup, not the old four-beat block.
    expect(layout.measures[0].durationMs).toBeCloseTo(fumen.measures[1].offset - offset0, 1);
  });

  it('undoes the BPM-change offset bias so boundary gaps land on real beats', () => {
    // measure 0 @120 (beat 500 ms), measure 1 @240 (beat 250 ms). The stored
    // offset of the post-change measure is biased by +1000 ms (= 4*(500-250)),
    // so the raw gap reads 3000 ms (6 beats) but the true measure is 4 beats.
    const layout = layoutScore(
      makeFumen([makeMeasureAt(0, 120), makeMeasureAt(3000, 240), makeMeasureAt(3500, 240)]),
      { contentWidth: 2000, measuresPerRow: 'auto' },
    );
    expect(layout.measures[0].durationMs).toBe(2000); // 4 beats @120, not raw 3000
    expect(layout.measures[1].durationMs).toBe(500); // no BPM change -> raw gap kept
    expect(layout.measureStartMs).toEqual([0, 2000, 2500]);
  });

  it.skipIf(!HAS_CORPUS)('restores doncam BPM-change note gaps to their true 1/8 and 1/2 spacing', async () => {
    const bytes = new Uint8Array(fs.readFileSync(DONCAM_FIXTURE));
    const { payload } = await openEnvelope(bytes, FUMEN_KEY_HEX);
    const fumen = decodeFumen(payload);

    const layout = layoutScore(fumen, { contentWidth: 1200, measuresPerRow: 'auto' });

    // M31 (120 BPM, lone Ka at +250 ms = beat 0.5) -> M32 (270 BPM) downbeat Ka.
    // The two must sit a real 1/8 note (125 ms @120) apart, not the raw ~1.2 s.
    const m31Ka = layout.measureStartMs[31] + 250;
    expect(layout.measureStartMs[32] - m31Ka).toBeCloseTo(125, 0);

    // M120 (120 BPM, four 1/4 notes, last at +1500 ms = beat 3) -> M121 (270 BPM)
    // downbeat: a real 1/2 note (500 ms @120) later, not the raw ~1.6 s.
    const m120Ka = layout.measureStartMs[120] + 1500;
    expect(layout.measureStartMs[121] - m120Ka).toBeCloseTo(500, 0);
  });

  it('keeps very long balloons within laid-out measures while preserving measure scale', () => {
    const balloon = makeNote(0xa, 0, 60000, 999);
    const layout = layoutScore(makeFumen([makeMeasure([[balloon], [], []]), makeMeasure()]), { contentWidth: 320 });
    const [longMeasure, normalMeasure] = layout.measures;
    const note = layout.notes[0];
    const tail = note.segments?.at(-1);

    expect(longMeasure.durationMs).toBe(normalMeasure.durationMs);
    expect(longMeasure.width).toBe(normalMeasure.width);
    expect(tail?.endX).toBeGreaterThan(longMeasure.x + longMeasure.width);
    expect(tail?.endX).toBeLessThanOrEqual(normalMeasure.x + normalMeasure.width + 0.5);
    expect(layout.totalWidth).toBeLessThanOrEqual(layout.config.contentWidth + layout.config.paddingX * 2);
  });

  it('wraps and caps very long drumrolls instead of widening the page', () => {
    const drumroll = makeNote(0x6, 0, 60000);
    const layout = layoutScore(makeFumen([makeMeasure(), makeMeasure([[drumroll], [], []])]), {
      contentWidth: 320,
      measuresPerRow: 'auto',
    });
    const measure = layout.measures[1];
    const note = layout.notes[0];
    const tail = note.segments?.at(-1);

    expect(measure.rowIndex).toBe(1);
    expect(measure.width).toBeLessThanOrEqual(layout.config.contentWidth);
    expect(tail?.endX).toBeLessThanOrEqual(measure.x + measure.width + 0.5);
    expect(tail?.endsAtTail).toBe(true);
    expect(layout.totalWidth).toBeLessThanOrEqual(layout.config.contentWidth + layout.config.paddingX * 2);
  });

  it('splits a long note into row-local visual segments', () => {
    const roll = makeNote(0x6, 1000, 5000);
    const layout = layoutScore(
      makeFumen([makeMeasure(), makeMeasure([[roll], [], []]), makeMeasure(), makeMeasure()]),
      { contentWidth: 960, measuresPerRow: 2 },
    );
    const note = layout.notes[0];
    const firstTailMeasure = layout.measures[1];
    const nextRowFirstMeasure = layout.measures[2];
    const nextRowLastMeasure = layout.measures[3];

    expect(note.segments).toHaveLength(2);
    expect(note.segments?.[0]).toMatchObject({ rowIndex: 0, startsAtHead: true, endsAtTail: false });
    expect(note.segments?.[0].x).toBeCloseTo(firstTailMeasure.x + firstTailMeasure.width / 2);
    expect(note.segments?.[0].endX).toBeCloseTo(firstTailMeasure.x + firstTailMeasure.width);
    expect(note.segments?.[1]).toMatchObject({ rowIndex: 1, startsAtHead: false, endsAtTail: true });
    expect(note.segments?.[1].x).toBeCloseTo(nextRowFirstMeasure.x);
    expect(note.segments?.[1].endX).toBeCloseTo(nextRowLastMeasure.x + nextRowLastMeasure.width);
    expect(note.segments?.[1].y).toBe(nextRowFirstMeasure.staveYs[0]);
  });

  it('hit-tests a long-note continuation segment on a later row', () => {
    const roll = makeNote(0x6, 1000, 5000);
    const layout = layoutScore(
      makeFumen([makeMeasure(), makeMeasure([[roll], [], []]), makeMeasure(), makeMeasure()]),
      { contentWidth: 960, measuresPerRow: 2 },
    );
    const continuation = layout.notes[0].segments?.[1];
    expect(continuation).toBeDefined();

    const hit = hitTestNote(
      layout,
      (continuation!.x + continuation!.endX) / 2,
      continuation!.y,
    );

    expect(hit).toEqual({ measureIndex: 1, branchIndex: 0, noteIndex: 0 });
  });

  it('keeps same-BPM measure widths consistent even when a long note is present', () => {
    const drumroll = makeNote(0x6, 0, 60000);
    const layout = layoutScore(makeFumen([makeMeasure(), makeMeasure([[drumroll], [], []]), makeMeasure()]), {
      contentWidth: 960,
    });
    const widths = layout.measures.map((measure) => measure.width);

    expect(widths).toEqual([widths[0], widths[0], widths[0]]);
  });

  it('reserves row-start gutter space for branch tags', () => {
    const expertNote = makeNote(0x1);
    const layout = layoutScore(makeFumen([makeMeasure([[], [expertNote], []])]), { contentWidth: 480 });
    const measure = layout.measures[0];

    expect(layout.hasBranches).toBe(true);
    expect(measure.x).toBe(
      layout.config.paddingX + layout.config.rowGutterWidth + layout.config.branchTagGutterWidth + FIRST_NOTE_GUTTER_PAD,
    );
    expect(layout.notes[0].branchIndex).toBe(1);
    expect(layout.notes[0].x).toBe(measure.x);
  });

  it('left-aligns partial rows without requiring them to fill the right sheet margin', () => {
    const layout = layoutScore(makeFumen([makeMeasure(), makeMeasure()]), { contentWidth: 520 });
    const first = layout.measures[0];
    const last = layout.measures[1];

    expect(first.x).toBe(layout.config.paddingX + layout.config.rowGutterWidth + FIRST_NOTE_GUTTER_PAD);
    expect(last.x + last.width).toBeLessThan(layout.totalWidth - layout.config.paddingX);
  });

  it('tracks score rows with first measure and gutter bounds', () => {
    const branchNote = makeNote(0x1);
    const layout = layoutScore(
      makeFumen([
        makeMeasure(),
        makeMeasure(),
        makeMeasure([[], [branchNote], []]),
        makeMeasure(),
        makeMeasure(),
      ]),
      { contentWidth: 960, measuresPerRow: 2 },
    );

    expect(layout.rows.map((row) => [row.firstMeasureIndex, row.lastMeasureIndex])).toEqual([
      [0, 1],
      [2, 3],
      [4, 4],
    ]);
    expect(layout.rows[0].gutterX).toBe(layout.config.paddingX);
    expect(layout.rows[0].gutterWidth).toBe(layout.config.rowGutterWidth);
  });

  it.skipIf(!HAS_CORPUS)('marks HS changes in Rotter Tarmination Ura', async () => {
    const bytes = new Uint8Array(fs.readFileSync(SWEEP1_URA_FIXTURE));
    const { payload } = await openEnvelope(bytes, FUMEN_KEY_HEX);
    const fumen = decodeFumen(payload);

    const layout = layoutScore(fumen, { contentWidth: 1200 });

    expect(layout.measures[68].speedMarkers.map((marker) => marker.speed)).toEqual([0.5]);
    expect(layout.measures[83].speedMarkers.map((marker) => marker.speed)).toEqual([2]);
    expect(layout.measures[90].speedMarkers.map((marker) => marker.speed)).toEqual([4]);
  });

  it('hit-tests notes and snapped grid positions', () => {
    const note = makeNote(0x1, 500);
    const layout = layoutScore(makeFumen([makeMeasure([[note], [], []])]), { contentWidth: 480 });
    const noteLayout = layout.notes[0];
    const measure = layout.measures[0];

    expect(hitTestNote(layout, noteLayout.x, noteLayout.y)).toEqual({
      measureIndex: 0,
      branchIndex: 0,
      noteIndex: 0,
    });

    const grid = hitTestGrid(layout, measure.x + measure.width * 0.49, measure.staveYs[0], '1/4');
    expect(grid?.measureIndex).toBe(0);
    expect(grid?.branchIndex).toBe(0);
    expect(grid?.position).toBeCloseTo(measure.durationMs / 2);
  });

  it('selects every note whose head centre falls inside a marquee rect', () => {
    const layout = layoutScore(
      makeFumen([makeMeasure([[makeNote(0x1, 0), makeNote(0x4, 1000), makeNote(0x1, 2000)], [], []])]),
      { contentWidth: 480 },
    );
    const [a, b, c] = layout.notes;

    // Rect tight around the first two heads only.
    const minX = Math.min(a.x, b.x) - 2;
    const maxX = Math.max(a.x, b.x) + 2;
    const hits = notesInRect(layout, minX, a.y - 5, maxX, a.y + 5);
    expect(hits.map((h) => h.noteIndex).sort()).toEqual([0, 1]);

    // Dragging the rect bottom-up (reversed coords) finds the same notes.
    const reversed = notesInRect(layout, maxX, a.y + 5, minX, a.y - 5);
    expect(reversed.map((h) => h.noteIndex).sort()).toEqual([0, 1]);

    // A rect past the last note picks it up; an empty patch returns nothing.
    expect(notesInRect(layout, c.x - 2, c.y - 5, c.x + 2, c.y + 5).map((h) => h.noteIndex)).toEqual([2]);
    expect(notesInRect(layout, 0, 0, 1, 1)).toEqual([]);
  });
});

describe('timing marker stacking', () => {
  // Constant BPM (no offset bias) with an HS change every measure, packed so the
  // narrow measures force the badges to collide and stack.
  function speedZigzag(count: number, gapMs: number): Fumen {
    const measures: FumenMeasure[] = [];
    for (let i = 0; i < count; i++) {
      const m = makeMeasureAt(i * gapMs, 120);
      const speed = i % 2 === 0 ? 2 : 1;
      m.branches[0].speed = speed;
      m.branches[1].speed = speed;
      m.branches[2].speed = speed;
      measures.push(m);
    }
    return makeFumen(measures);
  }

  function markersOfKind(layout: ReturnType<typeof layoutScore>, kind: 'bpm' | 'hs') {
    return layout.measures.flatMap((m) => m.timingMarkers.filter((t) => t.kind === kind));
  }

  it('never overlaps two badges that share a row, kind, anchor and level', () => {
    // 24 narrow (150 ms) measures land on a single wide row.
    const layout = layoutScore(speedZigzag(24, 100), { contentWidth: 4000, measuresPerRow: 'auto' });
    expect(layout.rows.length).toBe(1);

    const groups = new Map<string, { x: number; width: number }[]>();
    for (const m of layout.measures) {
      for (const t of m.timingMarkers) {
        const key = `${m.rowIndex}:${t.kind}:${t.branchIndex ?? 'all'}:${t.level}`;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(t);
      }
    }
    for (const tags of groups.values()) {
      tags.sort((a, b) => a.x - b.x);
      for (let i = 1; i < tags.length; i++) {
        expect(tags[i].x).toBeGreaterThanOrEqual(tags[i - 1].x + tags[i - 1].width);
      }
    }
  });

  it('stacks onto higher levels then reuses lower ones instead of an endless staircase', () => {
    const layout = layoutScore(speedZigzag(24, 100), { contentWidth: 4000, measuresPerRow: 'auto' });
    const hs = markersOfKind(layout, 'hs');
    const maxLevel = Math.max(...hs.map((t) => t.level));
    // Crowding forces multi-level stacking…
    expect(maxLevel).toBeGreaterThanOrEqual(2);
    // …yet level 0 is reused many times (a pure staircase would use it once).
    expect(hs.filter((t) => t.level === 0).length).toBeGreaterThan(1);
  });

  it('shifts the badge + connector start per level but keeps the arrowhead anchored', () => {
    const layout = layoutScore(speedZigzag(24, 100), { contentWidth: 4000, measuresPerRow: 'auto' });
    const hs = markersOfKind(layout, 'hs');
    const anchor = hs[0].arrowToY;
    // All HS markers in this single-row, all-branch chart target the same stave.
    for (const t of hs) expect(t.arrowToY).toBeCloseTo(anchor, 5);
    // HS badges drop DOWN as the level rises; the connector start follows them.
    const l0 = hs.find((t) => t.level === 0)!;
    const l1 = hs.find((t) => t.level === 1)!;
    const l2 = hs.find((t) => t.level === 2)!;
    expect(l1.badgeY).toBeGreaterThan(l0.badgeY);
    expect(l2.badgeY).toBeGreaterThan(l1.badgeY);
    expect(l1.arrowFromY).toBeGreaterThan(l0.arrowFromY);
  });

  it('BPM badges climb UP as their level rises', () => {
    // Alternating BPM every measure; constant 200 ms gaps keep them packed.
    const measures: FumenMeasure[] = [];
    for (let i = 0; i < 16; i++) measures.push(makeMeasureAt(i * 200, i % 2 === 0 ? 140 : 180));
    const layout = layoutScore(makeFumen(measures), { contentWidth: 4000, measuresPerRow: 'auto' });
    const bpm = markersOfKind(layout, 'bpm');
    const l0 = bpm.find((t) => t.level === 0)!;
    const l1 = bpm.find((t) => t.level === 1)!;
    expect(l1.badgeY).toBeLessThan(l0.badgeY);
    // The arrowhead still points at the same stave centreline.
    expect(l1.arrowToY).toBeCloseTo(l0.arrowToY, 5);
  });

  it('grows a crowded row so its stacked badges never intrude on the next row', () => {
    // Small content width => several narrow measures per row across many rows.
    const layout = layoutScore(speedZigzag(60, 100), { contentWidth: 220, measuresPerRow: 'auto' });
    expect(layout.rows.length).toBeGreaterThan(2);

    const badgeBottom = (rowIndex: number) => {
      let bottom = layout.rows[rowIndex].y + layout.rows[rowIndex].height;
      for (const m of layout.measures) {
        if (m.rowIndex !== rowIndex) continue;
        for (const t of m.timingMarkers) bottom = Math.max(bottom, t.badgeY + 16);
      }
      return bottom;
    };
    const badgeTop = (rowIndex: number) => {
      let top = layout.rows[rowIndex].y;
      for (const m of layout.measures) {
        if (m.rowIndex !== rowIndex) continue;
        for (const t of m.timingMarkers) top = Math.min(top, t.badgeY);
      }
      return top;
    };

    for (let r = 0; r + 1 < layout.rows.length; r++) {
      expect(badgeBottom(r)).toBeLessThanOrEqual(badgeTop(r + 1));
    }
    // The last row's stacked badges fit inside the reported canvas height.
    expect(badgeBottom(layout.rows.length - 1)).toBeLessThanOrEqual(layout.totalHeight);
  });

  it('preview mode drops the badges and packs the rows tighter', () => {
    const config = { contentWidth: 220, measuresPerRow: 'auto' as const };
    const stacked = layoutScore(speedZigzag(60, 100), config);
    const preview = layoutScore(speedZigzag(60, 100), { ...config, showTimingMarkers: false });

    expect(preview.measures.every((m) => m.timingMarkers.length === 0)).toBe(true);
    // Same row breaks, but no reserved marker bands => a shorter canvas.
    expect(preview.rows.length).toBe(stacked.rows.length);
    expect(preview.totalHeight).toBeLessThan(stacked.totalHeight);
    // Speed markers are still derived (read-only callers may inspect them).
    expect(stacked.measures.some((m) => m.speedMarkers.length > 0)).toBe(true);
    expect(preview.measures.some((m) => m.speedMarkers.length > 0)).toBe(true);
  });
});

describe('branch-tag gutter is fixed regardless of note size', () => {
  it('keeps the first measure in place as notes grow', () => {
    // Branched (expert note) so the N/E/M gutter is reserved.
    const chart = makeFumen([makeMeasure([[], [makeNote(0x1)], []])]);
    const base = layoutScore(chart, { contentWidth: 1200 });
    const big = layoutScore(chart, { contentWidth: 1200, noteScale: 2 });
    // Note size never reflows the layout: the gutter — and hence the first
    // measure's left edge — stays put.
    expect(big.measures[0].x).toBe(base.measures[0].x);
  });
});

describe('per-branch scroll-speed badges reserve inter-stave space', () => {
  // A branched chart whose NORMAL branch (0) changes speed every other measure,
  // while Expert/Master hold steady — so each change emits a per-branch HS badge
  // that hangs in the gap below stave 0.
  function normalBranchZigzag(count: number, gapMs: number) {
    const measures: FumenMeasure[] = [];
    for (let i = 0; i < count; i++) {
      const m = makeMeasureAt(i * gapMs, 120);
      m.branches[1].notes.push(makeNote(0x1)); // force a branched chart
      m.branches[0].speed = i % 2 === 0 ? 2 : 1;
      m.branches[1].speed = 1;
      m.branches[2].speed = 1;
      measures.push(m);
    }
    return makeFumen(measures);
  }

  const gap01 = (layout: ReturnType<typeof layoutScore>) =>
    layout.measures[0].staveYs[1] - layout.measures[0].staveYs[0];

  it('pushes the staves apart when a per-branch badge stack overflows the inter-stave gap', () => {
    const steady = layoutScore(makeFumen([makeMeasure([[], [makeNote(0x1)], []]), makeMeasure([[], [makeNote(0x1)], []])]), { contentWidth: 4000 });
    // A single per-branch badge now fits within the (roomier) inter-stave gap; a
    // dense, stacking run of them is what overflows it and pushes the staves apart.
    const changing = layoutScore(normalBranchZigzag(8, 100), { contentWidth: 4000, measuresPerRow: 'auto' });
    expect(gap01(changing)).toBeGreaterThan(gap01(steady));
  });

  it('grows the gap further when the badges stack', () => {
    // Wide measures: badges never collide → no stacking.
    const sparse = layoutScore(normalBranchZigzag(8, 2000), { contentWidth: 4000, measuresPerRow: 'auto' });
    // Tiny measures on one row: consecutive badges overlap and stack.
    const dense = layoutScore(normalBranchZigzag(8, 100), { contentWidth: 4000, measuresPerRow: 'auto' });
    expect(gap01(dense)).toBeGreaterThan(gap01(sparse));
  });
});

describe('branch-point flag', () => {
  it('flags a branched measure that carries branch thresholds, side by side with BPM', () => {
    const branchPt = makeMeasure([[], [makeNote(0x1)], []]);
    branchPt.branchInfo = [1, 2, 1, 2, 1, 2];
    const plain = makeMeasure([[], [makeNote(0x1)], []]);
    plain.branchInfo = [-1, -1, -1, -1, -1, -1];
    const layout = layoutScore(makeFumen([branchPt, plain]), { contentWidth: 1200 });

    const onBranch = layout.measures[0].timingMarkers.filter((t) => t.kind === 'branch');
    expect(onBranch.length).toBe(1);
    expect(layout.measures[1].timingMarkers.some((t) => t.kind === 'branch')).toBe(false);

    // Measure 0 also changes BPM (it's the first measure): the two pills share a
    // level/row and concatenate horizontally rather than stacking.
    const bpm = layout.measures[0].timingMarkers.find((t) => t.kind === 'bpm')!;
    expect(onBranch[0].badgeY).toBe(bpm.badgeY);
    expect(onBranch[0].x).toBeGreaterThanOrEqual(bpm.x + bpm.width);
    // Paired with BPM: the flag has no vertical arrow — instead a join line runs
    // from the BPM pill's right edge across to it.
    expect(onBranch[0].arrowFromY).toBe(onBranch[0].arrowToY);
    expect(onBranch[0].joinFromX).toBeCloseTo(bpm.x + bpm.width, 5);
  });

  it('gives a standalone branch flag (no BPM change) its own arrow to the normal stave', () => {
    const m0 = makeMeasure([[], [makeNote(0x1)], []]);
    m0.branchInfo = [-1, -1, -1, -1, -1, -1]; // not a branch point, bpm 120
    const m1 = makeMeasure([[], [makeNote(0x1)], []]);
    m1.branchInfo = [1, 2, 1, 2, 1, 2]; // branch point, bpm 120 (no change → no BPM pill)
    const layout = layoutScore(makeFumen([m0, m1]), { contentWidth: 1200 });

    const branch = layout.measures[1].timingMarkers.find((t) => t.kind === 'branch')!;
    expect(layout.measures[1].timingMarkers.some((t) => t.kind === 'bpm')).toBe(false);
    expect(branch.joinFromX).toBeUndefined();
    // A standalone branch flag (a top tag) points to the normal stave's top edge
    // (the snap-line tip), not its centreline.
    expect(branch.arrowToY).toBeCloseTo(
      layout.measures[1].staveYs[0] - layout.config.staveHeight / 2 + STAVE_SNAP_INSET,
      5,
    );
    expect(branch.arrowFromY).not.toBe(branch.arrowToY);
  });

  it('does not flag a branch point on a non-branched chart', () => {
    const m = makeMeasure();
    m.branchInfo = [1, 2, 1, 2, 1, 2];
    const layout = layoutScore(makeFumen([m]), { contentWidth: 1200 });
    expect(layout.hasBranches).toBe(false);
    expect(layout.measures[0].timingMarkers.some((t) => t.kind === 'branch')).toBe(false);
  });
});

describe('hitTestMeasure (Phase 11 measure selection)', () => {
  // 8 measures @120 BPM, 2000 ms each; fixed 4/row -> 2 rows.
  const flat = layoutScore(makeFumen(Array.from({ length: 8 }, () => makeMeasure())), {
    contentWidth: 1200,
    measuresPerRow: 4,
  });

  it('selects a measure from a click anywhere in its column', () => {
    const m = flat.measures[2];
    expect(hitTestMeasure(flat, m.x + m.width / 2, m.staveYs[0])).toEqual({ measureIndex: 2, branchIndex: undefined });
  });

  it("selects a row's first measure from a click in the gutter", () => {
    const row = flat.rows[1];
    const hit = hitTestMeasure(flat, row.gutterX + row.gutterWidth / 2, row.y + row.height / 2);
    expect(hit?.measureIndex).toBe(row.firstMeasureIndex);
  });

  it('returns undefined for a click outside every measure and gutter', () => {
    expect(hitTestMeasure(flat, 0, 0)).toBeUndefined();
  });

  it('narrows the selection to the focused branch in branch-focus mode', () => {
    const branched = layoutScore(
      makeFumen([
        makeMeasure([[], [makeNote(0x1, 0)], []]),
        makeMeasure([[], [makeNote(0x1, 0)], []]),
      ]),
      { contentWidth: 1200 },
    );
    expect(branched.hasBranches).toBe(true);
    const m = branched.measures[0];
    expect(hitTestMeasure(branched, m.x + 5, m.staveYs[1], 1)).toEqual({ measureIndex: 0, branchIndex: 1 });
  });
});

describe('measureTimings', () => {
  it('derives per-measure durations + cumulative starts from the offset column', () => {
    const t = measureTimings(makeFumen([makeMeasureAt(0), makeMeasureAt(1500), makeMeasureAt(3000)]));
    expect(t.derived).toBe(true);
    expect(t.durations[0]).toBeCloseTo(1500);
    expect(t.durations[1]).toBeCloseTo(1500);
    expect(t.starts).toEqual([0, t.durations[0], t.durations[0] + t.durations[1]]);
  });

  it('falls back to four beats when the offset column is unusable', () => {
    const t = measureTimings(makeFumen([makeMeasure(), makeMeasure()]));
    expect(t.derived).toBe(false);
    expect(t.durations[0]).toBeCloseTo(2000); // 120 BPM, 4 beats
  });
});

describe('playheadGeometry', () => {
  // 8 measures @ 120 BPM, 4 beats each = 2000 ms/measure; fixed 4/row -> 2 rows.
  const layout = layoutScore(makeFumen(Array.from({ length: 8 }, () => makeMeasure())), {
    contentWidth: 1200,
    measuresPerRow: 4,
  });

  it('reports the full chart duration', () => {
    expect(chartDurationMs(layout)).toBeCloseTo(16000, 3);
    expect(layout.rows.length).toBe(2);
  });

  it('locates t=0 at the first row start', () => {
    const geo = playheadGeometry(layout, 0)!;
    expect(geo.clamped).toBe(false);
    expect(geo.y).toBe(layout.rows[0].y);
    expect(geo.height).toBe(layout.rows[0].height);
    expect(geo.x).toBeCloseTo(layout.measures[0].x, 3);
  });

  it('advances within a row as time progresses', () => {
    const a = playheadGeometry(layout, 1000)!; // mid measure 0
    const b = playheadGeometry(layout, 3000)!; // into measure 1
    expect(a.y).toBe(layout.rows[0].y);
    expect(b.y).toBe(layout.rows[0].y);
    expect(b.x).toBeGreaterThan(a.x);
  });

  it('drops to the second row past the row-0 time span', () => {
    const geo = playheadGeometry(layout, 9000)!; // measure 4, row 1
    expect(geo.clamped).toBe(false);
    expect(geo.y).toBe(layout.rows[1].y);
  });

  it('clamps out-of-range times to the chart bounds', () => {
    const before = playheadGeometry(layout, -500)!;
    expect(before.clamped).toBe(true);
    expect(before.y).toBe(layout.rows[0].y);
    expect(before.x).toBeCloseTo(layout.measures[0].x, 3);

    const after = playheadGeometry(layout, 99_999)!;
    expect(after.clamped).toBe(true);
    expect(after.y).toBe(layout.rows[1].y); // parked on the last row
  });

  it('returns undefined for an empty chart', () => {
    expect(playheadGeometry(layoutScore(makeFumen([]), { contentWidth: 1200 }), 0)).toBeUndefined();
  });
});

describe('note scale', () => {
  it('scales the note geometry helpers by the factor', () => {
    expect(noteHeadRadius(false, 1)).toBe(7);
    expect(noteHeadRadius(true, 1)).toBe(11);
    expect(noteHeadRadius(true, 2)).toBe(22);
    expect(barNoteHeight(false, 1)).toBe(14);
    expect(barNoteHeight(true, 2)).toBe(44);
    expect(noteTargetRadius(false, 1)).toBe(12);
    expect(noteTargetRadius(true, 0.5)).toBe(8);
  });

  it('leaves the row layout and time axis untouched, scaling only the glyphs', () => {
    const chart = makeFumen([makeMeasure(), makeMeasure(), makeMeasure()]);
    const base = layoutScore(chart, { contentWidth: 1200, measuresPerRow: 'auto' });
    const big = layoutScore(chart, { contentWidth: 1200, measuresPerRow: 'auto', noteScale: 2 });

    // The stave lane, inter-branch gap and overall sheet height are all fixed —
    // note size grows only the drawn glyphs (noteHeadRadius/barNoteHeight), so the
    // row height and tag positions never move.
    expect(big.config.staveHeight).toBe(base.config.staveHeight);
    expect(big.config.staveGap).toBe(base.config.staveGap);
    expect(big.totalHeight).toBe(base.totalHeight);

    // Horizontal layout is identical too — note scale never touches the time axis.
    expect(big.totalWidth).toBe(base.totalWidth);
    expect(big.measures.map((m) => [m.x, m.width])).toEqual(base.measures.map((m) => [m.x, m.width]));
  });

  it('widens the note hit target proportionally', () => {
    const chart = makeFumen([makeMeasure([[makeNote(0x1, 500)], [], []])]);
    const cfg = { contentWidth: 480 } as const;
    const base = layoutScore(chart, cfg);
    const big = layoutScore(chart, { ...cfg, noteScale: 2 });

    // A point 14 px above each note's centre: outside the default 12 px target,
    // inside the doubled 24 px one.
    const baseNote = base.notes[0];
    const bigNote = big.notes[0];
    expect(hitTestNote(base, baseNote.x, baseNote.y - 14)).toBeUndefined();
    expect(hitTestNote(big, bigNote.x, bigNote.y - 14)).toEqual({
      measureIndex: 0,
      branchIndex: 0,
      noteIndex: 0,
    });
  });
});

describe('chartIntroDelayMs', () => {
  it('is offset[0] plus one nominal four-beat measure at bpm[0]', () => {
    // 144 BPM => beat 416.67 ms => 4 beats 1666.67 ms; + 281 ms offset.
    expect(chartIntroDelayMs(makeFumen([makeMeasureAt(281, 144), makeMeasure()]))).toBeCloseTo(
      281 + 240000 / 144,
      3,
    );
  });

  it('is zero for an empty chart', () => {
    expect(chartIntroDelayMs(makeFumen([]))).toBe(0);
  });

  it.skipIf(!HAS_CORPUS)('matches the player-reported first-downbeat for butou6 and cls10', async () => {
    const load = async (fixture: string) => {
      const { payload } = await openEnvelope(new Uint8Array(fs.readFileSync(fixture)), FUMEN_KEY_HEX);
      return decodeFumen(payload);
    };
    // butou6 (144 BPM, off 281) -> ~1.95 s; player needed ~1.7 s *more* than the
    // raw 281 ms offset, i.e. a true downbeat near 1.95 s.
    expect(chartIntroDelayMs(await load(BUTOU6_FIXTURE))).toBeCloseTo(281.25 + 240000 / 144, 0);
    // cls10 (160 BPM, off 537) -> 537 + 1500 = ~2.04 s.
    expect(chartIntroDelayMs(await load(CLS10_FIXTURE))).toBeCloseTo(537 + 1500, 0);
  });
});
