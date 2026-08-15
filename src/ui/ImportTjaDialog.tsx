import { useEffect, useMemo, useRef, useState } from 'react';
import type { MessageKey } from '../i18n';
import { useT } from '../i18n';
import type { FumenDifficulty, FumenPlayer, FumenSlot } from '../fs/fumens';
import { readNus3BankDemoStartMs } from '../codec';
import { readSoundBankBytes, resolveSoundFile } from '../fs/sound';
import { useAppStore } from '../model/store';
import { hasAudioFile, LOCALES, songStars, type SongRow } from '../model/songlist';
import { formatSeconds, soundMetadataKey } from '../model/soundMetadata';
import { CHART_METADATA_FIELDS, summarizeFumenMetadata } from '../model/fumenMetadata';
import {
  DEFAULT_TJA_IMPORT_OPTIONS,
  SHINUTI_FIELDS,
  SHINUTI_SCORE_FIELDS,
  convertTjaForImport,
  decodeTjaBytes,
  importChartSlot,
  shinutiPatch,
  summarizeImportedChart,
  type ShinutiField,
  type TjaImportChart,
  type TjaImportOptions,
  type TjaImportResult,
  type TjaImportWarningCode,
} from '../model/tjaImport';
import { Icon } from './shell/Icon';
import { PartHeader } from './shell/PartHeader';

// The parts the user last chose to import. Remembered (best-effort localStorage)
// so a repeated workflow — charts only, say — survives reopening the dialog and
// the app. Anything unreadable falls back to importing everything.
const IMPORT_PARTS_STORAGE_KEY = 'tk-tja-import-parts';

function loadImportOptions(): TjaImportOptions {
  try {
    const raw = localStorage.getItem(IMPORT_PARTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<TjaImportOptions>;
      return {
        metadata: parsed.metadata !== false,
        charts: parsed.charts !== false,
        demoStart: parsed.demoStart !== false,
      };
    }
  } catch {
    // ignore — fall through to the all-on default
  }
  return DEFAULT_TJA_IMPORT_OPTIONS;
}

function persistImportOptions(options: TjaImportOptions): void {
  try {
    localStorage.setItem(IMPORT_PARTS_STORAGE_KEY, JSON.stringify(options));
  } catch {
    // ignore — persistence is best-effort
  }
}

/**
 * The demo start is the one imported value that lives in the sound bank, so the
 * preview has to look at sound/<song>.nus3bank rather than the datatables: what
 * it holds now, and whether it can hold one at all.
 */
type DemoStartProbe =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; currentMs: number }
  /** No bank on disk, or a bank whose TONE record carries no demo-start field. */
  | { kind: 'unsupported' };

const DIFFICULTY_KEYS: Record<FumenDifficulty, MessageKey> = {
  easy: 'metadata.difficulty.easy',
  normal: 'metadata.difficulty.normal',
  hard: 'metadata.difficulty.hard',
  oni: 'metadata.difficulty.oni',
  ura: 'metadata.difficulty.ura',
};

const PLAYER_KEYS: Record<FumenPlayer, MessageKey> = {
  single: 'chartslot.solo',
  p1: 'chartslot.p1',
  p2: 'chartslot.p2',
};

const WARNING_KEYS: Record<TjaImportWarningCode, MessageKey> = {
  'missing-offset': 'importtja.warning.missingOffset',
  'special-course': 'importtja.warning.specialCourse',
  'ignored-command': 'importtja.warning.ignoredCommand',
  'invalid-note': 'importtja.warning.invalidNote',
  'branch-padded': 'importtja.warning.branchPadded',
  'balloon-defaulted': 'importtja.warning.balloonDefaulted',
  'orphan-roll-end': 'importtja.warning.orphanRollEnd',
  'overlapping-long-note': 'importtja.warning.overlappingLongNote',
  'duplicate-course': 'importtja.warning.duplicateCourse',
  'invalid-value': 'importtja.warning.invalidValue',
};

interface SelectedTja {
  fileName: string;
  imported: TjaImportResult;
}

interface MetadataChange {
  key: string;
  label: string;
  from: string | number;
  to: string | number;
}

function shinutiLabel(field: ShinutiField): MessageKey {
  if (field.startsWith('shinutiScore')) {
    return field.endsWith('Duet') ? 'metadata.targetScoreDuet' : 'metadata.targetScore';
  }
  return field.endsWith('Duet') ? 'metadata.baseScoreDuet' : 'metadata.baseScore';
}

