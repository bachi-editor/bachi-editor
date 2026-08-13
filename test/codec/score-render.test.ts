import { describe, expect, it } from 'vitest';
import type { Fumen, FumenMeasure, FumenNote } from '../../src/codec';
import { makeFumenHeader } from '../../src/codec';
import { layoutScore } from '../../src/ui/fumen/scoreLayout';
import {
  COLORS,
  drawOverlay,
  drawStatic,
  noteTextForType,
  type PlacementPreview,
} from '../../src/ui/fumen/scoreRender';

// A recording 2D context: every draw call increments a per-method counter, so a
// test can measure how much work each layer does. This is the Phase 9.7 perf
// guard — it proves the interaction overlay's cost is independent of note count,
// i.e. a pointer move can never silently reintroduce a full repaint of the notes.
function makeRecorder() {
  const calls: Record<string, number> = {};
  const textCalls: { text: string; fillStyle: string | CanvasGradient | CanvasPattern }[] = [];
  const bump = (name: string) => () => { calls[name] = (calls[name] ?? 0) + 1; };
  const ctx = {
    save: bump('save'),
    restore: bump('restore'),
    scale: bump('scale'),
    translate: bump('translate'),
    setTransform: bump('setTransform'),
    fillRect: bump('fillRect'),
    clearRect: bump('clearRect'),
    strokeRect: bump('strokeRect'),
    beginPath: bump('beginPath'),
    moveTo: bump('moveTo'),
    lineTo: bump('lineTo'),
    arc: bump('arc'),
    quadraticCurveTo: bump('quadraticCurveTo'),
    closePath: bump('closePath'),
    fill: bump('fill'),
    stroke: bump('stroke'),
    fillText: (text: string) => {
      bump('fillText')();
      textCalls.push({ text, fillStyle: ctx.fillStyle });
    },
    setLineDash: bump('setLineDash'),
    measureText: (text: string) => { bump('measureText')(); return { width: text.length * 6 }; },
    // style/state properties are plain assignable fields
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, textCalls };
}

function makeNote(type: number, position: number, duration = 0, scoreInit = 0): FumenNote {
  return { type, position, item: 0, padding: 0, scoreInit, scoreDiff: 0, duration };
}

function denseBranch(count: number): FumenNote[] {
  const notes: FumenNote[] = [];
  for (let i = 0; i < count; i++) notes.push(makeNote(i % 2 === 0 ? 0x1 : 0x4, (i / count) * 2000));
  return notes;
}

function makeMeasure(perBranch: number): FumenMeasure {
  return {
    bpm: 120,
    offset: 0,
    gogo: 0,
    barline: 1,
    padding1: 0,
    branchInfo: [-1, -1, -1, -1, -1, -1],
    padding2: 0,
    branches: [
      { padding: 0, speed: 1, notes: denseBranch(perBranch) },
      { padding: 0, speed: 1, notes: denseBranch(perBranch) },
      { padding: 0, speed: 1, notes: denseBranch(perBranch) },
    ],
  };
}

function makeChart(measureCount: number, perBranch: number): Fumen {
  const measures: FumenMeasure[] = [];
  for (let i = 0; i < measureCount; i++) measures.push(makeMeasure(perBranch));
  return {
    // hasBranches flag => the canvas renders 3 stacked staves (densest case).
    header: makeFumenHeader({ measureCount, hasBranches: 1 }),
    measures,
    trailer: new Uint8Array(),
  };
}

function makeFlatMeasure(bpm: number): FumenMeasure {
  return {
    bpm,
    offset: 0,
    gogo: 0,
    barline: 1,
    padding1: 0,
    branchInfo: [-1, -1, -1, -1, -1, -1],
    padding2: 0,
    branches: [
      { padding: 0, speed: 1, notes: [makeNote(0x1, 0)] },
      { padding: 0, speed: 1, notes: [] },
      { padding: 0, speed: 1, notes: [] },
    ],
  };
}

function makeFlatChart(bpms: number[]): Fumen {
  return {
    header: makeFumenHeader({ measureCount: bpms.length }),
    measures: bpms.map(makeFlatMeasure),
    trailer: new Uint8Array(),
  };
}

const GHOST: PlacementPreview = {
  measureIndex: 0,
  branchIndex: 0,
  position: 250,
  duration: 0,
  type: 0x1,
  scoreInit: 0,
};

