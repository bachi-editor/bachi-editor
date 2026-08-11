// Chart-header properties, shown in the Inspector when nothing is selected
// (migrated from the old horizontal Properties drawer — Phase 8.5). Edits the
// loaded chart's typed 520-byte FumenHeader (codec/fumen/header.ts) through the
// normal fumen draft/save pipeline: the `hasBranches` flag (authoring a branch
// on a flat chart), soul-gauge / HP tuning, and branch scoring. The remaining
// fields are derived or chart-wide: `timingWindows` (set by difficulty),
// `measureCount` (calculated), and `dummyData` (the legacy-scoring score ceiling,
// calculated) show read-only. The chart-wide legacy score base/step (初項/公差) is
// read off the notes and editable on any chart that has notes — the ceiling
// recalculates from it (so a from-scratch chart stays editable after it's saved and
// reopened). `unknownData` is always 0 and is not shown. Laid out as a tight
// two-column grid to fit the narrow inspector rail. See codec/fumen/spec.md.

import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../model/store';
import { fumenIsBranched, type EditableHeaderIntKey } from '../../model/fumenEdits';
import { fumenKey } from '../../model/fumenDrafts';
import { readChartScoring } from '../../model/fumenScaffold';
import type { Fumen, FumenHeader } from '../../codec';
import { MessageKey, useT } from '../../i18n';
import { Disc } from './Disc';

type IntField = { key: EditableHeaderIntKey; labelKey: MessageKey };
type DirtyHeaderKey = EditableHeaderIntKey | 'hasBranches';

const GAUGE_FIELDS: IntField[] = [
  { key: 'hpMax', labelKey: 'chartprops.gaugeMax' },
  { key: 'hpClear', labelKey: 'chartprops.clearAt' },
  { key: 'hpGainGood', labelKey: 'chartprops.gainGood' },
  { key: 'hpGainOk', labelKey: 'chartprops.gainOk' },
  { key: 'hpLossBad', labelKey: 'chartprops.lossBad' },
];

const RATIO_FIELDS: IntField[] = [
  { key: 'normalNormalRatio', labelKey: 'branch.normal' },
  { key: 'normalProfessionalRatio', labelKey: 'branch.expert' },
  { key: 'normalMasterRatio', labelKey: 'branch.master' },
];

const BRANCH_PTS_FIELDS: IntField[] = [
  { key: 'branchPtsGood', labelKey: 'chartprops.ptsGood' },
  { key: 'branchPtsOk', labelKey: 'chartprops.ptsOk' },
  { key: 'branchPtsBad', labelKey: 'chartprops.ptsBad' },
  { key: 'branchPtsDrumroll', labelKey: 'chartprops.ptsDrumroll' },
  { key: 'branchPtsGoodBig', labelKey: 'chartprops.ptsGoodBig' },
  { key: 'branchPtsOkBig', labelKey: 'chartprops.ptsOkBig' },
  { key: 'branchPtsDrumrollBig', labelKey: 'chartprops.ptsDrumrollBig' },
  { key: 'branchPtsBalloon', labelKey: 'chartprops.ptsBalloon' },
  { key: 'branchPtsKusudama', labelKey: 'chartprops.ptsKusudama' },
  { key: 'branchPtsUnknown', labelKey: 'chartprops.ptsReserved' },
];

/** A small "diverges from baseline" dot. */
function Dot({ on }: { on: boolean }) {
  const t = useT();
  if (!on) return null;
  return <span className="tk-edit-dot" title={t('metadata.edited')} />;
}

function fieldDirty(header: FumenHeader, base: FumenHeader | undefined, key: DirtyHeaderKey): boolean {
  return base !== undefined && base[key] !== header[key];
}

function dirtyCount(header: FumenHeader, base: FumenHeader | undefined, keys: DirtyHeaderKey[]): number {
  return keys.reduce((count, key) => count + (fieldDirty(header, base, key) ? 1 : 0), 0);
}

function branchNoteCount(f: Fumen, idx: 1 | 2): number {
  let n = 0;
  for (const m of f.measures) n += m.branches[idx].notes.length;
  return n;
}

/** Read-only or editable numeric field for the chart-wide score base/step. Commits
 *  on blur / Enter (not per keystroke — each commit re-stamps every note). */
