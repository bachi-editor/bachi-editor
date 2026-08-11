// Difficulty + Solo/2P (souchi) selector for the Sound tab. It drives the same
// global `selection` + `selectFumen` the Chart tab's DiffTabs uses, so the two
// tabs stay in lockstep: switching a slot here changes which chart's offset the
// Sound tab edits and previews, and the Chart tab opens on that same slot (and
// vice-versa). Unlike DiffTabs this stays read-only about the slot set — no Ura
// create/delete or branch-focus controls, which belong to chart editing.

import { useAppStore } from '../../model/store';
import { FumenDifficulty, FumenPlayer } from '../../fs/fumens';
import { SongRow } from '../../model/songlist';
import { MessageKey, useT } from '../../i18n';

const DIFFS: { value: FumenDifficulty; starKey: keyof SongRow['info'] }[] = [
  { value: 'easy', starKey: 'starEasy' },
  { value: 'normal', starKey: 'starNormal' },
  { value: 'hard', starKey: 'starHard' },
  { value: 'oni', starKey: 'starMania' },
  { value: 'ura', starKey: 'starUra' },
];

export function ChartSlotSelect({ row }: { row: SongRow }) {
  const difficulty = useAppStore((s) => s.selection.difficulty);
  const player = useAppStore((s) => s.selection.player);
  const slots = useAppStore((s) => s.songSlots) ?? [];
  const selectFumen = useAppStore((s) => s.selectFumen);
  const t = useT();

  // Audio-only songs (no chart files) have nothing to select — skip the bar
  // rather than showing a row of dead, all-disabled pills.
  if (slots.length === 0) return null;

  const availableDiffs = new Set(slots.map((s) => s.difficulty));
  const playersForDiff = new Set(slots.filter((s) => s.difficulty === difficulty).map((s) => s.player));

  // Keep the same physical player slot across a difficulty switch when it exists,
  // else fall back to Solo, then whichever 2P side is present (mirrors DiffTabs).
  const onSelectDiff = (d: FumenDifficulty) => {
    if (d === difficulty) return;
    const players = new Set(slots.filter((s) => s.difficulty === d).map((s) => s.player));
    if (players.size === 0) return;
    const next: FumenPlayer = players.has(player)
      ? player
      : players.has('single')
        ? 'single'
        : players.has('p1')
          ? 'p1'
          : 'p2';
    selectFumen(d, next);
  };

  const onSelectPlayer = (next: FumenPlayer) => {
    if (next !== player && playersForDiff.has(next)) selectFumen(difficulty, next);
  };

  return (
    <div className="tk-snd-slot">
      {DIFFS.map((d) => {
        const lv = row.info[d.starKey];
        const has = availableDiffs.has(d.value);
        return (
          <button
            key={d.value}
            className={'tk-diff' + (difficulty === d.value ? ' on' : '')}
            disabled={!has}
            onClick={() => onSelectDiff(d.value)}
          >
            {t(`metadata.difficulty.${d.value}` as MessageKey)} {typeof lv === 'number' && lv > 0 && <span className="lv">★{lv}</span>}
          </button>
        );
      })}

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
