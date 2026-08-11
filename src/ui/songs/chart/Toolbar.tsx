import { ReactNode, useEffect } from 'react';
import { useAppStore } from '../../../model/store';
import type { ChartTool } from '../../../model/fumenEdits';
import { MessageKey, useT } from '../../../i18n';
import { SNAP_VALUES, type SnapValue } from '../../fumen/scoreLayout';
import { ScaleControls } from '../../fumen/ScaleControls';
import { Icon } from '../../shell/Icon';

const TOOLS: { k: string; code: string; id: ChartTool; labelKey: MessageKey; el: ReactNode }[] = [
  { k: '`', code: 'Backquote', id: 'select', labelKey: 'toolbar.select', el: <Icon name="select" /> },
  { k: '1', code: 'Digit1', id: 'don', labelKey: 'toolbar.smallDon', el: <span className="tk-swatch don" /> },
  { k: '2', code: 'Digit2', id: 'ka', labelKey: 'toolbar.smallKa', el: <span className="tk-swatch ka" /> },
  { k: '3', code: 'Digit3', id: 'donbig', labelKey: 'toolbar.bigDon', el: <span className="tk-swatch big donbig" /> },
  { k: '4', code: 'Digit4', id: 'kabig', labelKey: 'toolbar.bigKa', el: <span className="tk-swatch big kabig" /> },
  { k: '5', code: 'Digit5', id: 'roll', labelKey: 'toolbar.smallDrumroll', el: <span className="tk-swatch roll" /> },
  { k: '6', code: 'Digit6', id: 'rollbig', labelKey: 'toolbar.bigDrumroll', el: <span className="tk-swatch roll rollbig" /> },
  { k: '7', code: 'Digit7', id: 'balloon', labelKey: 'toolbar.smallBalloon', el: <span className="tk-swatch balloon" /> },
  { k: '8', code: 'Digit8', id: 'kusudama', labelKey: 'toolbar.bigBalloon', el: <span className="tk-swatch balloon kusudama" /> },
  { k: 'd', code: 'KeyD', id: 'eraser', labelKey: 'toolbar.eraser', el: <Icon name="eraser" /> },
];

interface ToolbarProps {
  snap: SnapValue;
  showSnapLines: boolean;
  showNoteText: boolean;
  onSnapChange: (snap: SnapValue) => void;
  onShowSnapLinesChange: (show: boolean) => void;
  onShowNoteTextChange: (show: boolean) => void;
}

export function Toolbar({
  snap,
  showSnapLines,
  showNoteText,
  onSnapChange,
  onShowSnapLinesChange,
  onShowNoteTextChange,
}: ToolbarProps) {
  const tool = useAppStore((s) => s.chart.tool);
  const setChartTool = useAppStore((s) => s.setChartTool);
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) return;
      const next = TOOLS.find((t) => t.code === e.code);
      if (!next) return;
      e.preventDefault();
      // A previously *clicked* tool button keeps DOM focus (and its focus ring),
      // which would linger as a second highlight next to the newly selected
      // tool's `.on` border. Drop focus so only the active tool reads as selected.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.classList.contains('tk-tool')) active.blur();
      setChartTool(next.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setChartTool]);

  return (
    <div className="tk-toolbar">
      <div className="tk-tools">
        {TOOLS.map((tl) => (
          <button
            type="button"
            key={tl.id}
            className={'tk-tool' + (tl.id === tool ? ' on' : '')}
            title={`${t(tl.labelKey)} (${tl.k})`}
            onClick={() => setChartTool(tl.id)}
          >
            <span className="tk-tnum">{tl.k}</span>
            {tl.el}
          </button>
        ))}
      </div>
      <div className="tk-tooldiv" />
      <div className="tk-snap">
        <span>{t('toolbar.snap')}</span>
        <select
          className="tk-mini-select"
          value={snap}
          onChange={(e) => onSnapChange(e.currentTarget.value as SnapValue)}
        >
          {SNAP_VALUES.map((value) => <option key={value}>{value}</option>)}
        </select>
      </div>
      <label className="tk-snap tk-check">
        <input
          type="checkbox"
          checked={showSnapLines}
          onChange={(e) => onShowSnapLinesChange(e.currentTarget.checked)}
        />
        <span>{t('toolbar.showSnapLines')}</span>
      </label>
      <label className="tk-snap tk-check" title={t('toolbar.showNoteTextTitle')}>
        <input
          type="checkbox"
          checked={showNoteText}
          onChange={(e) => onShowNoteTextChange(e.currentTarget.checked)}
        />
        <span>{t('toolbar.showNoteText')}</span>
      </label>
      <ScaleControls />
    </div>
  );
}