describe('score render layering (Phase 9.5/9.7)', () => {
  it('static layer draws every note (arc count scales with note count)', () => {
    const small = layoutScore(makeChart(1, 2), { contentWidth: 1200, measuresPerRow: 'auto' });
    const dense = layoutScore(makeChart(64, 16), { contentWidth: 1200, measuresPerRow: 'auto' });

    const r1 = makeRecorder();
    drawStatic(r1.ctx, small, 2, '1/16', true);
    const r2 = makeRecorder();
    drawStatic(r2.ctx, dense, 2, '1/16', true);

    // 1 measure × 3 staves × 2 notes = 6 vs 64 × 3 × 16 = 3072.
    expect(dense.notes.length).toBe(3072);
    expect(r2.calls.arc).toBeGreaterThan(r1.calls.arc * 100);
  });

  it('static viewport culling draws only the visible score rows', () => {
    const dense = layoutScore(makeChart(64, 16), { contentWidth: 1200, measuresPerRow: 'auto' });
    const full = makeRecorder();
    drawStatic(full.ctx, dense, 2, '1/16', true);

    const firstRow = dense.rows[0];
    const culled = makeRecorder();
    drawStatic(culled.ctx, dense, 2, '1/16', true, undefined, {
      top: firstRow.y,
      height: firstRow.height,
      overscan: 0,
    });

    expect(culled.calls.arc).toBeGreaterThan(0);
    expect(culled.calls.arc).toBeLessThan(full.calls.arc / 8);
    expect(culled.calls.translate).toBe(1);
  });

  it('overlay cost is independent of note count — a hover never repaints notes', () => {
    const small = layoutScore(makeChart(1, 2), { contentWidth: 1200, measuresPerRow: 'auto' });
    const dense = layoutScore(makeChart(64, 16), { contentWidth: 1200, measuresPerRow: 'auto' });

    const r1 = makeRecorder();
    drawOverlay(r1.ctx, small, 2, { preview: GHOST });
    const r2 = makeRecorder();
    drawOverlay(r2.ctx, dense, 2, { preview: GHOST });

    // The same single ghost on a 6-note chart and a 3072-note chart must cost
    // exactly the same — the overlay never iterates the note list.
    expect(r1.calls.arc).toBe(r2.calls.arc);
    expect(r1.calls.arc).toBeLessThanOrEqual(3); // one ghost head, not thousands
    // And it always clears its own canvas first so nothing accumulates.
    expect(r1.calls.clearRect).toBe(1);
    expect(r2.calls.clearRect).toBe(1);
  });

  it('an empty overlay clears and draws nothing', () => {
    const dense = layoutScore(makeChart(64, 16), { contentWidth: 1200, measuresPerRow: 'auto' });
    const r = makeRecorder();
    drawOverlay(r.ctx, dense, 2, {});
    expect(r.calls.clearRect).toBe(1);
    expect(r.calls.arc ?? 0).toBe(0);
    expect(r.calls.fill ?? 0).toBe(0);
  });

  it('preview layout (showTimingMarkers=false) drops the BPM/HS badges but keeps notes', () => {
    // Every measure changes BPM, so each would carry a badge (a rounded rect
    // drawn with quadraticCurveTo). showSnapLines is off in both to isolate them.
    const bpms = [120, 200, 120, 240];
    const withTags = makeRecorder();
    drawStatic(withTags.ctx, layoutScore(makeFlatChart(bpms), { contentWidth: 1200, measuresPerRow: 'auto' }), 2, '1/16', false);
    const preview = layoutScore(makeFlatChart(bpms), { contentWidth: 1200, measuresPerRow: 'auto', showTimingMarkers: false });
    const without = makeRecorder();
    drawStatic(without.ctx, preview, 2, '1/16', false);

    expect(preview.measures.every((m) => m.timingMarkers.length === 0)).toBe(true);
    expect(withTags.calls.quadraticCurveTo).toBeGreaterThan(without.calls.quadraticCurveTo);
    expect(without.calls.arc).toBeGreaterThan(0); // notes still render
  });

  it('the replace-modifier ghost adds a hint ring (one extra arc)', () => {
    const layout = layoutScore(makeChart(2, 2), { contentWidth: 1200, measuresPerRow: 'auto' });
    const plain = makeRecorder();
    drawOverlay(plain.ctx, layout, 2, { preview: GHOST });
    const replacing = makeRecorder();
    drawOverlay(replacing.ctx, layout, 2, { preview: { ...GHOST, replace: true } });
    expect(replacing.calls.arc).toBe(plain.calls.arc + 1);
  });
});

