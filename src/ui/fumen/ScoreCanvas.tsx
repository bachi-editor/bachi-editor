import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { type Fumen, type FumenNote } from '../../codec';
import {
  ChartMeasureRef,
  ChartNoteRef,
  ChartTool,
  isLongPlacementTool,
  isPlacementTool,
  noteTypeForTool,
  type PlaceChartNoteInput,
} from '../../model/fumenEdits';
import { calculateBranchNoteLabels } from '../../model/fumenNoteLabels';
import {
  DEFAULT_LAYOUT,
  hitTestGrid,
  hitTestMeasure,
  hitTestNote,
  layoutScore,
  notesInRect,
  playheadGeometry,
  snapDivisions,
  type ScoreGridHit,
  type SnapValue,
} from './scoreLayout';
import {
  drawOverlay,
  drawStatic,
  setScoreTheme,
  type MarqueeState,
  type NoteTextInput,
  type PlacementPreview,
  type RenderViewport,
} from './scoreRender';
import { scrollPositionForPlayhead } from './scoreFollow';
import { useAppStore } from '../../model/store';

interface DragState {
  pointerId: number;
  tool: 'roll' | 'rollbig' | 'balloon' | 'kusudama';
  shiftKey: boolean;
  /** Replace window (ms) when Cmd/Ctrl is held at drag start; else undefined. */
  replaceWithinMs?: number;
  start: ScoreGridHit;
  current: ScoreGridHit;
}

function isBalloonPlacementTool(tool: ChartTool): boolean {
  return tool === 'balloon' || tool === 'kusudama';
}

/** Canvas-space drag distance past which a select-tool press becomes a marquee
 *  (below it, the press is treated as a measure click). */
const MARQUEE_THRESHOLD_PX = 4;

/** Half a snap cell — the window the "replace note at slot" modifier deletes within. */
function replaceWindowMs(hit: ScoreGridHit, snap: SnapValue): number {
  return hit.measureDurationMs / snapDivisions(snap) / 2;
}

const VIEWPORT_OVERSCAN_PX = 96;

