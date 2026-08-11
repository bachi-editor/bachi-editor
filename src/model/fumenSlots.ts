// Fumen slot lifecycle: creating and removing chart files (Phase 3.4, Ura `_x`).
//
// Unlike note edits (which mutate an existing chart's bytes), creating/deleting
// a difficulty adds or removes whole `.bin` files. Those pending file operations
// live in two maps on the store — `fumenCreated` (charts to write that have no
// on-disk baseline yet) and `fumenRemoved` (existing files to delete) —
// and ride the same undo snapshot + save pipeline as every other edit.
//
// Ura is created as the full triple (`_x`, `_x_1`, `_x_2`) by cloning the song's
// Oni (`_m`) slots, matching the corpus invariant that every present difficulty
// carries all three player variants (RE-confirmed 2026-06-11; see PLAN §7). The
// server gates Ura purely on `starUra > 0` and never reads fumen files, so the
// only on-disk requirement is the files themselves.

import { decodeFumen, encodeFumen, Fumen } from '../codec';
import { FumenSlot, fumenFilename, sortFumenSlots } from '../fs/fumens';
import { fumenKey } from './fumenDrafts';

/** A chart to be written as a new file on save (no on-disk baseline yet). */
export interface CreatedFumen {
  songId: string;
  slot: FumenSlot;
  fumen: Fumen;
}

/** An existing chart file to remove on save. */
export interface RemovedFumenSlot {
  songId: string;
  filename: string;
}

/** A pending slot add/remove, for the save-dialog Fumen group. */
export interface FumenSlotChange {
  key: string;
  songId: string;
  filename: string;
  kind: 'created' | 'removed';
}

/**
 * Deep, independent copy of a decoded chart via a codec round-trip. Cloning
 * through encode→decode also proves the source chart encodes cleanly, and frees
 * the copy from any structural sharing with its origin (so editing a cloned Ura
 * can never alias the Oni it came from).
 */
export function cloneFumen(fumen: Fumen): Fumen {
  return decodeFumen(encodeFumen(fumen));
}

/** The Ura slot that mirrors an Oni slot (same player, `_m…` → `_x…`). */
export function uraSlotForOni(songId: string, oni: FumenSlot): FumenSlot {
  return {
    difficulty: 'ura',
    player: oni.player,
    filename: fumenFilename(songId, 'ura', oni.player),
  };
}

/**
 * The slots a song effectively has: its on-disk slots minus pending removals,
 * plus pending creations. Deduped by filename and sorted into display order.
 */
export function mergeSongSlots(
  diskSlots: FumenSlot[],
  songId: string,
  created: Map<string, CreatedFumen>,
  removed: Map<string, RemovedFumenSlot>,
): FumenSlot[] {
  const byFilename = new Map<string, FumenSlot>();
  for (const slot of diskSlots) {
    if (removed.has(fumenKey(songId, slot.filename))) continue;
    byFilename.set(slot.filename, slot);
  }
  for (const [key, c] of created) {
    if (c.songId !== songId) continue;
    if (removed.has(key)) continue;
    byFilename.set(c.slot.filename, c.slot);
  }
  return sortFumenSlots([...byFilename.values()]);
}

function changeSort(a: FumenSlotChange, b: FumenSlotChange): number {
  return a.songId === b.songId ? a.filename.localeCompare(b.filename) : a.songId.localeCompare(b.songId);
}

/** Created slots as save-dialog rows, in a stable order. */
export function collectCreatedFumens(created: Map<string, CreatedFumen>): FumenSlotChange[] {
  const out: FumenSlotChange[] = [];
  for (const [key, c] of created) {
    out.push({ key, songId: c.songId, filename: c.slot.filename, kind: 'created' });
  }
  return out.sort(changeSort);
}

/** Removed slots as save-dialog rows, in a stable order. */
export function collectRemovedFumens(removed: Map<string, RemovedFumenSlot>): FumenSlotChange[] {
  const out: FumenSlotChange[] = [];
  for (const [key, r] of removed) {
    out.push({ key, songId: r.songId, filename: r.filename, kind: 'removed' });
  }
  return out.sort(changeSort);
}
