// Full musicinfo editor. Song No., Song ID, canonical genre, initial BPM, and
// the system-managed sound path are read-only; localized titles/subtitles and
// every user-editable musicinfo field participate in save diffs.

import { useMemo } from 'react';
import { useAppStore } from '../../model/store';
import { LOCALES, type Locale, type SongRow } from '../../model/songlist';
import type { FumenDifficulty } from '../../fs/fumens';
import { genreMessageKey } from '../../model/genres';
import type {
  MusicInfoChartDerivedField,
  MusicInfoEditableField,
  MusicInfoEditablePatch,
  MusicInfoItem,
} from '../../codec';
import type { StarField } from '../../model/edits';
import type { RawDatatables } from '../../fs/datatables';
import { useT, type TFn } from '../../i18n/useT';
import type { MessageKey } from '../../i18n/messages';
import { Icon } from '../shell/Icon';

interface DifficultyFields {
  label: MessageKey;
  difficulty: FumenDifficulty;
  star: StarField;
  branch: MusicInfoChartDerivedField;
  notes: MusicInfoChartDerivedField;
  renda: MusicInfoChartDerivedField;
  fuusen: MusicInfoChartDerivedField;
  spike: MusicInfoEditableField;
  shinuti: MusicInfoEditableField;
  shinutiDuet: MusicInfoEditableField;
  shinutiScore: MusicInfoEditableField;
  shinutiScoreDuet: MusicInfoEditableField;
}

const DIFFICULTIES: DifficultyFields[] = [
  {
    label: 'metadata.difficulty.easy', difficulty: 'easy', star: 'starEasy', branch: 'branchEasy', notes: 'easyOnpuNum',
    renda: 'rendaTimeEasy', fuusen: 'fuusenTotalEasy', spike: 'spikeOnEasy',
    shinuti: 'shinutiEasy', shinutiDuet: 'shinutiEasyDuet',
    shinutiScore: 'shinutiScoreEasy', shinutiScoreDuet: 'shinutiScoreEasyDuet',
  },
  {
    label: 'metadata.difficulty.normal', difficulty: 'normal', star: 'starNormal', branch: 'branchNormal', notes: 'normalOnpuNum',
    renda: 'rendaTimeNormal', fuusen: 'fuusenTotalNormal', spike: 'spikeOnNormal',
    shinuti: 'shinutiNormal', shinutiDuet: 'shinutiNormalDuet',
    shinutiScore: 'shinutiScoreNormal', shinutiScoreDuet: 'shinutiScoreNormalDuet',
  },
  {
    label: 'metadata.difficulty.hard', difficulty: 'hard', star: 'starHard', branch: 'branchHard', notes: 'hardOnpuNum',
    renda: 'rendaTimeHard', fuusen: 'fuusenTotalHard', spike: 'spikeOnHard',
    shinuti: 'shinutiHard', shinutiDuet: 'shinutiHardDuet',
    shinutiScore: 'shinutiScoreHard', shinutiScoreDuet: 'shinutiScoreHardDuet',
  },
  {
    label: 'metadata.difficulty.oni', difficulty: 'oni', star: 'starMania', branch: 'branchMania', notes: 'maniaOnpuNum',
    renda: 'rendaTimeMania', fuusen: 'fuusenTotalMania', spike: 'spikeOnOni',
    shinuti: 'shinutiMania', shinutiDuet: 'shinutiManiaDuet',
    shinutiScore: 'shinutiScoreMania', shinutiScoreDuet: 'shinutiScoreManiaDuet',
  },
  {
    label: 'metadata.difficulty.ura', difficulty: 'ura', star: 'starUra', branch: 'branchUra', notes: 'uraOnpuNum',
    renda: 'rendaTimeUra', fuusen: 'fuusenTotalUra', spike: 'spikeOnUra',
    shinuti: 'shinutiUra', shinutiDuet: 'shinutiUraDuet',
    shinutiScore: 'shinutiScoreUra', shinutiScoreDuet: 'shinutiScoreUraDuet',
  },
];