// Presentation baselines so the editor opens calmer than the raw layout reference
// (the old default view read too dense). The timeline "100%" stop now renders at
// twice the layout base scale, and "100%" note size at 1.5× the base glyph
// geometry — i.e. the former 200% timeline zoom and 150% note size are the new
// defaults. The slider labels (ScaleControls) are unchanged; they read relative to
// these baselines. Pure-layout tests bypass ScoreCanvas, so they keep the raw scale.
const TIMELINE_ZOOM_BASELINE = 2;
const NOTE_SCALE_BASELINE = 1.5;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function ScoreCanvas({
  fumen,
  snap = '1/16',
  showSnapLines = true,
  showNoteText = false,
  preview = false,
  zoom = 1,
  noteScale = 1,
  tool = 'select',
  branchFocus = 'all',
  selectedNote,
  selectedNotes,
  selectedMeasure,
  playheadMs,
  followPlayhead = false,
  onSelectNote,
  onSelectNotes,
  onSelectMeasure,
  onPlaceNote,
  onEraseNote,
  onRequestSelectTool,
}: {
  fumen: Fumen;
  snap?: SnapValue;
  showSnapLines?: boolean;
  /** Show the stored Japanese Don/Ka text below hit notes. Formula mismatches
   *  are highlighted as non-blocking recommendations. */
  showNoteText?: boolean;
  /** Read-only preview (Sound tab): hide the snap grid and the BPM/HS badges,
   *  leaving just the notes and the authored barlines. */
  preview?: boolean;
  /** Horizontal (timeline) zoom multiplier applied to the base time scale (1 = default). */
  zoom?: number;
  /** Vertical note/row scale (1 = default); grows the notes and rows, not the time axis. */
  noteScale?: number;
  tool?: ChartTool;
  branchFocus?: 'all' | 0 | 1 | 2;
  selectedNote?: ChartNoteRef;
  selectedNotes?: ChartNoteRef[];
  selectedMeasure?: ChartMeasureRef;
  /** When set, draw a read-only playhead at this chart time (ms); see SoundTab. */
  playheadMs?: number;
  /** Keep the read-only playhead inside the scrollport while audio is playing. */
  followPlayhead?: boolean;
  onSelectNote?: (ref?: ChartNoteRef) => void;
  onSelectNotes?: (refs: ChartNoteRef[]) => void;
  onSelectMeasure?: (ref?: ChartMeasureRef) => void;
  onPlaceNote?: (input: PlaceChartNoteInput) => void;
  onEraseNote?: (ref: ChartNoteRef) => void;
  /** Right-click anywhere on the sheet: drop back to the Select tool. */
  onRequestSelectTool?: () => void;
}) {
  // The score sheet is canvas-drawn, so it can't inherit the CSS theme tokens —
  // swap its palette (scoreRender's COLORS) to match the app theme, and repaint
  // whenever it changes (theme is in the draw-effect deps below).
  const theme = useAppStore((s) => s.ui.theme);

  const wrapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // Two stacked canvases (Phase 9.5): the heavy static chart and a transparent
  // interaction overlay. Pointer handlers live on the static canvas; the overlay
  // is pointer-events:none so clicks fall through to it.
  const staticRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [contentWidth, setContentWidth] = useState(1200);
  const [viewport, setViewport] = useState<RenderViewport>({ top: 0, height: 480, overscan: VIEWPORT_OVERSCAN_PX });
  const [drag, setDrag] = useState<DragState | undefined>();
  const [marquee, setMarquee] = useState<MarqueeState | undefined>();
  // Select-tool press that hasn't moved far enough to become a marquee yet: on
  // release it resolves to a measure-click (Phase 11), on drag it promotes to a
  // marquee. Distinguishes a measure select from a multi-note drag.
  const [pending, setPending] = useState<{ pointerId: number; x0: number; y0: number } | undefined>();
  // Idle hover target for the ghost placement preview (placement tools only).
  const [hover, setHover] = useState<{ hit: ScoreGridHit; shiftKey: boolean; replace: boolean } | undefined>();

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth - DEFAULT_LAYOUT.paddingX * 2;
      if (w > 200) setContentWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(
    () => layoutScore(fumen, {
      contentWidth,
      measuresPerRow: 'auto',
      pxPerMs: DEFAULT_LAYOUT.pxPerMs * zoom * TIMELINE_ZOOM_BASELINE,
      noteScale: noteScale * NOTE_SCALE_BASELINE,
      // Preview (Sound tab) drops the BPM/HS badges and the space they'd reserve.
      showTimingMarkers: !preview,
    }),
    [fumen, contentWidth, zoom, noteScale, preview],
  );

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const content = contentRef.current;
    if (!wrap || !content) return;

    const scroller = (wrap.closest('.tk-canvas') as HTMLElement | null) ?? wrap.parentElement ?? wrap;
    let frame = 0;

    const update = () => {
      frame = 0;
      const scrollerRect = scroller.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      const rawTop = scrollerRect.top - contentRect.top;
      const height = Math.max(1, Math.min(scroller.clientHeight || scrollerRect.height, layout.totalHeight));
      const top = clamp(rawTop, 0, Math.max(0, layout.totalHeight - height));
      setViewport((prev) => {
        if (Math.abs(prev.top - top) < 0.5 && Math.abs(prev.height - height) < 0.5) return prev;
        return { top, height, overscan: VIEWPORT_OVERSCAN_PX };
      });
    };

    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    update();
    scroller.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(scroller);
    ro.observe(content);
    ro.observe(wrap);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scroller.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      ro.disconnect();
    };
  }, [layout.totalHeight, layout.totalWidth]);

  // Branch focus only applies to charts that actually have branch tracks.
  const branchFilter = layout.hasBranches && branchFocus !== 'all' ? branchFocus : undefined;

  const noteTextInput = useMemo<NoteTextInput | undefined>(() => {
    if (!showNoteText) return undefined;
    const recommendations = new Map<FumenNote, number>();
    for (const branchIndex of [0, 1, 2] as const) {
      for (const [note, type] of calculateBranchNoteLabels(fumen, branchIndex)) {
        recommendations.set(note, type);
      }
    }
    return { recommendations };
  }, [fumen, showNoteText]);

  // Keyboard navigation can move the selection outside the current scrollport.
  // Keep the newly selected note/measure visible without disturbing pointer
  // selections that are already on screen.
  useLayoutEffect(() => {
    if (!selectedNote && !selectedMeasure) return;
    const content = contentRef.current;
    const wrap = wrapRef.current;
    if (!content || !wrap) return;
    const scroller = (wrap.closest('.tk-canvas') as HTMLElement | null) ?? wrap.parentElement;
    if (!scroller) return;

    let x: number;
    let y: number;
    if (selectedNote) {
      const target = layout.notes.find((note) => (
        note.measureIndex === selectedNote.measureIndex
        && note.branchIndex === selectedNote.branchIndex
        && note.noteIndex === selectedNote.noteIndex
      ));
      if (!target) return;
      x = target.x;
      y = target.y;
    } else {
      const target = layout.measures[selectedMeasure!.measureIndex];
      if (!target) return;
      x = target.x + target.width / 2;
      const branch = selectedMeasure!.branchIndex;
      y = branch === undefined
        ? (target.staveYs[0] + target.staveYs[target.staveYs.length - 1]) / 2
        : target.staveYs[branch];
    }

    const contentRect = content.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    const targetX = contentRect.left + x;
    const targetY = contentRect.top + y;
    const margin = 36;
    let left = 0;
    let top = 0;
    if (targetX < scrollerRect.left + margin) left = targetX - (scrollerRect.left + margin);
    else if (targetX > scrollerRect.right - margin) left = targetX - (scrollerRect.right - margin);
    if (targetY < scrollerRect.top + margin) top = targetY - (scrollerRect.top + margin);
    else if (targetY > scrollerRect.bottom - margin) top = targetY - (scrollerRect.bottom - margin);
    if (left !== 0 || top !== 0) scroller.scrollBy({ left, top });
  }, [layout, selectedNote, selectedMeasure]);

  // Read-only playhead overlay (Sound tab). Rendered as a DOM element keyed on
  // playheadMs so the heavy score canvas is not redrawn every animation frame.
  const playhead = useMemo(
    () => (playheadMs == null ? undefined : playheadGeometry(layout, playheadMs)),
    [playheadMs, layout],
  );

  useLayoutEffect(() => {
    if (!followPlayhead || !playhead) return;
    const content = contentRef.current;
    const wrap = wrapRef.current;
    if (!content || !wrap) return;
    const scroller = (wrap.closest('.tk-canvas') as HTMLElement | null) ?? wrap.parentElement;
    if (!scroller) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const targetX = contentRect.left + playhead.x;
    const targetTop = contentRect.top + playhead.y;
    const targetBottom = targetTop + playhead.height;
    const next = scrollPositionForPlayhead({
      viewportLeft: scrollerRect.left + scroller.clientLeft,
      viewportTop: scrollerRect.top + scroller.clientTop,
      viewportWidth: scroller.clientWidth,
      viewportHeight: scroller.clientHeight,
      targetX,
      targetTop,
      targetBottom,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
      maxScrollLeft: scroller.scrollWidth - scroller.clientWidth,
      maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
    });
    if (next) scroller.scrollTo(next);
  }, [followPlayhead, playhead]);

  // Live multi-selection preview while the marquee is open.
  const marqueeRefs = useMemo<ChartNoteRef[] | undefined>(() => {
    if (!marquee) return undefined;
    return notesInRect(layout, marquee.x0, marquee.y0, marquee.x1, marquee.y1, branchFilter).map((h) => ({
      measureIndex: h.measureIndex,
      branchIndex: h.branchIndex,
      noteIndex: h.noteIndex,
    }));
  }, [marquee, layout, branchFilter]);

  const dragPreview = useMemo<PlacementPreview | undefined>(() => {
    if (!drag) return undefined;
    const duration = dragDuration(drag, snap);
    return {
      measureIndex: drag.start.measureIndex,
      branchIndex: drag.start.branchIndex,
      position: drag.start.position,
      duration,
      type: noteTypeForTool(drag.tool, drag.shiftKey),
      scoreInit: isBalloonPlacementTool(drag.tool) ? 10 : 0,
      replace: drag.replaceWithinMs !== undefined,
    };
  }, [drag, snap]);

  // Ghost preview of the note the active placement tool would drop at the
  // hovered, snapped lane — shown even over/near an existing note (Phase 9.1),
  // because placement no longer diverts to selection there.
  const hoverPreview = useMemo<PlacementPreview | undefined>(() => {
    if (!hover || drag || marquee || !isPlacementTool(tool)) return undefined;
    // A plain click on a long-note tool commits a one-snap-cell bar, so the
    // ghost previews that minimum length; instantaneous notes carry no bar.
    const duration = isLongPlacementTool(tool)
      ? hover.hit.measureDurationMs / snapDivisions(snap)
      : 0;
    return {
      measureIndex: hover.hit.measureIndex,
      branchIndex: hover.hit.branchIndex,
      position: hover.hit.position,
      duration,
      type: noteTypeForTool(tool, hover.shiftKey),
      scoreInit: isBalloonPlacementTool(tool) ? 10 : 0,
      replace: hover.replace,
    };
  }, [hover, drag, marquee, tool, snap]);

  // Size both canvases to the visible viewport, not the full chart (Phase 9.4).
  // The spacer keeps the scroll height, while drawing is translated by
  // `viewport.top`. This avoids browser max-canvas limits on very tall charts.
  useEffect(() => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.ceil(layout.totalWidth * dpr);
    const viewportHeight = Math.max(1, Math.ceil(viewport.height));
    const h = Math.ceil(viewportHeight * dpr);
    for (const canvas of [staticRef.current, overlayRef.current]) {
      if (!canvas) continue;
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = `${layout.totalWidth}px`;
      canvas.style.height = `${viewportHeight}px`;
    }
  }, [layout.totalWidth, viewport.height]);

  // Static layer: redraw only when the base chart changes (layout / snap grid /
  // branch focus) — never on a bare pointer move. Preview mode (Sound tab) hides
  // the snap grid here; the BPM/HS badges are already dropped from the layout.
  const effectiveShowSnapLines = showSnapLines && !preview;
  useEffect(() => {
    const ctx = staticRef.current?.getContext('2d');
    if (!ctx) return;
    setScoreTheme(theme);
    const dpr = window.devicePixelRatio || 1;
    drawStatic(ctx, layout, dpr, snap, effectiveShowSnapLines, branchFilter, viewport, noteTextInput);
  }, [layout, snap, effectiveShowSnapLines, branchFilter, viewport, noteTextInput, theme]);

  // Overlay layer: redraw on every interaction change (hover ghost, drag/marquee
  // preview, selection). Cheap — it never touches the notes beneath it.
  useEffect(() => {
    const ctx = overlayRef.current?.getContext('2d');
    if (!ctx) return;
    setScoreTheme(theme);
    const dpr = window.devicePixelRatio || 1;
    // While the marquee is open, show its live contents instead of the committed set.
    const shownMulti = marquee ? marqueeRefs : selectedNotes;
    drawOverlay(ctx, layout, dpr, {
      selectedNote,
      selectedNotes: shownMulti,
      selectedMeasure,
      preview: dragPreview ?? hoverPreview,
      marquee,
    }, viewport);
  }, [layout, selectedNote, selectedNotes, selectedMeasure, dragPreview, hoverPreview, marquee, marqueeRefs, viewport, theme]);

  const pointFromEvent = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = staticRef.current;
    if (!canvas) return undefined;
    const rect = canvas.getBoundingClientRect();
    const scaleX = layout.totalWidth / rect.width;
    const scaleY = viewport.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: viewport.top + (e.clientY - rect.top) * scaleY,
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    // Primary button only: a right-click is reserved for switching back to the
    // Select tool (below) and must never place, erase, or select on its way.
    if (e.button !== 0) return;
    const point = pointFromEvent(e);
    if (!point) return;
    setHover(undefined); // clear the ghost; it re-appears on the next move

    const noteHit = hitTestNote(layout, point.x, point.y, branchFilter);
    // Alt is the universal erase shortcut (works with any tool); so is the Eraser
    // tool clicking a note.
    if (noteHit && (e.altKey || tool === 'eraser')) {
      e.preventDefault();
      onEraseNote?.(noteHit);
      return;
    }

    // Select tool: a note click selects it (note hit-testing has priority). An
    // empty press is held pending — a release without dragging selects the
    // measure under it (Phase 11), a drag promotes to a note marquee.
    if (tool === 'select') {
      if (noteHit) {
        e.preventDefault();
        onSelectNote?.(noteHit);
        return;
      }
      e.preventDefault();
      staticRef.current?.setPointerCapture(e.pointerId);
      setPending({ pointerId: e.pointerId, x0: point.x, y0: point.y });
      return;
    }

    if (tool === 'eraser') {
      // Click on empty space clears the selection (note clicks erased above).
      onSelectNote?.(undefined);
      return;
    }

    const gridHit = hitTestGrid(layout, point.x, point.y, snap, branchFilter);
    if (!gridHit) return;

    // Placement tools (Phase 9.2/9.3): always place at the snapped grid slot,
    // regardless of an overlapping note — the radius hit-test never diverts a
    // placement click to selection. Cmd/Ctrl replaces the note already at the slot.
    if (isPlacementTool(tool)) {
      e.preventDefault();
      const replaceWithinMs = (e.metaKey || e.ctrlKey) ? replaceWindowMs(gridHit, snap) : undefined;
      if (isLongPlacementTool(tool)) {
        staticRef.current?.setPointerCapture(e.pointerId);
        setDrag({ pointerId: e.pointerId, tool, shiftKey: e.shiftKey, replaceWithinMs, start: gridHit, current: gridHit });
      } else {
        onPlaceNote?.({ ...gridHit, tool, shiftKey: e.shiftKey, replaceWithinMs });
      }
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pending && pending.pointerId === e.pointerId) {
      const point = pointFromEvent(e);
      if (!point) return;
      if (Math.hypot(point.x - pending.x0, point.y - pending.y0) > MARQUEE_THRESHOLD_PX) {
        setMarquee({ pointerId: e.pointerId, x0: pending.x0, y0: pending.y0, x1: point.x, y1: point.y });
        setPending(undefined);
      }
      return;
    }
    if (marquee && marquee.pointerId === e.pointerId) {
      const point = pointFromEvent(e);
      if (!point) return;
      setMarquee({ ...marquee, x1: point.x, y1: point.y });
      return;
    }
    if (drag && drag.pointerId === e.pointerId) {
      const point = pointFromEvent(e);
      if (!point) return;
      const gridHit = hitTestGrid(layout, point.x, point.y, snap, branchFilter);
      if (gridHit && gridHit.measureIndex === drag.start.measureIndex && gridHit.branchIndex === drag.start.branchIndex) {
        setDrag({ ...drag, current: gridHit });
      }
      return;
    }

    // Idle: track the snapped lane under the cursor for the ghost preview.
    if (!isPlacementTool(tool)) {
      if (hover) setHover(undefined);
      return;
    }
    const point = pointFromEvent(e);
    // Show the ghost even over an existing note (Phase 9.1): placement targets
    // the snapped grid slot, not the note under the cursor.
    const gridHit = point ? hitTestGrid(layout, point.x, point.y, snap, branchFilter) : undefined;
    if (!gridHit) {
      if (hover) setHover(undefined);
      return;
    }
    const replace = e.metaKey || e.ctrlKey;
    // Skip redundant state churn while moving within the same snap cell.
    if (hover
      && hover.hit.measureIndex === gridHit.measureIndex
      && hover.hit.branchIndex === gridHit.branchIndex
      && hover.hit.position === gridHit.position
      && hover.shiftKey === e.shiftKey
      && hover.replace === replace) {
      return;
    }
    setHover({ hit: gridHit, shiftKey: e.shiftKey, replace });
  };

  const finishMarquee = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!marquee || marquee.pointerId !== e.pointerId) return false;
    e.preventDefault();
    staticRef.current?.releasePointerCapture(e.pointerId);
    const refs = notesInRect(layout, marquee.x0, marquee.y0, marquee.x1, marquee.y1, branchFilter).map((h) => ({
      measureIndex: h.measureIndex,
      branchIndex: h.branchIndex,
      noteIndex: h.noteIndex,
    }));
    onSelectNotes?.(refs);
    setMarquee(undefined);
    return true;
  };

  // A select-tool press released without dragging past the threshold: select the
  // measure under the cursor (a gutter or empty-measure click), or clear if the
  // release landed outside every measure (e.g. the padding margins).
  const finishPending = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pending || pending.pointerId !== e.pointerId) return false;
    e.preventDefault();
    staticRef.current?.releasePointerCapture(e.pointerId);
    const point = pointFromEvent(e);
    const measureHit = point ? hitTestMeasure(layout, point.x, point.y, branchFilter) : undefined;
    onSelectMeasure?.(measureHit);
    setPending(undefined);
    return true;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (finishPending(e)) return;
    if (finishMarquee(e)) return;
    finishDrag(e);
  };

  const finishDrag = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    e.preventDefault();
    staticRef.current?.releasePointerCapture(e.pointerId);
    const duration = dragDuration(drag, snap);
    onPlaceNote?.({
      measureIndex: drag.start.measureIndex,
      branchIndex: drag.start.branchIndex,
      position: drag.start.position,
      tool: drag.tool,
      shiftKey: drag.shiftKey,
      duration,
      balloonCount: isBalloonPlacementTool(drag.tool) ? 10 : undefined,
      replaceWithinMs: drag.replaceWithinMs,
    });
    setDrag(undefined);
  };

  return (
    <div ref={wrapRef} className="tk-sheet">
      <div ref={contentRef} style={{ position: 'relative', width: layout.totalWidth, height: layout.totalHeight }}>
        <div style={{ position: 'sticky', top: 0, width: layout.totalWidth, height: viewport.height, overflow: 'hidden' }}>
          <canvas
            ref={staticRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => { setDrag(undefined); setMarquee(undefined); setPending(undefined); setHover(undefined); }}
            onPointerLeave={() => setHover(undefined)}
            onContextMenu={onRequestSelectTool && ((e) => {
              e.preventDefault();
              setHover(undefined); // the ghost belongs to the tool being left
              onRequestSelectTool();
            })}
            style={{ display: 'block', cursor: cursorForTool(tool) }}
          />
          <canvas
            ref={overlayRef}
            style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
          />
          {playhead && (
            <div
              className="tk-playhead"
              style={{ left: playhead.x, top: playhead.y - viewport.top, height: playhead.height }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function dragDuration(drag: DragState, snap: SnapValue): number {
  const minDuration = Math.max(1, drag.start.measureDurationMs / snapDivisions(snap));
  const raw = drag.current.position - drag.start.position;
  return Math.max(minDuration, raw);
}

function cursorForTool(tool: ChartTool): string {
  if (tool === 'select') return 'default';
  if (tool === 'eraser') return 'not-allowed';
  return 'crosshair';
}
