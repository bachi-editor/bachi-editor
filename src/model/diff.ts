// Diff the working draft against the loaded baseline, producing the semantic
// change list the save dialog and save-state pill render.
//
// We deliberately diff at the *decoded* level (JSON items), not the byte level:
// the on-disk datatables use inconsistent whitespace (musicinfo is not even
// internally uniform), so a byte diff of a re-serialised file is meaningless.
// What the user cares about is "starMania 8 → 9", and that's what we compute.

import { COMPANION_TABLES, COMPANION_TABLE_KEYS, type RawDatatables } from '../fs/datatables';
import {
  MUSICINFO_SUPPORTED_FIELDS,
  type CompanionSongItem,
  type MusicInfoItem,
  type MusicOrderItem,
  type WordListItem,
} from '../codec';
import { LOCALE_KEYS } from './edits';
import { sameMusicOrderItems } from './musicOrder';

export type DatatableName =
  | 'musicinfo.bin'
  | 'music_order.bin'
  | 'wordlist.bin'
  | 'music_attribute.bin'
  | 'music_usbsetting.bin'
  | 'music_ai_section.bin';

export interface FieldChange {
  /** Human label, e.g. "starMania" or "title · 简体中文". */
  label: string;
  from: string;
  to: string;
}

export interface FileDiff {
  file: DatatableName;
  dirty: boolean;
  /** Flat list of every field-level change, for the save dialog. */
  changes: FieldChange[];
  /** Count of changed/added/removed records (drives the unsaved-edits pill). */
  changedRecords: number;
  /** One-line summary, e.g. "2 songs · 3 fields". */
  summary: string;
}

export interface ProjectDiff {
  files: FileDiff[];
  /** Total changed records across all files. */
  totalEdits: number;
  dirty: boolean;
}

function show(v: unknown): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'string') return v.length === 0 ? '“”' : v;
  return String(v);
}

// Every supported post-creation field participates in dirty state and save
// review, including system-managed fields. Identity and genre remain immutable.
const MUSICINFO_TRACKED: readonly (keyof MusicInfoItem)[] = MUSICINFO_SUPPORTED_FIELDS;

function diffMusicInfo(base: MusicInfoItem[], draft: MusicInfoItem[]): FileDiff {
  const baseById = new Map(base.map((i) => [i.uniqueId, i]));
  const changes: FieldChange[] = [];
  const touchedSongs = new Set<number>();
  for (const item of draft) {
    const b = baseById.get(item.uniqueId);
    if (!b) {
      touchedSongs.add(item.uniqueId);
      changes.push({ label: `+ song ${item.id}`, from: '—', to: `Song No. ${item.uniqueId}` });
      continue;
    }
    for (const f of MUSICINFO_TRACKED) {
      if (item[f] !== b[f]) {
        touchedSongs.add(item.uniqueId);
        changes.push({ label: `${item.id} · ${String(f)}`, from: show(b[f]), to: show(item[f]) });
      }
    }
  }
  const draftIds = new Set(draft.map((i) => i.uniqueId));
  for (const b of base) {
    if (!draftIds.has(b.uniqueId)) {
      touchedSongs.add(b.uniqueId);
      changes.push({ label: `− song ${b.id}`, from: `Song No. ${b.uniqueId}`, to: '—' });
    }
  }
  return {
    file: 'musicinfo.bin',
    dirty: changes.length > 0,
    changes,
    changedRecords: touchedSongs.size,
    summary: changes.length === 0 ? 'no change' : `${touchedSongs.size} song(s) · ${changes.length} field(s)`,
  };
}

function diffWordlist(base: WordListItem[], draft: WordListItem[]): FileDiff {
  const baseByKey = new Map(base.map((i) => [i.key, i]));
  const changes: FieldChange[] = [];
  const touchedKeys = new Set<string>();
  for (const item of draft) {
    const b = baseByKey.get(item.key);
    for (const l of LOCALE_KEYS) {
      const bv = b?.[l] ?? '';
      const dv = item[l] ?? '';
      if (bv !== dv) {
        touchedKeys.add(item.key);
        changes.push({ label: `${item.key} · ${l}`, from: show(bv), to: show(dv) });
      }
    }
  }
  // Removed keys (e.g. a deleted song's title/subtitle rows) — iterating only the
  // draft above misses these, which would leave orphan strings in wordlist.bin.
  const draftKeys = new Set(draft.map((i) => i.key));
  for (const b of base) {
    if (!draftKeys.has(b.key)) {
      touchedKeys.add(b.key);
      changes.push({ label: `− ${b.key}`, from: 'present', to: '—' });
    }
  }
  return {
    file: 'wordlist.bin',
    dirty: changes.length > 0,
    changes,
    changedRecords: touchedKeys.size,
    summary: changes.length === 0 ? 'no change' : `${touchedKeys.size} key(s) · ${changes.length} string(s)`,
  };
}