function Dot({ on, label }: { on: boolean; label: string }) {
  return on ? <span className="tk-edit-dot" title={label} /> : null;
}

function IdentityCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="tk-meta-identity-card">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function numericValue(item: MusicInfoItem | undefined, field: keyof MusicInfoItem): number {
  const value = item?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Read a flag that some dumps store as a boolean and others as an integer —
 * `spikeOn*` is `false`/`true` in CHN and `0`/`1`/`2` in JPN. Writing back is
 * conformed to the row's own type in model/edits.ts.
 */
function booleanValue(item: MusicInfoItem | undefined, field: keyof MusicInfoItem): boolean {
  const value = item?.[field];
  return value === true || (typeof value === 'number' && value !== 0);
}

function BooleanSwitch({
  on,
  onChange,
  offLabel,
  onLabel,
  disabled = false,
  title,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  offLabel: string;
  onLabel: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <div className="tk-seg" style={{ height: 35 }} title={title}>
      <button type="button" className={on ? '' : 'on'} aria-pressed={!on} disabled={disabled} onClick={() => onChange(false)}>{offLabel}</button>
      <button type="button" className={on ? 'on' : ''} aria-pressed={on} disabled={disabled} onClick={() => onChange(true)}>{onLabel}</button>
    </div>
  );
}

function NumberCell({
  info,
  baseInfo,
  field,
  onEdit,
  editedLabel,
  integer = true,
  min = 0,
  max,
  disabled = false,
}: {
  info: MusicInfoItem;
  baseInfo?: MusicInfoItem;
  field: MusicInfoEditableField;
  onEdit: (patch: MusicInfoEditablePatch) => void;
  editedLabel: string;
  integer?: boolean;
  min?: number;
  max?: number;
  disabled?: boolean;
}) {
  const value = numericValue(info, field);
  const dirty = baseInfo?.[field] !== info[field];
  return (
    <div className="tk-meta-matrix-cell">
      <Dot on={dirty} label={editedLabel} />
      <input
        className="tk-input"
        type="number"
        min={min}
        max={max}
        step={integer ? 1 : 'any'}
        value={value}
        disabled={disabled}
        aria-label={field}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (!Number.isFinite(parsed)) return;
          const rounded = integer ? Math.round(parsed) : parsed;
          const upper = max ?? (integer ? 2_147_483_647 : Number.POSITIVE_INFINITY);
          const next = Math.min(upper, Math.max(min, rounded));
          onEdit({ [field]: next } as MusicInfoEditablePatch);
        }}
      />
    </div>
  );
}

function DerivedNumberCell({
  info,
  field,
  hint,
  disabled = false,
}: {
  info: MusicInfoItem;
  field: MusicInfoChartDerivedField;
  hint: string;
  disabled?: boolean;
}) {
  const value = numericValue(info, field);
  return (
    <div className={`tk-meta-matrix-cell tk-meta-derived-cell${disabled ? ' disabled' : ''}`} title={hint}>
      <output className="tk-meta-derived-value" aria-label={field}>{Number.isInteger(value) ? value : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}</output>
    </div>
  );
}

function BooleanCell({
  info,
  baseInfo,
  field,
  onEdit,
  editedLabel,
  offLabel,
  onLabel,
  disabled = false,
}: {
  info: MusicInfoItem;
  baseInfo?: MusicInfoItem;
  field: MusicInfoEditableField;
  onEdit: (patch: MusicInfoEditablePatch) => void;
  editedLabel: string;
  offLabel: string;
  onLabel: string;
  disabled?: boolean;
}) {
  const checked = booleanValue(info, field);
  const dirty = baseInfo?.[field] !== info[field];
  return (
    <div className="tk-meta-matrix-cell tk-meta-bool-cell">
      <Dot on={dirty} label={editedLabel} />
      <BooleanSwitch
        on={checked}
        offLabel={offLabel}
        onLabel={onLabel}
        disabled={disabled}
        onChange={(next) => onEdit({ [field]: next } as MusicInfoEditablePatch)}
      />
    </div>
  );
}