function ScoreField({
  label,
  value,
  min,
  sub,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  min: number;
  sub: string;
  onCommit?: (v: number) => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => setText(value === undefined ? '' : String(value)), [value]);
  const commit = () => {
    if (!onCommit || value === undefined) return;
    const v = Math.max(min, Math.round(Number(text)));
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <div className="tk-field">
      <label>{label}</label>
      {onCommit ? (
        <input
          className="tk-input"
          type="number"
          min={min}
          step={1}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        />
      ) : (
        <input className="tk-input" value={value === undefined ? '—' : String(value)} readOnly disabled />
      )}
      <div className="tk-meta-key" style={{ marginTop: 5 }}>{sub}</div>
    </div>
  );
}

function NumField({
  field,
  header,
  base,
  onChange,
}: {
  field: IntField;
  header: FumenHeader;
  base?: FumenHeader;
  onChange: (key: EditableHeaderIntKey, value: number) => void;
}) {
  const t = useT();
  const dirty = base !== undefined && base[field.key] !== header[field.key];
  return (
    <div className="tk-field">
      <label>{t(field.labelKey)} <Dot on={dirty} /></label>
      <input
        className="tk-input"
        type="number"
        step={1}
        value={header[field.key]}
        onChange={(e) => onChange(field.key, Number(e.currentTarget.value))}
      />
    </div>
  );
}

