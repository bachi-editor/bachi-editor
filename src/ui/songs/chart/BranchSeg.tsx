import { useAppStore, type BranchFocus } from '../../../model/store';
import type { Fumen } from '../../../codec';
import { fumenIsBranched } from '../../../model/fumenEdits';
import { MessageKey, useT } from '../../../i18n';

// Branch-track focus segment (Phase 3.5, inlined into the unified diff row in
// Phase 17). Only meaningful for branched charts: a chart is branched when its
// header flag is on or its Expert/Master tracks carry notes. Picking a single
// track dims and locks editing to it so notes land on the intended branch;
// "All" edits every stacked stave at once (the default). On a flat chart this
// renders nothing, so the unified row reflows down to difficulty + player.
const TABS: { value: BranchFocus; labelKey: MessageKey }[] = [
  { value: 'all', labelKey: 'branch.all' },
  { value: 0, labelKey: 'branch.normal' },
  { value: 1, labelKey: 'branch.expert' },
  { value: 2, labelKey: 'branch.master' },
];

function branchNoteCount(f: Fumen, branchIndex: 0 | 1 | 2): number {
  let n = 0;
  for (const m of f.measures) n += m.branches[branchIndex].notes.length;
  return n;
}

export function BranchSeg() {
  const fumen = useAppStore((s) => s.fumen);
  const focus = useAppStore((s) => s.chart.branchFocus);
  const setFocus = useAppStore((s) => s.setBranchFocus);
  const t = useT();

  if (fumen.kind !== 'ready') return null;
  const f = fumen.loaded.fumen;
  if (!fumenIsBranched(f)) return null;

  return (
    <>
      <span className="tk-vrule" />
      <span className="tk-mini-label">{t('branch.label')}</span>
      <div className="tk-seg tk-branch-seg">
        {TABS.map((tab) => {
          const count = tab.value === 'all' ? undefined : branchNoteCount(f, tab.value as 0 | 1 | 2);
          return (
            <button
              key={String(tab.value)}
              type="button"
              className={focus === tab.value ? 'on' : ''}
              onClick={() => setFocus(tab.value)}
              title={tab.value === 'all' ? t('branch.editAll') : t('branch.editOne', { track: t(tab.labelKey) })}
            >
              {t(tab.labelKey)}
              {count !== undefined && <span className="lv">{count}</span>}
            </button>
          );
        })}
      </div>
    </>
  );
}
