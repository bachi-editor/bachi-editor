// Polished chart-canvas states (Phase 18). Each maps onto a `fumen.kind`
// branch (idle / loading / error) or the no-charts-on-disk case, replacing the
// bare `tk-placeholder` text with a designed icon + message + recovery actions.
import { Icon } from '../../shell/Icon';
import type { FumenDifficulty, FumenPlayer, FumenSlot } from '../../../fs/fumens';
import type { SongRow } from '../../../model/songlist';
import { MessageKey, useT } from '../../../i18n';

const DIFF_ORDER: FumenDifficulty[] = ['easy', 'normal', 'hard', 'oni', 'ura'];
const DIFF_STAR_KEY: Record<FumenDifficulty, keyof SongRow['info']> = {
  easy: 'starEasy', normal: 'starNormal', hard: 'starHard', oni: 'starMania', ura: 'starUra',
};

interface DiffPick {
  difficulty: FumenDifficulty;
  player: FumenPlayer;
}

/** The distinct difficulties on disk (in canonical order), each with a default
 *  player to open — single if present, else the first 2P side. */
function diffPicks(slots: FumenSlot[], uraEnabled: boolean): DiffPick[] {
  const picks: DiffPick[] = [];
  for (const difficulty of DIFF_ORDER) {
    if (difficulty === 'ura' && !uraEnabled) continue;
    const players = slots.filter((s) => s.difficulty === difficulty).map((s) => s.player);
    if (players.length === 0) continue;
    const player: FumenPlayer = players.includes('single')
      ? 'single'
      : players.includes('p1') ? 'p1' : 'p2';
    picks.push({ difficulty, player });
  }
  return picks;
}

/** Empty · no difficulty picked — the song has charts, none is loaded yet. */
export function ChartEmptyNoDiff({
  row,
  title,
  slots,
  onPick,
}: {
  row: SongRow;
  title: string;
  slots: FumenSlot[];
  onPick: (difficulty: FumenDifficulty, player: FumenPlayer) => void;
}) {
  const t = useT();
  const picks = diffPicks(slots, typeof row.info.starUra === 'number' && row.info.starUra > 0);
  return (
    <div className="tk-state">
      <span className="tk-state-ic"><Icon name="drum" /></span>
      <div className="tk-state-h">{t('chartstates.pickDiffTitle')}</div>
      <div className="tk-state-p">
        {t(picks.length === 1 ? 'chartstates.ships.one' : 'chartstates.ships.other', { title, n: picks.length })}
      </div>
      <div className="tk-state-actions">
        {picks.map((p) => {
          const lv = row.info[DIFF_STAR_KEY[p.difficulty]];
          return (
            <button key={p.difficulty} className="tk-diff" onClick={() => onPick(p.difficulty, p.player)}>
              {t(`metadata.difficulty.${p.difficulty}` as MessageKey)} {typeof lv === 'number' && <span className="lv">★{lv}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Empty · no charts on disk — nothing to pick, so no difficulty chips. */
export function ChartNoCharts() {
  const t = useT();
  return (
    <div className="tk-state">
      <span className="tk-state-ic"><Icon name="drum" /></span>
      <div className="tk-state-h">{t('chartstates.noChartsTitle')}</div>
      <div className="tk-state-p">{t('chartstates.noChartsBody')}</div>
    </div>
  );
}

/** Loading · decoding a chart — shimmer skeleton score sheet + a codec line. */
export function ChartLoading({ filename }: { filename: string }) {
  const t = useT();
  const rows: [number, number][] = [[46, 70], [62, 40], [54, 80]];
  return (
    <div className="tk-state" style={{ justifyContent: 'flex-start', paddingTop: 30 }}>
      <div className="tk-skel-sheet">
        {rows.map(([a, b], i) => (
          <div className="tk-skel-row" key={i}>
            <span className="tk-skel-dot tk-shim" />
            <span className="tk-skel-bar tk-shim" style={{ width: `${a}%` }} />
            <span className="tk-skel-bar tk-shim" style={{ width: `${b}%` }} />
          </div>
        ))}
      </div>
      <div className="tk-state-load">
        <span className="tk-spin" /> {t('chartstates.decoding', { filename })}
      </div>
    </div>
  );
}

/** Error · decode failed — alert + reason + path + Retry decode. */
export function ChartError({
  songId,
  filename,
  message,
  onRetry,
}: {
  songId: string;
  filename: string;
  message: string;
  onRetry: () => void;
}) {
  const t = useT();
  return (
    <div className="tk-state">
      <span className="tk-state-ic err"><Icon name="alert" /></span>
      <div className="tk-state-h">{t('chartstates.decodeErrorTitle')}</div>
      <div className="tk-state-p">{message}</div>
      <div className="tk-state-path">fumen/{songId}/{filename}</div>
      <div className="tk-state-actions">
        <button className="tk-btn tk-btn-primary" onClick={onRetry}>
          <Icon name="reset" /> {t('chartstates.retryDecode')}
        </button>
      </div>
    </div>
  );
}
