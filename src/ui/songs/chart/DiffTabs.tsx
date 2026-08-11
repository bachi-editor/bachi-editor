import { useAppStore } from '../../../model/store';
import { FumenDifficulty, FumenPlayer } from '../../../fs/fumens';
import { SongRow } from '../../../model/songlist';
import { MessageKey } from '../../../i18n';
import { useT } from '../../../i18n/useT';
import { Icon } from '../../shell/Icon';
import { BranchSeg } from './BranchSeg';

const DIFFS: { value: FumenDifficulty; starKey: keyof SongRow['info'] }[] = [
  { value: 'easy', starKey: 'starEasy' },
  { value: 'normal', starKey: 'starNormal' },
  { value: 'hard', starKey: 'starHard' },
  { value: 'oni', starKey: 'starMania' },
];

const URA: { value: FumenDifficulty; starKey: keyof SongRow['info'] } = {
  value: 'ura',
  starKey: 'starUra',
};

export function DiffTabs({ row }: { row: SongRow }) {
  const t = useT();
  const difficulty = useAppStore((s) => s.selection.difficulty);
  const player = useAppStore((s) => s.selection.player);
  const slots = useAppStore((s) => s.songSlots) ?? [];
  const selectFumen = useAppStore((s) => s.selectFumen);
  const createUraChart = useAppStore((s) => s.createUraChart);
  const deleteUraChart = useAppStore((s) => s.deleteUraChart);
  const addBlankDifficulty = useAppStore((s) => s.addBlankDifficulty);

  const availableDiffs = new Set(slots.map((s) => s.difficulty));
  const playersForDiff = new Set(slots.filter((s) => s.difficulty === difficulty).map((s) => s.player));

  const onSelectDiff = (d: FumenDifficulty) => {
    // Keep the same physical slot when possible, otherwise prefer Solo and
    // then whichever two-player side is actually present.
    const players = new Set(slots.filter((s) => s.difficulty === d).map((s) => s.player));
    const next: FumenPlayer = players.has(player)
      ? player
      : players.has('single')
        ? 'single'
        : players.has('p1')
          ? 'p1'
          : 'p2';
    selectFumen(d, next);
  };

  const onSelectPlayer = (nextPlayer: FumenPlayer) => {
    if (playersForDiff.has(nextPlayer)) selectFumen(difficulty, nextPlayer);
  };

  const uraLv = row.info[URA.starKey];
  const uraEnabled = typeof uraLv === 'number' && uraLv > 0;
  const hasUra = availableDiffs.has('ura');
  const hasOni = availableDiffs.has('oni');

  // One unified row (Phase 17): difficulty pills · Ura · branch focus (only on
  // branched charts, via BranchSeg) · chart slot pushed right. Replaces the two
  // stacked DiffTabs + BranchTabs bars, reclaiming a row of editor height.
  return (
    <div className="tk-unified">
      {DIFFS.map((d) => {
        const lv = row.info[d.starKey];
        const has = availableDiffs.has(d.value);
        const label = t(`metadata.difficulty.${d.value}` as MessageKey);
        // A difficulty the song lacks becomes a "create from scratch" ghost pill,
        // mirroring the Ura affordance — click to author a blank chart for it.
        if (!has) {
          return (
            <button
              key={d.value}
              className="tk-diff ghost"
              title={t('metadata.chartCreateHint', { difficulty: label })}
              onClick={() => void addBlankDifficulty(row.uniqueId, d.value)}
            >
              {label}
            </button>
          );
        }
        return (
          <button
            key={d.value}
            className={'tk-diff' + (difficulty === d.value ? ' on' : '')}
            onClick={() => onSelectDiff(d.value)}
          >
            {label} {typeof lv === 'number' && <span className="lv">★{lv}</span>}
          </button>
        );
      })}

      {/* Ura chart creation/removal is independent of metadata enablement: the
          chart can be authored while disabled. When a chart exists but `starUra`
          is still 0, the pill carries a warning that it also needs enabling in
          Metadata to be playable in-game. */}
      {hasUra ? (
        <span className="tk-diff-ura">
          <button
            className={'tk-diff' + (difficulty === 'ura' ? ' on' : '')}
            onClick={() => onSelectDiff('ura')}
          >
            {t('metadata.difficulty.ura')} {typeof uraLv === 'number' && <span className="lv">★{uraLv}</span>}
            {!uraEnabled && (
              <span className="tk-diff-warn" title={t('metadata.uraChartNotEnabledWarning')}>
                <Icon name="alert" size={13} />
              </span>
            )}
          </button>
          <button
            className="tk-diff-del"
            title={t('metadata.uraChartDeleteHint')}
            aria-label={t('metadata.uraChartDeleteHint')}
            onClick={() => deleteUraChart(row.uniqueId)}
          >
            ×
          </button>
        </span>
      ) : hasOni ? (
        <button
          className="tk-diff ghost"
          title={t('metadata.uraChartCreateHint')}
          onClick={() => void createUraChart(row.uniqueId)}
        >
          {t('metadata.difficulty.ura')}
        </button>
      ) : (
        <button className="tk-diff" disabled title={t('metadata.uraChartRequiresOniHint')}>
          {t('metadata.difficulty.ura')}
        </button>
      )}

      <BranchSeg />

      {/* Map the editor control directly to the three physical files. In an
          AC16 two-player performance `_1` and `_2` are consumed as the P1/P2
          pair, but each remains an independently editable chart asset. */}
      <div className="tk-chart-slot">
        <span>{t('chartslot.label')}</span>
        <div className="tk-seg">
          <button
            className={player === 'single' ? 'on' : ''}
            disabled={!playersForDiff.has('single')}
            title={t('chartslot.soloTitle')}
            onClick={() => onSelectPlayer('single')}
          >
            {t('chartslot.solo')}
          </button>
          <button
            className={player === 'p1' ? 'on' : ''}
            disabled={!playersForDiff.has('p1')}
            title={t('chartslot.p1Title')}
            onClick={() => onSelectPlayer('p1')}
          >
            {t('chartslot.p1')}
          </button>
          <button
            className={player === 'p2' ? 'on' : ''}
            disabled={!playersForDiff.has('p2')}
            title={t('chartslot.p2Title')}
            onClick={() => onSelectPlayer('p2')}
          >
            {t('chartslot.p2')}
          </button>
        </div>
      </div>
    </div>
  );
}