function metadataChanges(row: SongRow, imported: TjaImportResult, t: ReturnType<typeof useT>): MetadataChange[] {
  const changes: MetadataChange[] = [];
  for (const locale of LOCALES) {
    const title = imported.title[locale.value];
    if (row.titles.title[locale.value] !== title) {
      changes.push({
        key: `title:${locale.value}`,
        label: `${t('metadata.title')} · ${locale.label}`,
        from: row.titles.title[locale.value] || '—',
        to: title || '—',
      });
    }
    const subtitle = imported.subtitle[locale.value];
    if (row.titles.subtitle[locale.value] !== subtitle) {
      changes.push({
        key: `subtitle:${locale.value}`,
        label: `${t('metadata.subtitle')} · ${locale.label}`,
        from: row.titles.subtitle[locale.value] || '—',
        to: subtitle || '—',
      });
    }
  }

  const currentStars = songStars(row);
  const importedLevels = new Map<FumenDifficulty, number>();
  for (const chart of imported.charts) {
    if (chart.slot.player === 'single') importedLevels.set(chart.slot.difficulty, chart.level);
  }
  for (const difficulty of Object.keys(DIFFICULTY_KEYS) as FumenDifficulty[]) {
    const next = importedLevels.get(difficulty) ?? 0;
    if (currentStars[difficulty] !== next) {
      changes.push({
        key: `stars:${difficulty}`,
        label: `${t(DIFFICULTY_KEYS[difficulty])} · ${t('metadata.stars')}`,
        from: currentStars[difficulty],
        to: next,
      });
    }
  }

  // Import owns the whole Shin-uchi block: the base per Good and the all-Good
  // target, for every difficulty (the sentinel where the TJA has no course).
  const shinuti = shinutiPatch(imported);
  for (const difficulty of Object.keys(DIFFICULTY_KEYS) as FumenDifficulty[]) {
    for (const field of [...SHINUTI_FIELDS[difficulty], ...SHINUTI_SCORE_FIELDS[difficulty]]) {
      const next = shinuti[field];
      const current = row.info[field];
      if (current === next) continue;
      changes.push({
        key: `shinuti:${field}`,
        label: `${t(DIFFICULTY_KEYS[difficulty])} · ${t(shinutiLabel(field))}`,
        from: typeof current === 'number' ? current : 0,
        to: next,
      });
    }
  }

  const representatives = new Map(
    imported.charts
      .filter((chart) => chart.slot.player === 'single')
      .map((chart) => [chart.slot.difficulty, chart] as const),
  );
  const derivedLabels = {
    branch: 'metadata.branchRoutes',
    notes: 'metadata.noteCount',
    renda: 'metadata.drumrollTime',
    fuusen: 'metadata.balloonTotal',
  } as const satisfies Record<string, MessageKey>;
  for (const difficulty of Object.keys(DIFFICULTY_KEYS) as FumenDifficulty[]) {
    const fields = CHART_METADATA_FIELDS[difficulty];
    const chart = representatives.get(difficulty);
    const summary = chart
      ? summarizeFumenMetadata(chart.fumen)
      : { branch: false, notes: 0, renda: 0, fuusen: 0 };
    for (const kind of Object.keys(derivedLabels) as (keyof typeof derivedLabels)[]) {
      const field = fields[kind];
      const currentRaw = row.info[field];
      const current = kind === 'branch'
        ? currentRaw === true
        : typeof currentRaw === 'number' && Number.isFinite(currentRaw) ? currentRaw : 0;
      const next = summary[kind];
      if (current === next) continue;
      const display = (value: number | boolean) => typeof value === 'boolean'
        ? t(value ? 'common.on' : 'common.off')
        : Number.isInteger(value) ? value : Number(value.toFixed(3));
      changes.push({
        key: `derived:${difficulty}:${kind}`,
        label: `${t(DIFFICULTY_KEYS[difficulty])} · ${t(derivedLabels[kind])}`,
        from: display(current),
        to: display(next),
      });
    }
  }
  return changes;
}