/**
 * Editable branch toggle for one difficulty. Unlike the other derived cells, the
 * `branch*` flag mirrors the chart's `hasBranches` header, so toggling it patches
 * the chart (via the store) and stays in lockstep with the chart Inspector's
 * Branched-chart switch. Dirtiness is still measured against the musicinfo baseline.
 */
function BranchCell({
  info,
  baseInfo,
  field,
  onToggle,
  editedLabel,
  offLabel,
  onLabel,
  hint,
  disabled = false,
}: {
  info: MusicInfoItem;
  baseInfo?: MusicInfoItem;
  field: MusicInfoChartDerivedField;
  onToggle: (next: boolean) => void;
  editedLabel: string;
  offLabel: string;
  onLabel: string;
  hint: string;
  disabled?: boolean;
}) {
  const checked = booleanValue(info, field);
  const dirty = baseInfo?.[field] !== info[field];
  return (
    <div className="tk-meta-matrix-cell tk-meta-bool-cell" title={hint}>
      <Dot on={dirty} label={editedLabel} />
      <BooleanSwitch on={checked} offLabel={offLabel} onLabel={onLabel} disabled={disabled} onChange={onToggle} />
    </div>
  );
}

function MatrixHeader({
  t,
  uraEnabled,
  onToggleUra,
  showUraToggle = false,
}: {
  t: TFn;
  uraEnabled: boolean;
  onToggleUra: (next: boolean) => void;
  showUraToggle?: boolean;
}) {
  return (
    <>
      <div className="tk-meta-matrix-corner">{t('metadata.field')}</div>
      {DIFFICULTIES.map((difficulty) => {
        const isUra = difficulty.star === 'starUra';
        return (
          <div className={`tk-meta-matrix-head${isUra && !uraEnabled ? ' disabled' : ''}`} key={difficulty.label}>
            <span>{t(difficulty.label)}</span>
            {isUra && showUraToggle && (
              <button
                type="button"
                className={`tk-meta-ura-check${uraEnabled ? ' on' : ''}`}
                aria-label={t('metadata.uraEnabled')}
                aria-pressed={uraEnabled}
                title={t('metadata.uraEnableHint')}
                onClick={() => onToggleUra(!uraEnabled)}
              >
                {uraEnabled && <Icon name="check" size={12} />}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}

export function MetadataTab({ row }: { row: SongRow }) {
  const t = useT();
  const info = row.info;
  const fumen = useAppStore((s) => s.fumen);
  const editMusicInfo = useAppStore((s) => s.editMusicInfo);
  const editStar = useAppStore((s) => s.editStar);
  const setUraEnabled = useAppStore((s) => s.setUraEnabled);
  const setDifficultyBranch = useAppStore((s) => s.setDifficultyBranch);
  const editTitle = useAppStore((s) => s.editTitle);
  const editSubtitle = useAppStore((s) => s.editSubtitle);
  const project = useAppStore((s) => s.project);

  const baseline: RawDatatables | undefined = project.kind === 'open' ? project.project.baseline : undefined;
  const baseInfo = useMemo(
    () => baseline?.musicinfo.items.find((item) => item.uniqueId === row.uniqueId),
    [baseline, row.uniqueId],
  );
  const baseWord = useMemo(() => {
    const map = new Map<string, Record<string, unknown>>();
    if (baseline) for (const word of baseline.wordlist.items) map.set(word.key, word);
    return map;
  }, [baseline]);

  const bpm =
    fumen.kind === 'ready' && fumen.loaded.fumen.measures.length > 0
      ? String(Math.round(fumen.loaded.fumen.measures[0].bpm))
      : '—';
  const uraEnabled = numericValue(info, 'starUra') > 0;
  const onEdit = (patch: MusicInfoEditablePatch) => editMusicInfo(row.uniqueId, patch);
  const editedLabel = t('metadata.edited');
  const offLabel = t('common.off');
  const onLabel = t('common.on');
  const chartDerivedHint = t('metadata.chartDerivedHint');
  const branchDerivedHint = t('metadata.branchDerivedHint');

  const baseTitle = (locale: Locale): string => {
    const value = baseWord.get(`song_${row.id}`)?.[locale];
    return typeof value === 'string' ? value : '';
  };

  const baseSubtitle = (locale: Locale): string => {
    const value = baseWord.get(`song_sub_${row.id}`)?.[locale];
    return typeof value === 'string' ? value : '';
  };

  return (
    <div className="tk-meta-body">
      <div className="tk-meta-inner">
        <div className="tk-meta-section">
          <div className="h">{t('metadata.section.identity')}</div>
          <div className="tk-meta-identity-grid">
            <IdentityCard label={t('metadata.songNo')} value={String(row.uniqueId)} />
            <IdentityCard label={t('metadata.songId')} value={row.id} />
            <IdentityCard label={t('metadata.genre')} value={t(genreMessageKey(info.genreNo))} />
            <IdentityCard label={t('metadata.initialBpm')} value={bpm} />
          </div>
        </div>

        <div className="tk-meta-section">
          <div className="h">{t('metadata.section.settings')}</div>
          <div className="tk-meta-catalog-grid">
            <div className="tk-field" style={{ margin: 0 }}>
              <label>{t('metadata.papamama')} <Dot on={baseInfo?.papamama !== info.papamama} label={editedLabel} /></label>
              <BooleanSwitch
                on={info.papamama === true}
                offLabel={offLabel}
                onLabel={onLabel}
                onChange={(next) => onEdit({ papamama: next })}
              />
            </div>
          </div>
        </div>

        <div className="tk-meta-section">
          <div className="h">{t('metadata.section.chart')}</div>
          <div className="tk-meta-matrix">
            <MatrixHeader
              t={t}
              uraEnabled={uraEnabled}
              showUraToggle
              onToggleUra={(next) => setUraEnabled(row.uniqueId, next)}
            />

            <div className="tk-meta-matrix-label">{t('metadata.stars')}</div>
            {DIFFICULTIES.map((difficulty) => (
              <NumberCell
                key={difficulty.star}
                info={info}
                baseInfo={baseInfo}
                field={difficulty.star}
                min={0}
                max={10}
                editedLabel={editedLabel}
                disabled={difficulty.star === 'starUra' && !uraEnabled}
                onEdit={(patch) => {
                  const value = patch[difficulty.star];
                  if (typeof value === 'number') editStar(row.uniqueId, difficulty.star, value);
                }}
              />
            ))}

            <div className="tk-meta-matrix-label">{t('metadata.branchRoutes')}</div>
            {DIFFICULTIES.map((difficulty) => (
              <BranchCell
                key={difficulty.branch}
                info={info}
                baseInfo={baseInfo}
                field={difficulty.branch}
                hint={branchDerivedHint}
                offLabel={offLabel}
                onLabel={onLabel}
                editedLabel={editedLabel}
                disabled={difficulty.star === 'starUra' && !uraEnabled}
                onToggle={(on) => setDifficultyBranch(row.uniqueId, difficulty.difficulty, on)}
              />
            ))}

            <div className="tk-meta-matrix-label">{t('metadata.noteCount')}</div>
            {DIFFICULTIES.map((difficulty) => (
              <DerivedNumberCell
                key={difficulty.notes}
                info={info}
                field={difficulty.notes}
                hint={chartDerivedHint}
                disabled={difficulty.star === 'starUra' && !uraEnabled}
              />
            ))}

            <div className="tk-meta-matrix-label">{t('metadata.drumrollTime')}</div>
            {DIFFICULTIES.map((difficulty) => (
              <DerivedNumberCell
                key={difficulty.renda}
                info={info}
                field={difficulty.renda}
                hint={chartDerivedHint}
                disabled={difficulty.star === 'starUra' && !uraEnabled}
              />
            ))}

            <div className="tk-meta-matrix-label">{t('metadata.balloonTotal')}</div>
            {DIFFICULTIES.map((difficulty) => (
              <DerivedNumberCell
                key={difficulty.fuusen}
                info={info}
                field={difficulty.fuusen}
                hint={chartDerivedHint}
                disabled={difficulty.star === 'starUra' && !uraEnabled}
              />
            ))}

            <div className="tk-meta-matrix-label" title={t('metadata.spikeHint')}>{t('metadata.spikeFlag')}</div>
            {DIFFICULTIES.map((difficulty) => (
              <BooleanCell
                key={difficulty.spike}
                info={info}
                baseInfo={baseInfo}
                field={difficulty.spike}
                onEdit={onEdit}
                editedLabel={editedLabel}
                offLabel={offLabel}
                onLabel={onLabel}
                disabled={difficulty.star === 'starUra' && !uraEnabled}
              />
            ))}
          </div>
        </div>

        <div className="tk-meta-section">
          <div className="h">{t('metadata.section.shinuchi')}</div>
          <div className="tk-meta-matrix">
            <MatrixHeader
              t={t}
              uraEnabled={uraEnabled}
              onToggleUra={(next) => setUraEnabled(row.uniqueId, next)}
            />

            <div className="tk-meta-matrix-label">{t('metadata.baseScore')}</div>
            {DIFFICULTIES.map((difficulty) => (
              <NumberCell key={difficulty.shinuti} info={info} baseInfo={baseInfo} field={difficulty.shinuti} onEdit={onEdit} editedLabel={editedLabel} disabled={difficulty.star === 'starUra' && !uraEnabled} />
            ))}

            <div className="tk-meta-matrix-label">{t('metadata.baseScoreDuet')}</div>
            {DIFFICULTIES.map((difficulty) => (
              <NumberCell key={difficulty.shinutiDuet} info={info} baseInfo={baseInfo} field={difficulty.shinutiDuet} onEdit={onEdit} editedLabel={editedLabel} disabled={difficulty.star === 'starUra' && !uraEnabled} />
            ))}

            <div className="tk-meta-matrix-label">{t('metadata.targetScore')}</div>
            {DIFFICULTIES.map((difficulty) => (
              <NumberCell key={difficulty.shinutiScore} info={info} baseInfo={baseInfo} field={difficulty.shinutiScore} onEdit={onEdit} editedLabel={editedLabel} disabled={difficulty.star === 'starUra' && !uraEnabled} />
            ))}

            <div className="tk-meta-matrix-label">{t('metadata.targetScoreDuet')}</div>
            {DIFFICULTIES.map((difficulty) => (
              <NumberCell key={difficulty.shinutiScoreDuet} info={info} baseInfo={baseInfo} field={difficulty.shinutiScoreDuet} onEdit={onEdit} editedLabel={editedLabel} disabled={difficulty.star === 'starUra' && !uraEnabled} />
            ))}
          </div>
        </div>

        <div className="tk-meta-section">
          <div className="h">{t('metadata.section.titles')}</div>
          <div className="tk-meta-table">
            <div className="tk-meta-thead">
              <span style={{ width: 130 }}>{t('metadata.locale')}</span>
              <span style={{ flex: 1 }}>{t('metadata.title')}</span>
              <span style={{ flex: 1 }}>{t('metadata.subtitle')}</span>
            </div>
            {LOCALES.map((locale) => {
              const titleDirty = row.titles.title[locale.value] !== baseTitle(locale.value);
              const subtitleDirty = row.titles.subtitle[locale.value] !== baseSubtitle(locale.value);
              return (
                <div className="tk-meta-trow" key={locale.value}>
                  <span className="tk-meta-loc">{locale.label}</span>
                  <div className="tk-meta-localized-input">
                    <Dot on={titleDirty} label={editedLabel} />
                    <input
                      className="tk-input ui"
                      value={row.titles.title[locale.value]}
                      placeholder="—"
                      onChange={(event) => editTitle(row.id, locale.value, event.target.value)}
                    />
                  </div>
                  <div className="tk-meta-localized-input">
                    <Dot on={subtitleDirty} label={editedLabel} />
                    <input
                      className="tk-input ui"
                      value={row.titles.subtitle[locale.value]}
                      placeholder="—"
                      onChange={(event) => editSubtitle(row.id, locale.value, event.target.value)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
