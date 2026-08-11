import { Fragment, useState } from 'react';
import { useAppStore } from '../../model/store';
import type { Fumen } from '../../codec';
import { DRUMROLL_NOTE_TYPES, fumenNoteTypeLabel } from '../../codec';
import {
  canEditMeasureDuration,
  fumenIsBranched,
  getChartNote,
  isBranchPoint,
  isLongNoteType,
  measureOverflowCount,
  NOTE_TYPE_CHOICES,
  CLEARED_BRANCH_INFO,
  DEFAULT_BRANCH_INFO,
  type BranchInfo,
  type ChartNoteRef,
  type ChartMeasureRef,
  type SpeedTarget,
} from '../../model/fumenEdits';
import { beatMs, measureDurationAt, measureTimings } from '../../model/fumenTiming';
import type { FumenMeasure } from '../../codec';
import { MessageKey, TFn, useT } from '../../i18n';
import { Icon } from './Icon';
import { ChartPropsCard } from './ChartPropsCard';
import { Disc } from './Disc';

const BALLOON_TYPES = new Set<number>([0xa, 0xc]);
const BRANCH_LABEL_KEYS: MessageKey[] = ['branch.normal', 'branch.expert', 'branch.master'];
// Every editable note type (shared with the placement model so the dropdown can
// never silently drop a type — covered by test/model/fumen-edits.test.ts).
const NOTE_TYPE_OPTIONS = NOTE_TYPE_CHOICES;

// The 6 branch thresholds decode as transition pairs (confirmed against the
// corpus): each "from" branch carries its own [→Expert, →Master] requirement.
// The raw threshold count (drumroll hits vs accuracy gauge) is chart-defined and
// edited here as plain integers; -1 means "no requirement / not a branch point".
const BRANCH_ROWS: { fromBranch: 0 | 1 | 2; adv: number; mas: number }[] = [
  { fromBranch: 0, adv: 0, mas: 1 },
  { fromBranch: 1, adv: 2, mas: 3 },
  { fromBranch: 2, adv: 4, mas: 5 },
];

function BranchMatrix({
  measure,
  onChange,
}: {
  measure: FumenMeasure;
  onChange: (next: BranchInfo) => void;
}) {
  const t = useT();
  const bi = measure.branchInfo;
  const active = isBranchPoint(measure);

  const setAt = (idx: number, value: number) => {
    const next = bi.slice() as BranchInfo;
    next[idx] = Number.isFinite(value) ? Math.round(value) : -1;
    onChange(next);
  };

  return (
    <>
      {!active ? (
        <div className="tk-branch-empty">
          <div className="tk-note-sub">
            {t('inspector.notBranchPoint')}
          </div>
          <button
            className="tk-btn tk-btn-sm tk-wide"
            type="button"
            onClick={() => onChange(DEFAULT_BRANCH_INFO.slice() as BranchInfo)}
          >
            {t('inspector.makeBranchPoint')}
          </button>
        </div>
      ) : (
        <>
          <div className="tk-matrix">
            <span className="corner" />
            <span className="col">{t('inspector.toExpert')}</span>
            <span className="col">{t('inspector.toMaster')}</span>
            {BRANCH_ROWS.map((row) => (
              <Fragment key={row.fromBranch}>
                <span className="row-h">{t('inspector.fromBranch', { branch: t(BRANCH_LABEL_KEYS[row.fromBranch]) })}</span>
                <input
                  className={bi[row.adv] < 0 ? 'none' : undefined}
                  type="number"
                  step={1}
                  value={bi[row.adv]}
                  onChange={(e) => setAt(row.adv, Number(e.currentTarget.value))}
                />
                <input
                  className={bi[row.mas] < 0 ? 'none' : undefined}
                  type="number"
                  step={1}
                  value={bi[row.mas]}
                  onChange={(e) => setAt(row.mas, Number(e.currentTarget.value))}
                />
              </Fragment>
            ))}
          </div>
          <div className="tk-inh-note">
            {t('inspector.branchThresholdNote')}
          </div>
          <button
            className="tk-btn tk-btn-sm tk-btn-danger tk-wide tk-branch-clear"
            type="button"
            onClick={() => onChange(CLEARED_BRANCH_INFO.slice() as BranchInfo)}
          >
            {t('inspector.clearBranchPoint')}
          </button>
        </>
      )}
    </>
  );
}

