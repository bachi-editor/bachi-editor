// Status bar for the Music Order area — the genre/entry counts that used to sit
// on the top toolbar. The saved/unsaved state + Save action live in the page
// header (PageHeader); this line stays purely informational.

import { useMemo } from 'react';
import { useAppStore } from '../../model/store';
import { useT } from '../../i18n';
import { StatusPath } from '../shell/StatusPath';

export function OrderStatusBar() {
  const project = useAppStore((s) => s.project);
  const open = project.kind === 'open' ? project.project : undefined;
  const t = useT();

  // Mirror OrderArea's folder grouping: count entries that resolve to a song and
  // the distinct genres they fall under, so these totals match the board exactly.
  const { genres, entries } = useMemo(() => {
    if (!open) return { genres: 0, entries: 0 };
    const byId = open.songs.byId;
    const present = new Set<number>();
    for (const entry of open.datatables.musicOrder.items) {
      const id = typeof entry.id === 'string' ? entry.id : undefined;
      const row = id ? byId.get(id) : undefined;
      if (!row) continue;
      const no = typeof entry.genreNo === 'number' ? entry.genreNo : row.genreNo ?? -1;
      present.add(no);
    }
    return { genres: present.size, entries: open.datatables.musicOrder.items.length };
  }, [open]);

  return (
    <div className="tk-status">
      <div className="grp"><span>{t('order.genres')}</span><b>{genres}</b></div>
      <div className="grp"><span>{t('order.entries')}</span><b>{entries.toLocaleString()}</b></div>
      <StatusPath paths={['Data/x64/datatable/music_order.bin']} />
    </div>
  );
}