function ChartPreviewRow({
  songId,
  chart,
  current,
}: {
  songId: string;
  chart: TjaImportChart;
  current: ReadonlySet<string>;
}) {
  const t = useT();
  const slot = importChartSlot(songId, chart);
  const summary = summarizeImportedChart(chart.fumen);
  const replacing = current.has(slot.filename);
  return (
    <div className="tk-save-row">
      <span className={`tk-save-badge ${replacing ? 'edit' : 'add'}`}>{replacing ? '~' : '+'}</span>
      <div className="tk-save-rowmain">
        <div className="tk-import-chart-head">
          <span className="tk-mono tk-save-file">fumen/{songId}/{slot.filename}</span>
          <span className="tk-mono pill">
            {t(DIFFICULTY_KEYS[slot.difficulty])} · {t(PLAYER_KEYS[slot.player])}
          </span>
        </div>
        <div className="tk-save-sum">
          {replacing ? t('importtja.replaceChart') : t('importtja.createChart')}
        </div>
        <div className="tk-save-sum">
          {t('importtja.chartSummary', {
            measures: summary.measures,
            notes: summary.notes,
            rolls: summary.drumrolls,
            balloons: summary.balloons,
          })}
        </div>
        <div className="tk-save-sum">
          {t('importtja.scoreSummary', { base: chart.scoreBase, step: chart.scoreStep })}
        </div>
      </div>
    </div>
  );
}

function RemovedChartRow({ songId, slot }: { songId: string; slot: FumenSlot }) {
  const t = useT();
  return (
    <div className="tk-save-row">
      <span className="tk-save-badge del">−</span>
      <div className="tk-save-rowmain">
        <div className="tk-import-chart-head">
          <span className="tk-mono tk-save-file">fumen/{songId}/{slot.filename}</span>
          <span className="tk-mono pill">
            {t(DIFFICULTY_KEYS[slot.difficulty])} · {t(PLAYER_KEYS[slot.player])}
          </span>
        </div>
        <div className="tk-save-sum">{t('importtja.removeChart')}</div>
      </div>
    </div>
  );
}