describe('Japanese Don/Ka text overlay', () => {
  it('maps hit-note types and omits drumrolls and balloons', () => {
    expect([
      0x1, 0x2, 0x3, 0x4, 0x5, 0x7, 0xb, 0x8, 0xd,
      0x6, 0x9, 0xa, 0xc,
    ].map(noteTextForType)).toEqual([
      'ドン', 'ド', 'コ', 'カッ', 'カ',
      'ドン(大)', 'ドン(大)', 'カッ(大)', 'カッ(大)',
      undefined, undefined, undefined, undefined,
    ]);
  });

  it('draws stored text and colors only recommendation mismatches orange', () => {
    const types = [0x1, 0x2, 0x3, 0x4, 0x5, 0x7, 0xb, 0x8, 0xd, 0x6, 0x9, 0xa, 0xc];
    const notes = types.map((type, index) => makeNote(type, (index + 1) * 125));
    const measure = makeFlatMeasure(120);
    measure.branches[0].notes = notes;
    const chart = makeFlatChart([120]);
    chart.measures[0] = measure;
    const layout = layoutScore(chart, { contentWidth: 1200, measuresPerRow: 'auto' });
    const recommendations = new Map<FumenNote, number>([
      [notes[0], 0x2],
      [notes[1], 0x2],
    ]);

    const shown = makeRecorder();
    drawStatic(shown.ctx, layout, 2, '1/16', false, undefined, undefined, { recommendations });
    const noteTexts = new Set(['ドン', 'ド', 'コ', 'カッ', 'カ', 'ドン(大)', 'カッ(大)']);
    const shownNoteText = shown.textCalls.filter((call) => noteTexts.has(call.text));
    expect(shownNoteText).toHaveLength(9);
    expect(shownNoteText.find((call) => call.text === 'ドン')?.fillStyle).toBe(COLORS.warningText);
    expect(shownNoteText.find((call) => call.text === 'ド')?.fillStyle).toBe(COLORS.text);

    const hidden = makeRecorder();
    drawStatic(hidden.ctx, layout, 2, '1/16', false);
    expect(hidden.textCalls.filter((call) => noteTexts.has(call.text))).toHaveLength(0);
  });
});

// A path-recording context: every point fed to the current path is kept, and a
// fill() snapshots that path with the fill style in force. Enough to measure the
// vertical extent of a filled shape (here: the row's measure-number chip).
function makePathRecorder() {
  const fills: { fillStyle: string; ys: number[] }[] = [];
  let ys: number[] = [];
  const point = (_x: number, y: number) => { ys.push(y); };
  const ctx = {
    save() {}, restore() {}, scale() {}, translate() {}, setTransform() {},
    fillRect() {}, clearRect() {}, strokeRect() {}, arc() {}, setLineDash() {},
    stroke() {}, fillText() {},
    measureText: (text: string) => ({ width: text.length * 6 }),
    beginPath() { ys = []; },
    closePath() {},
    moveTo: point,
    lineTo: point,
    quadraticCurveTo: (_cx: number, _cy: number, x: number, y: number) => point(x, y),
    fill() { fills.push({ fillStyle: ctx.fillStyle, ys: [...ys] }); },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
}

/** Vertical midpoint of the row gutter's measure-number chip. */
function gutterChipCenterY(layout: ReturnType<typeof layoutScore>): number {
  const rec = makePathRecorder();
  drawStatic(rec.ctx, layout, 2, '1/16', false);
  const chip = rec.fills.find((f) => f.fillStyle === COLORS.gutterBg);
  expect(chip).toBeDefined();
  return (Math.min(...chip!.ys) + Math.max(...chip!.ys)) / 2;
}

describe('row gutter chip is centred on the stave centre line', () => {
  it('centres on the single stave of a flat chart', () => {
    const layout = layoutScore(makeFlatChart([120]), { contentWidth: 1200, measuresPerRow: 'auto' });
    // The header band above the staves is badge space; the chip brackets the lane,
    // so its midpoint lands on the centre line the notes sit on.
    expect(gutterChipCenterY(layout)).toBeCloseTo(layout.measures[0].staveYs[0], 6);
  });

  it('centres on the middle stave of a branched chart', () => {
    const layout = layoutScore(makeChart(1, 2), { contentWidth: 1200, measuresPerRow: 'auto' });
    expect(layout.measures[0].branchCount).toBe(3);
    expect(gutterChipCenterY(layout)).toBeCloseTo(layout.measures[0].staveYs[1], 6);
  });
});
