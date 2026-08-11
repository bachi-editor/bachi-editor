import { useState } from 'react';
import { useAppStore } from '../../../model/store';
import { preferredTitle, SongRow } from '../../../model/songlist';
import type { FumenSlot } from '../../../fs/fumens';
import { ScoreCanvas } from '../../fumen/ScoreCanvas';
import type { SnapValue } from '../../fumen/scoreLayout';
import { Inspector } from '../../shell/Inspector';
import { SongHeader } from '../SongHeader';
import { DiffTabs } from './DiffTabs';
import { Toolbar } from './Toolbar';
import { ChartEmptyNoDiff, ChartError, ChartLoading, ChartNoCharts } from './ChartStates';

// Snap-line visibility survives reloads via localStorage (best-effort). Hidden by
// default — the snap grid is opt-in, kept off until the user turns it on.
const SNAP_LINES_STORAGE_KEY = 'tk-show-snap-lines';
const NOTE_TEXT_STORAGE_KEY = 'tk-show-note-text';

function loadShowSnapLines(): boolean {
  try {
    return localStorage.getItem(SNAP_LINES_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistShowSnapLines(show: boolean): void {
  try {
    localStorage.setItem(SNAP_LINES_STORAGE_KEY, show ? '1' : '0');
  } catch {
    // ignore — persistence is best-effort
  }
}

function loadShowNoteText(): boolean {
  try {
    return localStorage.getItem(NOTE_TEXT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistShowNoteText(show: boolean): void {
  try {
    localStorage.setItem(NOTE_TEXT_STORAGE_KEY, show ? '1' : '0');
  } catch {
    // ignore — persistence is best-effort
  }
}

export function ChartTab({ row }: { row: SongRow }) {
  const slots = useAppStore((s) => s.songSlots);
  const [snap, setSnap] = useState<SnapValue>('1/16');
  const [showSnapLines, setShowSnapLines] = useState(loadShowSnapLines);
  const [showNoteText, setShowNoteText] = useState(loadShowNoteText);

  const updateShowSnapLines = (show: boolean) => {
    setShowSnapLines(show);
    persistShowSnapLines(show);
  };

  const updateShowNoteText = (show: boolean) => {
    setShowNoteText(show);
    persistShowNoteText(show);
  };

  return (
    <div className="tk-chart-tab">
      <div className="tk-chart-editor">
        <SongHeader row={row} />
        <DiffTabs row={row} />
        <Toolbar
          snap={snap}
          showSnapLines={showSnapLines}
          showNoteText={showNoteText}
          onSnapChange={setSnap}
          onShowSnapLinesChange={updateShowSnapLines}
          onShowNoteTextChange={updateShowNoteText}
        />
        <div className="tk-canvas">
          <ChartBody
            row={row}
            slots={slots ?? []}
            noSlots={slots !== undefined && slots.length === 0}
            snap={snap}
            showSnapLines={showSnapLines}
            showNoteText={showNoteText}
          />
        </div>
      </div>
      <Inspector />
    </div>
  );
}

function ChartBody({
  row,
  slots,
  noSlots,
  snap,
  showSnapLines,
  showNoteText,
}: {
  row: SongRow;
  slots: FumenSlot[];
  noSlots: boolean;
  snap: SnapValue;
  showSnapLines: boolean;
  showNoteText: boolean;
}) {
  const fumen = useAppStore((s) => s.fumen);
  const locale = useAppStore((s) => s.ui.locale);
  const zoom = useAppStore((s) => s.ui.zoom);
  const noteScale = useAppStore((s) => s.ui.noteScale);
  const tool = useAppStore((s) => s.chart.tool);
  const branchFocus = useAppStore((s) => s.chart.branchFocus);
  const selectedNote = useAppStore((s) => s.chart.selectedNote);
  const selectedNotes = useAppStore((s) => s.chart.selectedNotes);
  const selectedMeasure = useAppStore((s) => s.chart.selectedMeasure);
  const selectFumen = useAppStore((s) => s.selectFumen);
  const selectChartNote = useAppStore((s) => s.selectChartNote);
  const selectChartNotes = useAppStore((s) => s.selectChartNotes);
  const selectChartMeasure = useAppStore((s) => s.selectChartMeasure);
  const placeChartNote = useAppStore((s) => s.placeChartNote);
  const eraseChartNote = useAppStore((s) => s.eraseChartNote);
  const setChartTool = useAppStore((s) => s.setChartTool);
  // Two distinct "empty" conditions: no charts on disk (nothing to pick) vs a
  // chart to pick but none loaded. They render different states.
  if (noSlots) return <ChartNoCharts />;
  switch (fumen.kind) {
    case 'idle':
      return (
        <ChartEmptyNoDiff
          row={row}
          title={preferredTitle(row, locale)}
          slots={slots}
          onPick={(d, p) => void selectFumen(d, p)}
        />
      );
    case 'loading':
      return <ChartLoading filename={fumen.slot.filename} />;
    case 'error':
      return (
        <ChartError
          songId={fumen.songId}
          filename={fumen.slot.filename}
          message={fumen.message}
          onRetry={() => void selectFumen(fumen.slot.difficulty, fumen.slot.player)}
        />
      );
    case 'ready':
      return (
        <ScoreCanvas
          fumen={fumen.loaded.fumen}
          snap={snap}
          showSnapLines={showSnapLines}
          showNoteText={showNoteText}
          zoom={zoom}
          noteScale={noteScale}
          tool={tool}
          branchFocus={branchFocus}
          selectedNote={selectedNote}
          selectedNotes={selectedNotes}
          selectedMeasure={selectedMeasure}
          onSelectNote={selectChartNote}
          onSelectNotes={selectChartNotes}
          onSelectMeasure={selectChartMeasure}
          onPlaceNote={placeChartNote}
          onEraseNote={eraseChartNote}
          onRequestSelectTool={() => setChartTool('select')}
        />
      );
  }
}