export function ImportTjaDialog() {
  const project = useAppStore((state) => state.project);
  const songId = useAppStore((state) => state.selection.songId);
  const songSlots = useAppStore((state) => state.songSlots) ?? [];
  const closeTjaImport = useAppStore((state) => state.closeTjaImport);
  const importTja = useAppStore((state) => state.importTja);
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<SelectedTja>();
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string>();
  const [options, setOptions] = useState<TjaImportOptions>(loadImportOptions);
  const [demoProbe, setDemoProbe] = useState<DemoStartProbe>({ kind: 'idle' });

  const open = project.kind === 'open' ? project.project : undefined;
  const row = open && songId ? open.songs.byId.get(songId) : undefined;

  const tjaDemoStartMs = selected?.imported.demoStartMs;
  const audioOnDisk = !!open && !!row && hasAudioFile(open.assets, row);
  const soundFile = useMemo(() => {
    if (!row) return undefined;
    const resolved = resolveSoundFile(row.info);
    // The bank's playable tone is picked by file stem, as in the Sound tab.
    return { ...resolved, stem: resolved.filename.replace(/\.nus3bank$/i, '') };
  }, [row]);
  // A demo start the editor already knows: the Sound tab's baseline, or the value
  // a pending edit will write. Either way it saves re-reading the whole bank.
  const knownDemoStartMs = open && soundFile
    ? (open.soundMetadataDrafts.get(soundMetadataKey(soundFile.filename))
      ?? open.soundMetadataBaselines.get(soundMetadataKey(soundFile.filename)))?.demoStartMs
    : undefined;

  useEffect(() => {
    if (tjaDemoStartMs === undefined || !audioOnDisk || !open || !soundFile || !row) {
      setDemoProbe({ kind: 'idle' });
      return;
    }
    if (knownDemoStartMs !== undefined) {
      setDemoProbe({ kind: 'ready', currentMs: knownDemoStartMs });
      return;
    }
    let cancelled = false;
    setDemoProbe({ kind: 'loading' });
    (async () => {
      try {
        const bytes = await readSoundBankBytes(open.root, row.info);
        const currentMs = bytes ? readNus3BankDemoStartMs(bytes, soundFile.stem) : undefined;
        if (cancelled) return;
        setDemoProbe(currentMs === undefined ? { kind: 'unsupported' } : { kind: 'ready', currentMs });
      } catch {
        if (!cancelled) setDemoProbe({ kind: 'unsupported' });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tjaDemoStartMs, audioOnDisk, knownDemoStartMs, soundFile?.filename, row?.info, open?.root]);

  if (!row || !songId || !soundFile) return null;

  const setPart = (part: keyof TjaImportOptions, value: boolean) => {
    setOptions((previous) => {
      const next = { ...previous, [part]: value };
      persistImportOptions(next);
      return next;
    });
  };

  const chooseFile = () => inputRef.current?.click();
  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setParsing(true);
    setError(undefined);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const imported = convertTjaForImport(decodeTjaBytes(bytes));
      setSelected({ fileName: file.name, imported });
    } catch (caught) {
      setSelected(undefined);
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setParsing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  // The demo start can only be applied when the TJA carries one and the bank on
  // disk has a field to put it in; the checkbox stays off the table otherwise.
  const demoStartApplicable = demoProbe.kind === 'ready';
  const applyDemoStart = options.demoStart && demoStartApplicable;
  const nothingToApply = !options.metadata && !options.charts && !applyDemoStart;
  // Why it cannot be applied, most fundamental reason first: nothing to import,
  // nowhere to put it, or a bank whose tone record has no such field.
  const demoStartIssue: MessageKey | undefined =
    demoStartApplicable || demoProbe.kind === 'loading' ? undefined
      : tjaDemoStartMs === undefined ? 'importtja.demoStartMissing'
        : !audioOnDisk ? 'importtja.demoStartNoAudio'
          : 'importtja.demoStartUnsupported';
  const demoStartEmptyKey: MessageKey =
    demoProbe.kind === 'loading' ? 'importtja.demoStartReading' : 'importtja.demoStartNone';

  const submit = async () => {
    if (!selected || importing || nothingToApply) return;
    setImporting(true);
    setError(undefined);
    const result = await importTja(row.uniqueId, selected.imported, {
      metadata: options.metadata,
      charts: options.charts,
      demoStart: applyDemoStart,
    });
    if (!result.ok) {
      setError(result.message);
      setImporting(false);
    }
  };

  const changes = selected ? metadataChanges(row, selected.imported, t) : [];
  const currentNames = new Set(songSlots.map((slot) => slot.filename));
  const importedNames = new Set(selected?.imported.charts.map((chart) => importChartSlot(songId, chart).filename) ?? []);
  const removed = selected ? songSlots.filter((slot) => !importedNames.has(slot.filename)) : [];
  const close = parsing || importing ? undefined : closeTjaImport;

  return (
    <div className="tk-modal-overlay" onClick={close}>
      <div className="tk-modal tk-import-modal" onClick={(event) => event.stopPropagation()}>
        <div className="tk-modal-head">
          <div className="row">
            <h2>{t('importtja.title')}</h2>
            <span className="tk-mono pill">{t('importtja.pill', { id: row.id, no: row.uniqueId })}</span>
          </div>
          <p>{t('importtja.intro')}</p>
        </div>

        <input
          ref={inputRef}
          className="tk-import-file-input"
          type="file"
          accept=".tja,text/plain"
          aria-label={t('importtja.chooseFile')}
          onChange={(event) => void readFile(event.target.files?.[0])}
        />

        {!selected ? (
          <div className="tk-import-picker">
            <Icon name="import" size={24} />
            <div className="tk-import-picker-title">{t('importtja.selectPrompt')}</div>
            <div className="tk-modal-note">{t('importtja.selectHint')}</div>
            <button className="tk-btn tk-btn-primary" onClick={chooseFile} disabled={parsing}>
              <Icon name="folder" /> {parsing ? t('importtja.parsing') : t('importtja.chooseFile')}
            </button>
            {error && <div className="tk-modal-note err">{t('importtja.readFailed', { message: error })}</div>}
          </div>
        ) : (
          <div className="tk-modal-body">
            <div className="tk-import-filebar">
              <div>
                <div className="tk-mono tk-save-file">{selected.fileName}</div>
                <div className="tk-save-sum">
                  {t(selected.imported.charts.length === 1 ? 'importtja.chartCount.one' : 'importtja.chartCount.other', {
                    n: selected.imported.charts.length,
                  })}
                </div>
              </div>
              <button className="tk-btn tk-btn-sm" onClick={chooseFile} disabled={parsing || importing}>
                <Icon name="folder" /> {parsing ? t('importtja.parsing') : t('importtja.chooseAnother')}
              </button>
            </div>

            <div className="tk-modal-group">
              <PartHeader
                label={t('importtja.metadataGroup')}
                checked={options.metadata}
                onChange={(value) => setPart('metadata', value)}
                locked={importing}
              />
              <div className={options.metadata ? undefined : 'tk-skipped'}>
                {changes.length === 0 ? (
                  <div className="tk-modal-empty">{t('importtja.noMetadataChanges')}</div>
                ) : changes.map((change) => (
                  <div className="tk-save-row" key={change.key}>
                    <span className="tk-save-badge edit">~</span>
                    <div className="tk-save-rowmain">
                      <div className="tk-save-file">{change.label}</div>
                      <div className="tk-save-change">
                        <span className="v"><span className="from">{change.from}</span> → <span className="to">{change.to}</span></span>
                      </div>
                    </div>
                  </div>
                ))}
                <div className="tk-save-issue">{t('importtja.derivedMetadata')}</div>
              </div>
            </div>

            <div className="tk-modal-group">
              <PartHeader
                label={t('importtja.chartsGroup')}
                checked={options.charts}
                onChange={(value) => setPart('charts', value)}
                locked={importing}
              />
              <div className={options.charts ? undefined : 'tk-skipped'}>
                {selected.imported.charts.map((chart) => (
                  <ChartPreviewRow
                    key={`${chart.slot.difficulty}:${chart.slot.player}`}
                    songId={songId}
                    chart={chart}
                    current={currentNames}
                  />
                ))}
                {removed.map((slot) => <RemovedChartRow key={slot.filename} songId={songId} slot={slot} />)}
              </div>
            </div>

            <div className="tk-modal-group">
              <PartHeader
                label={t('importtja.demoStartGroup')}
                checked={options.demoStart}
                onChange={(value) => setPart('demoStart', value)}
                available={demoStartApplicable}
                locked={importing}
              />
              <div className={applyDemoStart ? undefined : 'tk-skipped'}>
                {demoProbe.kind === 'ready' && tjaDemoStartMs !== undefined ? (
                  <div className="tk-save-row">
                    <span className="tk-save-badge edit">~</span>
                    <div className="tk-save-rowmain">
                      <div className="tk-import-chart-head">
                        <span className="tk-mono tk-save-file">{soundFile.displayPath}</span>
                      </div>
                      <div className="tk-save-sum">{t('importtja.demoStartRow')}</div>
                      <div className="tk-save-change">
                        <span className="v">
                          <span className="from">{formatSeconds(demoProbe.currentMs)}</span>
                          {' → '}
                          <span className="to">{formatSeconds(tjaDemoStartMs)}</span>
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="tk-modal-empty">{t(demoStartEmptyKey)}</div>
                )}
              </div>
              {demoStartIssue && (
                <div className="tk-save-issue warn tk-issue-row">
                  <Icon name="alert" size={14} /> {t(demoStartIssue)}
                </div>
              )}
            </div>

            {selected.imported.warnings.length > 0 && (
              <div className="tk-modal-group">
                <div className="tk-modal-grouphd warn">{t('importtja.recoveriesGroup')}</div>
                {selected.imported.warnings.map((warning, index) => (
                  <div className="tk-save-issue warn" key={`${warning.code}:${warning.detail ?? ''}:${index}`}>
                    {t(WARNING_KEYS[warning.code], { detail: warning.detail ?? '', n: warning.count })}
                    {warning.count > 1 ? ` ${t('importtja.recoveryCount', { n: warning.count })}` : ''}
                  </div>
                ))}
              </div>
            )}

            <div className="tk-save-issue ok">{t('importtja.audioUnchanged')}</div>
            {error && <div className="tk-save-issue err">{t('importtja.importFailed', { message: error })}</div>}
          </div>
        )}

        <div className="tk-modal-foot">
          {selected && !error && (nothingToApply
            ? <span className="tk-save-status warn"><Icon name="alert" /> {t('importtja.nothingSelected')}</span>
            : <span className="tk-save-status ok"><Icon name="check" /> {t('importtja.ready')}</span>
          )}
          <div className="tk-spacer" />
          <button className="tk-btn" onClick={closeTjaImport} disabled={parsing || importing}>{t('common.cancel')}</button>
          <button
            className="tk-btn tk-btn-primary"
            onClick={() => void submit()}
            disabled={!selected || parsing || importing || nothingToApply}
          >
            <Icon name="import" /> {importing ? t('importtja.importing') : t('importtja.importAction')}
          </button>
        </div>
      </div>
    </div>
  );
}