/**
 * The Measure card (Phase 11): direct editing of every measure/branch-level
 * field for the selected measure — derived timing (read-only), BPM + per-branch
 * scroll speed (with the "changes here" override), GO-GO / barline toggles, and
 * the branch condition. Keyed by measure+branch in the parent so the override
 * arming state resets when the selection moves.
 */
function MeasureCard({ fumen, refMeasure }: { fumen: Fumen; refMeasure: ChartMeasureRef }) {
  const i = refMeasure.measureIndex;
  const measure = fumen.measures[i];
  const setMeasureBpm = useAppStore((s) => s.setMeasureBpm);
  const setMeasureSpeed = useAppStore((s) => s.setMeasureSpeed);
  const setMeasureGogo = useAppStore((s) => s.setMeasureGogo);
  const setMeasureBarline = useAppStore((s) => s.setMeasureBarline);
  const setMeasureBranchInfo = useAppStore((s) => s.setMeasureBranchInfo);
  const t = useT();
  if (!measure) return null;

  const prev = i > 0 ? fumen.measures[i - 1] : undefined;
  const branched = fumenIsBranched(fumen);
  const { durations, starts, derived } = measureTimings(fumen);
  const durationMs = durations[i];
  const startMs = starts[i];
  const beatLengthMs = beatMs(measure.bpm);
  const beats = durationMs / beatLengthMs;
  const isLast = i === fumen.measures.length - 1;
  const scopeLabel =
    refMeasure.branchIndex !== undefined
      ? t('inspector.stave', { branch: t(BRANCH_LABEL_KEYS[refMeasure.branchIndex]) })
      : t('inspector.allBranches');

  const editable = canEditMeasureDuration(fumen, i);
  const timingNote = isLast
    ? t('inspector.timingLast')
    : derived
      ? ''
      : t('inspector.timingFallback');

  // Scroll speed is stored per branch in the fumen — there is no unified field —
  // so a branched chart always exposes all three Normal/Expert/Master rows, even
  // when the branches currently match. A focused branch narrows to its one stave.
  const speedFields: { key: string; label: string; target: SpeedTarget; branch: 0 | 1 | 2 }[] = [];
  if (refMeasure.branchIndex !== undefined) {
    const b = refMeasure.branchIndex;
    speedFields.push({ key: `spd-${b}`, label: t('inspector.scrollLabel', { branch: t(BRANCH_LABEL_KEYS[b]) }), target: b, branch: b });
  } else if (branched) {
    for (let b = 0; b < 3; b++) {
      speedFields.push({ key: `spd-${b}`, label: t('inspector.scrollLabel', { branch: t(BRANCH_LABEL_KEYS[b]) }), target: b as 0 | 1 | 2, branch: b as 0 | 1 | 2 });
    }
  } else {
    speedFields.push({ key: 'spd-0', label: t('inspector.scrollSpeed'), target: 0, branch: 0 });
  }
  const speedRows = speedFields.map((f) => ({
    ...f,
    value: measure.branches[f.branch].speed,
    inheritedFrom: prev ? prev.branches[f.branch].speed : undefined,
    changed: !!prev && measure.branches[f.branch].speed !== prev.branches[f.branch].speed,
  }));
  const bpmChanged = !!prev && measure.bpm !== prev.bpm;
  const scrollChanged = speedRows.some((f) => f.changed);
  const branchActive = isBranchPoint(measure);

  return (
    <>
      <div className="tk-insp-section">{t('inspector.measureHeading', { n: String(i + 1).padStart(2, '0'), scope: scopeLabel })}</div>
      <div className="tk-note-sub tk-measure-subhead">
        {t('inspector.measureSubhead', { start: fmtMs(startMs), perBeat: beatLengthMs.toFixed(1) })}
      </div>

      <Disc title={t('inspector.timing')} defaultOpen stateKey="measure:timing">
        {editable.ok ? (
          <DurationEditor
            key={`dur-${i}`}
            fumen={fumen}
            measureIndex={i}
            durationMs={durationMs}
            beatLengthMs={beatLengthMs}
            startMs={startMs}
          />
        ) : (
          <div className="tk-row2">
            <div className="tk-field">
              <label>{t('inspector.length')}</label>
              <input className="tk-input" value={`${beats.toFixed(2)} beat`} readOnly disabled />
            </div>
            <div className="tk-field">
              <label>{t('inspector.duration')}</label>
              <input className="tk-input" value={fmtMs(durationMs)} readOnly disabled />
            </div>
          </div>
        )}
        <div className="tk-note-sub tk-measure-meta">
          <div>{t('inspector.offsetStored')} <b>{Math.round(measure.offset)} ms</b></div>
        </div>
        {(editable.ok ? timingNote : editable.reason) && (
          <div className="tk-inh-note tk-measure-note">
            {editable.ok ? timingNote : editable.reason}
          </div>
        )}
      </Disc>

      <Disc
        title={t('inspector.bpmScroll')}
        dirty={bpmChanged || scrollChanged}
        defaultOpen
        stateKey="measure:bpm-scroll"
      >
        <OverrideValueRow
          key="bpm"
          label="BPM"
          value={measure.bpm}
          inheritedFrom={prev ? prev.bpm : undefined}
          changed={bpmChanged}
          min={1}
          step={0.01}
          onSet={(v) => setMeasureBpm(i, true, v)}
          onReset={() => setMeasureBpm(i, false)}
        />
        {speedRows.map((f) => (
          <OverrideValueRow
            key={f.key}
            label={f.label}
            value={f.value}
            inheritedFrom={f.inheritedFrom}
            changed={f.changed}
            min={0.001}
            step={0.01}
            unit="x"
            onSet={(v) => setMeasureSpeed(i, f.target, true, v)}
            onReset={() => setMeasureSpeed(i, f.target, false)}
          />
        ))}
        <div className="tk-inh-note">
          {prev
            ? t('inspector.inheritedNote', { n: String(i).padStart(2, '0') })
            : t('inspector.baseValuesNote')}
        </div>
      </Disc>

      <Disc title={t('inspector.flags')} stateKey="measure:flags">
        <div className="tk-row2">
          <div className="tk-field tk-field-tight">
            <label>GO-GO</label>
            <Seg on={!!measure.gogo} onChange={(on) => setMeasureGogo(i, on)} />
          </div>
          <div className="tk-field tk-field-tight">
            <label>{t('inspector.barline')}</label>
            <Seg on={!!measure.barline} onChange={(on) => setMeasureBarline(i, on)} />
          </div>
        </div>
      </Disc>

      {branched && (
        <Disc title={t('inspector.branchPoint')} dirty={branchActive} defaultOpen stateKey="measure:branch-point">
          <BranchMatrix measure={measure} onChange={(bi) => setMeasureBranchInfo(i, bi)} />
        </Disc>
      )}
      <div style={{ height: 16 }} />
    </>
  );
}