function ReadField({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tk-field">
      <label>{label}</label>
      <input className="tk-input" value={value} readOnly disabled />
      {sub && <div className="tk-meta-key" style={{ marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

export function ChartPropsCard() {
  const fumen = useAppStore((s) => s.fumen);
  const project = useAppStore((s) => s.project);
  const updateChartHeader = useAppStore((s) => s.updateChartHeader);
  const seedChartBranches = useAppStore((s) => s.seedChartBranches);
  const setChartScoring = useAppStore((s) => s.setChartScoring);
  const t = useT();

  const baseHeader = useMemo<FumenHeader | undefined>(() => {
    if (fumen.kind !== 'ready' || project.kind !== 'open') return undefined;
    const key = fumenKey(fumen.loaded.songId, fumen.loaded.filename);
    return project.project.fumenBaselines.get(key)?.fumen.header
      ?? project.project.fumenCreated.get(key)?.fumen.header;
  }, [fumen, project]);

  if (fumen.kind !== 'ready') return null;

  const f = fumen.loaded.fumen;
  const header = f.header;
  const branchOn = header.hasBranches !== 0;
  const eNotes = branchNoteCount(f, 1);
  const mNotes = branchNoteCount(f, 2);
  const branchedByNotes = eNotes > 0 || mNotes > 0;
  const normalNotes = f.measures.reduce((n, m) => n + m.branches[0].notes.length, 0);
  const canSeed = fumenIsBranched(f) && !branchedByNotes && normalNotes > 0;

  // Timing windows are 36 identical (良/GOOD, 可/OK, 不可/BAD) ms triples set by the
  // chart's difficulty — show the representative first triple, rounded (see
  // codec/fumen/spec.md).
  const tw = header.timingWindows;
  const twTriple = tw.length >= 3 ? `${tw[0].toFixed(0)} / ${tw[1].toFixed(0)} / ${tw[2].toFixed(0)} ms` : '—';
  const { base: scoreBase, step: scoreStep } = readChartScoring(f);
  // Editable on any chart that has notes to stamp — a saved-then-reopened
  // from-scratch chart must stay editable, and it's indistinguishable from a
  // shipped one once on disk. The ceiling recalculates from what you set.
  const scoringEditable = scoreBase !== undefined;

  const setInt = (key: EditableHeaderIntKey, value: number) => updateChartHeader({ [key]: value });
  const gaugeDirty = dirtyCount(header, baseHeader, GAUGE_FIELDS.map((field) => field.key));
  const scoringDirty = dirtyCount(
    header,
    baseHeader,
    [...RATIO_FIELDS, ...BRANCH_PTS_FIELDS].map((field) => field.key),
  );
  const branchesDirty = dirtyCount(header, baseHeader, ['hasBranches']);

  return (
    <>
      <Disc title={t('chartprops.branches')} count={branchesDirty} dirty={branchesDirty > 0} defaultOpen stateKey="chart:branches">
        <div className="tk-field" style={{ marginBottom: 10 }}>
          <label>{t('chartprops.branchedChart')} <Dot on={branchesDirty > 0} /></label>
          <div className="tk-seg" style={{ height: 35 }}>
            <button className={branchOn ? '' : 'on'} onClick={() => updateChartHeader({ hasBranches: 0 })}>{t('common.off')}</button>
            <button className={branchOn ? 'on' : ''} onClick={() => updateChartHeader({ hasBranches: 1 })}>{t('common.on')}</button>
          </div>
        </div>
        <div className="tk-note-sub" style={{ margin: 0 }}>
          {branchOn
            ? t('chartprops.branchCounts', { normal: normalNotes, expert: eNotes, master: mNotes })
              + (canSeed ? ' ' + t('chartprops.seedHint') : '')
            : t('chartprops.flatChart')}
          {!branchOn && branchedByNotes ? ' ' + t('chartprops.flagOffWarning') : ''}
        </div>
        {canSeed && (
          <button
            className="tk-btn tk-btn-sm"
            type="button"
            style={{ marginTop: 10, width: '100%' }}
            onClick={() => seedChartBranches()}
          >
            {t('chartprops.seedButton')}
          </button>
        )}
      </Disc>

      <Disc
        title={t('chartprops.soulGauge')}
        count={gaugeDirty}
        dirty={gaugeDirty > 0}
        defaultOpen={gaugeDirty > 0}
        stateKey="chart:soul-gauge"
      >
        <div className="tk-prop-grid">
          {GAUGE_FIELDS.map((field) => (
            <NumField key={field.key} field={field} header={header} base={baseHeader} onChange={setInt} />
          ))}
        </div>
      </Disc>

      <Disc
        title={t('chartprops.branchScoring')}
        count={scoringDirty}
        dirty={scoringDirty > 0}
        defaultOpen={scoringDirty > 0}
        stateKey="chart:branch-scoring"
      >
        <div className="tk-mini-label" style={{ marginBottom: 8 }}>{t('chartprops.ratios')}</div>
        <div className="tk-prop-grid">
          {RATIO_FIELDS.map((field) => (
            <NumField key={field.key} field={field} header={header} base={baseHeader} onChange={setInt} />
          ))}
        </div>

        <div className="tk-mini-label" style={{ margin: '4px 0 8px' }}>{t('chartprops.pointsPerHit')}</div>
        <div className="tk-prop-grid">
          {BRANCH_PTS_FIELDS.map((field) => (
            <NumField key={field.key} field={field} header={header} base={baseHeader} onChange={setInt} />
          ))}
        </div>
      </Disc>

      <Disc title={t('chartprops.scoringTiming')} stateKey="chart:scoring-timing">
        {/* Timing windows get a full-width row so the GOOD/OK/BAD triple isn't clipped. */}
        <ReadField label={t('chartprops.timingWindows')} value={twTriple} sub={t('chartprops.byDifficulty')} />
        <div className="tk-prop-grid" style={{ marginTop: 8 }}>
          <ReadField label={t('chartprops.measures')} value={String(header.measureCount)} sub={t('chartprops.calculated')} />
          <ReadField label={t('chartprops.scoreCeiling')} value={String(header.dummyData)} sub={t('chartprops.scoreCeilingSub')} />
        </div>
        {/* The legacy base score (初項) and step (公差) are chart-wide constants — a
            note carries them but they're not per-note, so they live here, not in the
            note inspector. Editable whenever the chart has notes; the ceiling recalculates. */}
        <div className="tk-prop-grid" style={{ marginTop: 8 }}>
          <ScoreField
            label={t('chartprops.baseScore')}
            value={scoreBase}
            min={1}
            sub={t('chartprops.chartWide')}
            onCommit={scoringEditable ? (v) => setChartScoring(v, scoreStep ?? 0) : undefined}
          />
          <ScoreField
            label={t('chartprops.scoreStep')}
            value={scoreStep}
            min={0}
            sub={t('chartprops.perTenCombo')}
            onCommit={scoringEditable ? (v) => setChartScoring(scoreBase ?? 1, v) : undefined}
          />
        </div>
      </Disc>
    </>
  );
}
