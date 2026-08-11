// Status bar for the Dani Dojo area — swaps the chart-oriented status line for
// per-file dani status + an aggregate validation verdict.

import { useAppStore } from '../../model/store';
import { NORMAL_MAX_DANS } from '../../codec/serverdata';
import { sectionErrorCount } from '../../model/danValidation';
import { useT } from '../../i18n';
import { StatusPath } from '../shell/StatusPath';
import { useDanResolver } from './useDani';

export function DaniStatusBar() {
  const normal = useAppStore((s) => s.dani.normal);
  const gaiden = useAppStore((s) => s.dani.gaiden);
  const resolve = useDanResolver();
  const t = useT();

  const anyLoaded = normal.loaded || gaiden.loaded;
  const totalErr =
    (normal.loaded ? sectionErrorCount(normal.draft, resolve, 'normal') : 0) +
    (gaiden.loaded ? sectionErrorCount(gaiden.draft, resolve, 'gaiden') : 0);
  const ok = totalErr === 0;

  return (
    <div className="tk-status">
      <div className="grp"><span>{t('dani.normal')}</span><b>{normal.loaded ? t('dani.dansCount', { n: normal.draft.length, max: NORMAL_MAX_DANS }) : t('dani.notLoaded')}</b></div>
      <div className="grp"><span>{t('gaiden.label')}</span><b>{gaiden.loaded ? t(gaiden.draft.length === 1 ? 'dani.setsCount.one' : 'dani.setsCount.other', { n: gaiden.draft.length }) : t('dani.notLoaded')}</b></div>
      {anyLoaded && (
        <div className="grp">
          <span className={ok ? 'ok' : 'err'}>{ok ? '✓' : '✗'}</span>
          <span className={ok ? 'ok' : 'err'}>{ok ? t('dani.allValid') : t(totalErr === 1 ? 'dani.issuesBlock.one' : 'dani.issuesBlock.other', { n: totalErr })}</span>
        </div>
      )}
      <StatusPath paths={[normal.fileName, gaiden.fileName]} />
    </div>
  );
}