/** Common measure-length presets, in beats, laid out as two rows (Phase 12.3). */
const DURATION_PRESET_ROWS: { label: string; beats: number }[][] = [
  [
    { label: '¼', beats: 1 / 4 },
    { label: '⅓', beats: 1 / 3 },
    { label: '½', beats: 1 / 2 },
    { label: '⅔', beats: 2 / 3 },
    { label: '¾', beats: 3 / 4 },
  ],
  [
    { label: '1', beats: 1 },
    { label: '2', beats: 2 },
    { label: '3', beats: 3 },
    { label: '4', beats: 4 },
  ],
];

/**
 * Editable measure-duration controls (Phase 12.3). Length is shown in both beats
 * and milliseconds, with preset beat buttons and a live "next boundary" preview.
 * A length edit ripples downstream offsets (`setMeasureDuration`); shrinking past
 * existing note heads is intercepted with a Scale-or-cancel prompt (Phase 12.6),
 * so notes are never silently rescaled. Commits on blur/Enter (and preset click),
 * matching the BPM/scroll fields' commit cadence.
 */
function DurationEditor({
  fumen,
  measureIndex,
  durationMs,
  beatLengthMs,
  startMs,
}: {
  fumen: Fumen;
  measureIndex: number;
  durationMs: number;
  beatLengthMs: number;
  startMs: number;
}) {
  const setMeasureDuration = useAppStore((s) => s.setMeasureDuration);
  const t = useT();
  const [pending, setPending] = useState<{ ms: number; overflow: number } | null>(null);
  const [beatsBuf, setBeatsBuf] = useState<string | null>(null);
  const [msBuf, setMsBuf] = useState<string | null>(null);

  const beats = durationMs / beatLengthMs;

  const apply = (newMs: number, policy: 'block' | 'scale' = 'block') => {
    if (!Number.isFinite(newMs) || newMs < 1) return;
    if (Math.abs(newMs - durationMs) < 1e-6) return;
    if (policy === 'block' && newMs < durationMs) {
      const overflow = measureOverflowCount(fumen, measureIndex, newMs);
      if (overflow > 0) {
        setPending({ ms: newMs, overflow });
        return;
      }
    }
    setPending(null);
    setMeasureDuration(measureIndex, newMs, policy);
  };

  const commitBeats = () => {
    if (beatsBuf === null) return;
    const v = Number(beatsBuf);
    setBeatsBuf(null);
    if (Number.isFinite(v) && v > 0) apply(v * beatLengthMs);
  };
  const commitMs = () => {
    if (msBuf === null) return;
    const v = Number(msBuf);
    setMsBuf(null);
    if (Number.isFinite(v) && v > 0) apply(v);
  };

  const previewMs =
    beatsBuf !== null ? Number(beatsBuf) * beatLengthMs : msBuf !== null ? Number(msBuf) : null;
  const showPreview =
    previewMs !== null && Number.isFinite(previewMs) && previewMs > 0 && Math.abs(previewMs - durationMs) > 1e-6;

  return (
    <>
      <div className="tk-row2 tk-linked-row">
        <div className="tk-field">
          <label>{t('inspector.lengthBeats')}</label>
          <input
            className="tk-input"
            type="number"
            min={0.01}
            step={0.25}
            value={beatsBuf ?? fieldNumber(beats)}
            onFocus={() => setBeatsBuf(fieldNumber(beats))}
            onChange={(e) => setBeatsBuf(e.currentTarget.value)}
            onBlur={commitBeats}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
        </div>
        <div
          className="tk-field-link"
          aria-hidden="true"
          title={t('inspector.linkTitle')}
        >
          <Icon name="link" size={14} />
        </div>
        <div className="tk-field">
          <label>{t('inspector.lengthMs')}</label>
          <input
            className="tk-input"
            type="number"
            min={1}
            step={1}
            value={msBuf ?? String(Math.round(durationMs))}
            onFocus={() => setMsBuf(String(Math.round(durationMs)))}
            onChange={(e) => setMsBuf(e.currentTarget.value)}
            onBlur={commitMs}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
        </div>
      </div>
      <div className="tk-preset-rows">
        {DURATION_PRESET_ROWS.map((row, ri) => (
          <div className="tk-preset-row" key={ri}>
            {row.map((p) => (
              <button
                key={p.label}
                type="button"
                className={'tk-preset' + (Math.abs(beats - p.beats) < 0.01 ? ' on' : '')}
                onClick={() => apply(p.beats * beatLengthMs)}
                title={t(p.beats === 1 ? 'inspector.presetTitle.one' : 'inspector.presetTitle.other', { label: p.label, ms: Math.round(p.beats * beatLengthMs) })}
              >
                {p.label}
              </button>
            ))}
          </div>
        ))}
      </div>
      {showPreview && (
        <div className="tk-note-sub" style={{ marginTop: 4 }}>
          {t('inspector.nextBoundary', { ms: fmtMs(startMs + (previewMs as number)) })}
        </div>
      )}
      {pending && (
        <div className="tk-dur-warn">
          <div className="tk-note-sub">
            {t(pending.overflow === 1 ? 'inspector.overflowWarn.one' : 'inspector.overflowWarn.other', { n: pending.overflow })}
          </div>
          <div className="tk-dur-warn-actions">
            <button
              type="button"
              className="tk-mini-btn primary"
              title={t('inspector.scaleTitle')}
              onClick={() => { setMeasureDuration(measureIndex, pending.ms, 'scale'); setPending(null); }}
            >
              {t('inspector.scale')}
            </button>
            <button
              type="button"
              className="tk-mini-btn"
              title={t('inspector.truncateTitle')}
              onClick={() => { setMeasureDuration(measureIndex, pending.ms, 'truncate'); setPending(null); }}
            >
              {t('inspector.truncate')}
            </button>
            <button type="button" className="tk-mini-btn" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

interface ChartStats {
  notes: number;
  measures: number;
  drumrolls: number;
  balloons: number;
}

function chartStats(f: Fumen): ChartStats {
  let notes = 0, drumrolls = 0, balloons = 0;
  for (const m of f.measures) {
    for (const b of m.branches) {
      for (const n of b.notes) {
        notes++;
        if (DRUMROLL_NOTE_TYPES.has(n.type)) drumrolls++;
        if (BALLOON_TYPES.has(n.type)) balloons++;
      }
    }
  }
  return { notes, measures: f.measures.length, drumrolls, balloons };
}

function selectedMeasureLine(f: Fumen, ref: ChartNoteRef, t: TFn): string {
  const measure = f.measures[ref.measureIndex];
  const note = getChartNote(f, ref);
  if (!measure || !note) return t('inspector.noNoteSelected');
  const beat = (note.position / measureDurationAt(f, ref.measureIndex)) * 4;
  return t('inspector.noteLine', {
    n: String(ref.measureIndex + 1).padStart(2, '0'),
    beat: beat.toFixed(2),
    hex: `0x${note.type.toString(16)}`,
  });
}

function fieldNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function fmtMs(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  return `${Math.round(ms)} ms`;
}

/** An On/Off segmented control (the measure-local GO-GO / barline toggles). */
function Seg({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  const t = useT();
  return (
    <div className="tk-seg" style={{ height: 35 }}>
      <button type="button" className={!on ? 'on' : ''} onClick={() => onChange(false)}>{t('common.off')}</button>
      <button type="button" className={on ? 'on' : ''} onClick={() => onChange(true)}>{t('common.on')}</button>
    </div>
  );
}

/**
 * Compact inherited/override value row for BPM and scroll. A dashed row is
 * currently inheriting from the previous measure; editing the numeric value
 * commits through the existing override transform, and the reset button copies
 * the previous measure back.
 */
function OverrideValueRow({
  label,
  value,
  inheritedFrom,
  changed,
  min,
  step,
  unit,
  onSet,
  onReset,
}: {
  label: string;
  value: number;
  /** The previous measure's value to inherit; undefined ⇒ base mode (measure 0). */
  inheritedFrom?: number;
  changed: boolean;
  min: number;
  step: number;
  unit?: string;
  onSet: (value: number) => void;
  onReset: () => void;
}) {
  const t = useT();
  const [buffer, setBuffer] = useState<string | null>(null);
  const isBase = inheritedFrom === undefined;
  const displayValue = isBase || changed ? value : inheritedFrom;
  const state = isBase ? 'base' : changed ? 'ovr' : 'inh';

  const handleChange = (raw: string) => {
    setBuffer(raw);
    if (raw.trim() === '') return;
    const next = Number(raw);
    if (Number.isFinite(next)) onSet(next);
  };

  return (
    <div className={`tk-ovl ${state}`}>
      <span className="k">{label}</span>
      <span className="tk-ovl-value">
        <input
          className="v"
          type="number"
          min={min}
          step={step}
          value={buffer ?? fieldNumber(displayValue)}
          title={state === 'inh' ? t('inspector.inheritedTitle') : undefined}
          onFocus={() => setBuffer(fieldNumber(displayValue))}
          onChange={(e) => handleChange(e.currentTarget.value)}
          onBlur={() => setBuffer(null)}
        />
        {unit && <span className="unit">{unit}</span>}
      </span>
      {changed && !isBase ? (
        <button className="reset" type="button" title={t('inspector.resetToInherited')} onClick={onReset}>
          <Icon name="reset" />
        </button>
      ) : (
        <button className="reset ph" type="button" aria-hidden="true" tabIndex={-1}>
          <Icon name="reset" />
        </button>
      )}
    </div>
  );
}

export function Inspector() {
  const fumen = useAppStore((s) => s.fumen);
  const difficulty = useAppStore((s) => s.selection.difficulty);
  const selectedRef = useAppStore((s) => s.chart.selectedNote);
  const selectedRefs = useAppStore((s) => s.chart.selectedNotes);
  const selectedMeasureRef = useAppStore((s) => s.chart.selectedMeasure);
  const updateSelected = useAppStore((s) => s.updateSelectedChartNote);
  const eraseChartNote = useAppStore((s) => s.eraseChartNote);
  const eraseSelected = useAppStore((s) => s.eraseSelectedChartNotes);
  const t = useT();
  const diffLabel = t(`metadata.difficulty.${difficulty}` as MessageKey);
  const stats = fumen.kind === 'ready' ? chartStats(fumen.loaded.fumen) : undefined;
  const selectedNote = fumen.kind === 'ready' ? getChartNote(fumen.loaded.fumen, selectedRef) : undefined;
  const selectedNoteMeasure = fumen.kind === 'ready' && selectedRef ? fumen.loaded.fumen.measures[selectedRef.measureIndex] : undefined;
  const selectedNoteMeasureDuration =
    fumen.kind === 'ready' && selectedRef ? measureDurationAt(fumen.loaded.fumen, selectedRef.measureIndex) : undefined;

  // What the body shows is mutually exclusive: a live selection (multi/note/
  // measure) takes over the rail; with nothing selected we fall back to the
  // chart-header properties plus the compact stats block. The note-type legend
  // lives inside ChartPropsCard's accordion in the properties view. (These
  // selection refs are only set when the fumen is ready.)
  const hasMulti = !!(selectedRefs && selectedRefs.length > 1);
  const hasNote = !!(selectedRef && selectedNote && selectedNoteMeasure);
  const hasMeasure = !!(selectedMeasureRef && !selectedNote && !hasMulti);
  const showProps = !hasMulti && !hasNote && !hasMeasure;

  return (
    <aside className="tk-inspector">
      <div className="tk-insp-head">
        <h3>{t('inspector.title')}</h3>
        <div className="sub">
          {stats ? t('inspector.diffChart', { diff: diffLabel }) : t('inspector.noChartLoaded')}
        </div>
      </div>
      <div className="tk-insp-body">
        {fumen.kind === 'ready' && selectedRefs && selectedRefs.length > 1 && (
          <>
            <div className="tk-insp-section">{t('inspector.selection')}</div>
            <div className="tk-note-card">
              <div className="tk-note-title">{t('inspector.notesSelected', { n: selectedRefs.length })}</div>
              <div className="tk-note-sub">{t('inspector.marqueeHint')}</div>
              <button className="tk-btn tk-btn-sm tk-btn-danger" type="button" onClick={() => eraseSelected()}>
                {t('inspector.deleteNotes', { n: selectedRefs.length })}
              </button>
            </div>
            <div style={{ height: 16 }} />
          </>
        )}

        {fumen.kind === 'ready' && selectedRef && selectedNote && selectedNoteMeasure && (
          <>
            <div className="tk-insp-section">{t('inspector.note')}</div>
            <div className="tk-note-card">
              <div className="tk-note-title">{selectedMeasureLine(fumen.loaded.fumen, selectedRef, t)}</div>
              <div className="tk-note-sub">{t('inspector.noteBranchIndex', { branch: t(BRANCH_LABEL_KEYS[selectedRef.branchIndex]), n: selectedRef.noteIndex + 1 })}</div>

              <div className="tk-field">
                <label>{t('inspector.type')}</label>
                <select
                  className="tk-input"
                  value={selectedNote.type}
                  onChange={(e) => updateSelected({ type: Number(e.currentTarget.value) })}
                >
                  {/* A selected special/unknown type (e.g. the wii5op 0x0e+ notes)
                      isn't in the authorable list — show its real label as the
                      current value so it's preserved unless explicitly changed. */}
                  {!NOTE_TYPE_OPTIONS.some((opt) => opt.value === selectedNote.type) && (
                    <option value={selectedNote.type}>{t('inspector.notePreserved', { label: fumenNoteTypeLabel(selectedNote.type) })}</option>
                  )}
                  {NOTE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* Position (paired with Duration for long notes). The legacy base
                  score (scoreInit) is a chart-wide constant, not per-note, so it's
                  shown read-only in Chart properties — not editable here. Balloons
                  are the one exception: their scoreInit is the per-note hit count,
                  edited via the Balloon count field below. */}
              <div className="tk-row2">
                <div className="tk-field">
                  <label>{t('inspector.positionMs')}</label>
                  <input
                    className="tk-input"
                    type="number"
                    min={0}
                    max={selectedNoteMeasureDuration === undefined ? undefined : Math.round(selectedNoteMeasureDuration)}
                    step={1}
                    value={fieldNumber(selectedNote.position)}
                    onChange={(e) => updateSelected({ position: Number(e.currentTarget.value) })}
                  />
                </div>
                {isLongNoteType(selectedNote.type) && (
                  <div className="tk-field">
                    <label>{t('inspector.durationMs')}</label>
                    <input
                      className="tk-input"
                      type="number"
                      min={1}
                      step={1}
                      value={fieldNumber(selectedNote.duration)}
                      onChange={(e) => updateSelected({ duration: Number(e.currentTarget.value) })}
                    />
                  </div>
                )}
              </div>

              {BALLOON_TYPES.has(selectedNote.type) && (
                <div className="tk-field">
                  <label>{t('inspector.balloonCount')}</label>
                  <input
                    className="tk-input"
                    type="number"
                    min={1}
                    step={1}
                    value={selectedNote.scoreInit}
                    onChange={(e) => updateSelected({ scoreInit: Number(e.currentTarget.value) })}
                  />
                </div>
              )}

              <button className="tk-btn tk-btn-sm tk-btn-danger" type="button" onClick={() => eraseChartNote(selectedRef)}>
                {t('inspector.deleteNote')}
              </button>
            </div>
            <div style={{ height: 16 }} />
          </>
        )}

        {fumen.kind === 'ready' && selectedMeasureRef && !selectedNote && !(selectedRefs && selectedRefs.length > 1) && (
          <MeasureCard
            key={`${selectedMeasureRef.measureIndex}:${selectedMeasureRef.branchIndex ?? 'all'}`}
            fumen={fumen.loaded.fumen}
            refMeasure={selectedMeasureRef}
          />
        )}

        {showProps && (
          <>
            <div className="tk-insp-section">{t('inspector.chartStats', { diff: diffLabel })}</div>
            <div className="tk-stat-grid tk-stat-grid-compact">
              <div className="tk-stat"><div className="v">{stats?.notes ?? '—'}</div><div className="k">{t('inspector.totalNotes')}</div></div>
              <div className="tk-stat"><div className="v">{stats?.measures ?? '—'}</div><div className="k">{t('chartprops.measures')}</div></div>
              <div className="tk-stat"><div className="v">{stats?.drumrolls ?? '—'}</div><div className="k">{t('inspector.drumrolls')}</div></div>
              <div className="tk-stat"><div className="v">{stats?.balloons ?? '—'}</div><div className="k">{t('inspector.balloons')}</div></div>
            </div>

            <div style={{ height: 16 }} />
            <ChartPropsCard />
          </>
        )}
      </div>
    </aside>
  );
}
