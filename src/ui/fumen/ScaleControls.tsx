import { useAppStore } from '../../model/store';
import { useT } from '../../i18n';

// Discrete timeline-zoom stops (multipliers of the base time scale): 50% … 400%.
export const ZOOM_STOPS = [0.5, 1, 2, 3, 4] as const;

// Continuous note-size range: shrink to 50% to see more of the chart at once, or
// grow to 200% to read dense passages clearly.
const NOTE_SCALE_MIN = 0.5;
const NOTE_SCALE_MAX = 2;
const NOTE_SCALE_STEP = 0.05;

function nearestZoomIndex(zoom: number): number {
  let best = 0;
  for (let i = 1; i < ZOOM_STOPS.length; i++) {
    if (Math.abs(ZOOM_STOPS[i] - zoom) < Math.abs(ZOOM_STOPS[best] - zoom)) best = i;
  }
  return best;
}

/**
 * The two score-canvas scale sliders, shown side by side and shared by the Chart
 * and Sound tabs (both back onto the store, so the values persist across tab
 * switches). They scale independent axes — kept as separate, clearly-labelled
 * controls so neither reads as a generic "zoom":
 *
 *   - Timeline: stretches the horizontal time axis (discrete 50%…400% stops, so
 *     the thumb only lands on a supported `ui.zoom` multiplier).
 *   - Note size: grows the note glyphs (radii / bar heights) only — the row
 *     height, stave lane and timing tags all stay put (continuous 50%…200%), so
 *     resizing notes for legibility never reflows the chart.
 */
export function ScaleControls() {
  const zoom = useAppStore((s) => s.ui.zoom);
  const setZoom = useAppStore((s) => s.setZoom);
  const noteScale = useAppStore((s) => s.ui.noteScale);
  const setNoteScale = useAppStore((s) => s.setNoteScale);
  const zoomIndex = nearestZoomIndex(zoom);
  const t = useT();

  return (
    <div className="tk-scale-controls">
      <div className="tk-scale-ctl" title={t('scale.timelineTitle')}>
        <span>{t('scale.timeline')}</span>
        <input
          type="range"
          className="tk-scale-slider"
          min={0}
          max={ZOOM_STOPS.length - 1}
          step={1}
          value={zoomIndex}
          onChange={(e) => setZoom(ZOOM_STOPS[Number(e.currentTarget.value)])}
        />
        <span className="tk-scale-val">{Math.round(ZOOM_STOPS[zoomIndex] * 100)}%</span>
      </div>
      <div className="tk-scale-ctl" title={t('scale.noteSizeTitle')}>
        <span>{t('scale.noteSize')}</span>
        <input
          type="range"
          className="tk-scale-slider"
          min={NOTE_SCALE_MIN}
          max={NOTE_SCALE_MAX}
          step={NOTE_SCALE_STEP}
          value={noteScale}
          onChange={(e) => setNoteScale(Number(e.currentTarget.value))}
        />
        <span className="tk-scale-val">{Math.round(noteScale * 100)}%</span>
      </div>
    </div>
  );
}
