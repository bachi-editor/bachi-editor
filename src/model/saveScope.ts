// Per-page save scoping. Songs, Music Order, and Dani Dojo each save only the
// files they own, so saving one page never flushes another page's edits.
//
// Songs and Music Order share the single game-project draft, but they touch
// disjoint files: Songs owns musicinfo.bin, wordlist.bin, the fumen charts and
// the sound banks; Music Order owns music_order.bin. The one overlap is song
// *deletion* (a Songs action) which also strips that song's music_order rows —
// otherwise music_order would point at a song no longer in musicinfo. So a
// deleted song's row removals travel with the Songs save; pure reordering /
// genre moves of existing songs stay with the Order save.

import type { RawDatatables } from '../fs/datatables';
import { diffDatatables } from './diff';
import { sameMusicOrderItems } from './musicOrder';

export type SaveScope = 'songs' | 'order';

/**
 * The datatable view to diff and write for a scope:
 * - `order` takes the draft's music_order but leaves musicinfo/wordlist at
 *   baseline, so only reordering/genre changes are written.
 * - `songs` takes the draft's musicinfo/wordlist and reduces music_order to
 *   baseline minus any deleted songs' rows — deletions are applied, reorderings
 *   are not (those belong to the Order save).
 */
export function scopedDatatables(
  base: RawDatatables,
  draft: RawDatatables,
  scope: SaveScope,
): RawDatatables {
  if (scope === 'order') {
    return { ...base, musicOrder: draft.musicOrder };
  }
  const existing = new Set(draft.musicinfo.items.map((i) => i.uniqueId));
  return {
    ...draft,
    musicOrder: {
      ...base.musicOrder,
      items: base.musicOrder.items.filter((o) => existing.has(o.uniqueId)),
    },
  };
}

/**
 * True when existing songs have been reordered / moved between genres. Deleting
 * a song also removes its music_order row, but that is a Songs action — so the
 * comparison is made against baseline with the deleted songs' rows stripped, so
 * a pending deletion alone never marks the Order page dirty.
 */
export function orderScopeDirty(base: RawDatatables, draft: RawDatatables): boolean {
  const existing = new Set(draft.musicinfo.items.map((i) => i.uniqueId));
  const baseExisting = base.musicOrder.items.filter((o) => existing.has(o.uniqueId));
  return !sameMusicOrderItems(baseExisting, draft.musicOrder.items);
}

/** True when any Songs-owned datatable (musicinfo/wordlist/deletion rows) differs. */
export function songsDatatableDirty(base: RawDatatables, draft: RawDatatables): boolean {
  return diffDatatables(base, scopedDatatables(base, draft, 'songs')).dirty;
}