function diffMusicOrder(base: MusicOrderItem[], draft: MusicOrderItem[]): FileDiff {
  // The complete decoded row plus its position is identity. Hidden/pass-through
  // fields distinguish duplicate placements even when id + genreNo are equal.
  const changed = !sameMusicOrderItems(base, draft);
  return {
    file: 'music_order.bin',
    dirty: changed,
    changes: changed ? [{ label: 'sequence', from: `${base.length} entries`, to: `${draft.length} entries` }] : [],
    changedRecords: changed ? 1 : 0,
    summary: changed ? 'order changed' : 'no change',
  };
}

/**
 * Companion tables only ever gain or lose whole rows — the editor adds one when
 * a song is created and drops it when a song is deleted, and never touches a
 * field. So the diff is a row-set diff, reported per song rather than per field.
 */
function diffCompanion(
  file: DatatableName,
  base: CompanionSongItem[] | undefined,
  draft: CompanionSongItem[] | undefined,
): FileDiff {
  const empty: FileDiff = { file, dirty: false, changes: [], changedRecords: 0, summary: 'no change' };
  if (!base || !draft) return empty;
  const identity = (row: CompanionSongItem) => JSON.stringify([row.id, row.uniqueId]);
  const remainingBase = new Map<string, number>();
  for (const row of base) {
    const key = identity(row);
    remainingBase.set(key, (remainingBase.get(key) ?? 0) + 1);
  }
  const changes: FieldChange[] = [];
  for (const row of draft) {
    const key = identity(row);
    const count = remainingBase.get(key) ?? 0;
    if (count > 0) {
      remainingBase.set(key, count - 1);
    } else {
      changes.push({ label: `+ ${row.id}`, from: '—', to: `Song No. ${row.uniqueId}` });
    }
  }
  for (const row of base) {
    const key = identity(row);
    const count = remainingBase.get(key) ?? 0;
    if (count <= 0) continue;
    changes.push({ label: `− ${row.id}`, from: `Song No. ${row.uniqueId}`, to: '—' });
    remainingBase.set(key, count - 1);
  }
  if (changes.length === 0) return empty;
  return {
    file,
    dirty: true,
    changes,
    changedRecords: changes.length,
    summary: `${changes.length} ${changes.length === 1 ? 'row' : 'rows'}`,
  };
}

export function diffDatatables(base: RawDatatables, draft: RawDatatables): ProjectDiff {
  const files: FileDiff[] = [
    diffMusicInfo(base.musicinfo.items, draft.musicinfo.items),
    diffMusicOrder(base.musicOrder.items, draft.musicOrder.items),
    diffWordlist(base.wordlist.items, draft.wordlist.items),
    ...COMPANION_TABLE_KEYS.map((field) => diffCompanion(
      COMPANION_TABLES[field],
      base[field]?.items,
      draft[field]?.items,
    )),
  ];
  const totalEdits = files.reduce((n, f) => n + f.changedRecords, 0);
  return { files, totalEdits, dirty: files.some((f) => f.dirty) };
}

/**
 * Set of song ids whose musicinfo or wordlist entries differ from baseline.
 * Computed in a single pass so the song-list "Edited" filter is cheap.
 */
export function dirtySongIds(base: RawDatatables, draft: RawDatatables): Set<string> {
  const out = new Set<string>();
  const baseInfo = new Map(base.musicinfo.items.map((i) => [i.uniqueId, i]));
  for (const item of draft.musicinfo.items) {
    const b = baseInfo.get(item.uniqueId);
    if (!b) { out.add(item.id); continue; }
    for (const f of MUSICINFO_TRACKED) {
      if (item[f] !== b[f]) { out.add(item.id); break; }
    }
  }
  const baseWord = new Map(base.wordlist.items.map((w) => [w.key, w]));
  for (const w of draft.wordlist.items) {
    const m = /^song_(?:sub_)?(.+)$/.exec(w.key);
    if (!m) continue;
    const b = baseWord.get(w.key);
    for (const l of LOCALE_KEYS) {
      if ((b?.[l] ?? '') !== (w[l] ?? '')) { out.add(m[1]); break; }
    }
  }
  return out;
}

/** True if a song's musicinfo or wordlist entries differ from baseline. */
export function songIsDirty(base: RawDatatables, draft: RawDatatables, songId: string, uniqueId: number): boolean {
  const bi = base.musicinfo.items.find((i) => i.uniqueId === uniqueId);
  const di = draft.musicinfo.items.find((i) => i.uniqueId === uniqueId);
  if (bi && di) {
    for (const f of MUSICINFO_TRACKED) if (bi[f] !== di[f]) return true;
  }
  for (const kind of ['song_', 'song_sub_']) {
    const key = kind + songId;
    const bw = base.wordlist.items.find((w) => w.key === key);
    const dw = draft.wordlist.items.find((w) => w.key === key);
    for (const l of LOCALE_KEYS) {
      if ((bw?.[l] ?? '') !== (dw?.[l] ?? '')) return true;
    }
  }
  return false;
}
