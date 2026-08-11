// Pure, immutable transforms over the decoded datatables. Every editing action
// in the app is one of these functions: it takes the current RawDatatables and
// returns a new RawDatatables that shares structure with the old one (only the
// touched item/array is replaced). That structural sharing is what makes the
// undo/redo snapshots in the store cheap — a snapshot is just a reference to a
// previous RawDatatables.
//
// Nothing here touches disk, the store, or React. Keeping the transforms pure
// makes them trivially unit-testable and keeps the byte-perfect guarantees
// (only re-serialise what changed) easy to reason about.

import type { RawDatatables } from '../fs/datatables';
import type {
  MusicInfoChartDerivedPatch,
  MusicInfoEditablePatch,
  MusicInfoItem,
  MusicOrderItem,
  WordListItem,
} from '../codec';
import type { Locale } from './songlist';

export const LOCALE_KEYS: Locale[] = [
  'japaneseText',
  'englishUsText',
  'chineseTText',
  'chineseSText',
  'koreanText',
];

function titleFallbackLocales(locale: Locale): Locale[] {
  return [locale, 'chineseSText', 'chineseTText', 'japaneseText', 'englishUsText', 'koreanText'];
}

function wordlistTitle(d: RawDatatables, songId: string | undefined, locale: Locale): string {
  if (!songId) return '';
  const row = d.wordlist.items.find((w) => w.key === `song_${songId}`);
  if (!row) return songId;
  for (const l of titleFallbackLocales(locale)) {
    const v = row[l];
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return songId;
}

function orderEntryGenre(
  entry: MusicOrderItem,
  byUniqueId: Map<number, MusicInfoItem>,
  byId: Map<string, MusicInfoItem>,
): number | undefined {
  if (typeof entry.genreNo === 'number') return entry.genreNo;
  const byUid = byUniqueId.get(entry.uniqueId)?.genreNo;
  if (typeof byUid === 'number') return byUid;
  const bySongId = typeof entry.id === 'string' ? byId.get(entry.id)?.genreNo : undefined;
  return typeof bySongId === 'number' ? bySongId : undefined;
}

/**
 * The board folder a music_order entry belongs to: its explicit `genreNo`, else
 * the song's canonical musicinfo genre. Entries whose id maps to no known song
 * aren't cards and have no folder (`undefined`). Mirrors OrderArea's board and
 * buildOrderFolders so edits address the same (folder, slot) the UI shows.
 */
function makeFolderOf(d: RawDatatables): (entry: MusicOrderItem) => number | undefined {
  const byId = new Map(d.musicinfo.items.map((i) => [i.id, i]));
  return (entry) => {
    const row = typeof entry.id === 'string' ? byId.get(entry.id) : undefined;
    if (!row) return undefined;
    return typeof entry.genreNo === 'number' ? entry.genreNo : row.genreNo ?? -1;
  };
}

/** Difficulty-star fields on musicinfo, in display order. */
export type StarField = 'starEasy' | 'starNormal' | 'starHard' | 'starMania' | 'starUra';

/** The next free uniqueId (max existing + 1; 1 for an empty table). */
export function nextUniqueId(d: RawDatatables): number {
  let max = 0;
  for (const i of d.musicinfo.items) if (i.uniqueId > max) max = i.uniqueId;
  return max + 1;
}

/** Fields the Add Song dialog collects; everything else is scaffolded. */
export interface NewSong {
  /** Explicit, immutable numeric Song No. */
  uniqueId: number;
  /** Internal id — the fumen folder + sound base name. Must be unique. */
  id: string;
  /** Immutable canonical metadata genre. */
  genreNo: number;
  /** Required initial title, applied to every locale and editable afterwards. */
  title: string;
}

/**
 * Scaffold a new song's canonical musicinfo entry and wordlist title row.
 * music_order is deliberately untouched: placement and ordering are managed
 * independently in the Music Order area.
 *
 * No fumen/sound files are created — a new song starts with no chart and no
 * audio (the song list flags both); the user supplies them via the Chart/Sound
 * tabs. Returns the same reference if any required field is invalid or already taken.
 */
export function addSong(d: RawDatatables, song: NewSong): RawDatatables {
  const id = song.id.trim();
  const title = song.title.trim();
  const uniqueId = song.uniqueId;
  if (!/^[a-z0-9_]+$/.test(id) || title.length === 0) return d;
  if (d.musicinfo.items.some((i) => i.id === id)) return d;
  if (!Number.isSafeInteger(uniqueId) || uniqueId < 0 || uniqueId > 2_147_483_647) return d;
  if (d.musicinfo.items.some((i) => i.uniqueId === uniqueId)) return d;
  const genreNo = song.genreNo;
  if (!Number.isInteger(genreNo) || genreNo < 0 || genreNo > 7) return d;

  const info: MusicInfoItem = {
    uniqueId,
    id,
    songFileName: `sound/song_${id}`,
    genreNo,
    papamama: false,
    branchEasy: false,
    branchNormal: false,
    branchHard: false,
    branchMania: false,
    branchUra: false,
    starEasy: 0,
    starNormal: 0,
    starHard: 0,
    starMania: 0,
    starUra: 0,
    shinutiEasy: 0,
    shinutiNormal: 0,
    shinutiHard: 0,
    shinutiMania: 0,
    shinutiUra: 0,
    shinutiEasyDuet: 0,
    shinutiNormalDuet: 0,
    shinutiHardDuet: 0,
    shinutiManiaDuet: 0,
    shinutiUraDuet: 0,
    shinutiScoreEasy: 0,
    shinutiScoreNormal: 0,
    shinutiScoreHard: 0,
    shinutiScoreMania: 0,
    shinutiScoreUra: 0,
    shinutiScoreEasyDuet: 0,
    shinutiScoreNormalDuet: 0,
    shinutiScoreHardDuet: 0,
    shinutiScoreManiaDuet: 0,
    shinutiScoreUraDuet: 0,
    easyOnpuNum: 0,
    normalOnpuNum: 0,
    hardOnpuNum: 0,
    maniaOnpuNum: 0,
    uraOnpuNum: 0,
    rendaTimeEasy: 0,
    rendaTimeNormal: 0,
    rendaTimeHard: 0,
    rendaTimeMania: 0,
    rendaTimeUra: 0,
    fuusenTotalEasy: 0,
    fuusenTotalNormal: 0,
    fuusenTotalHard: 0,
    fuusenTotalMania: 0,
    fuusenTotalUra: 0,
    spikeOnEasy: false,
    spikeOnNormal: false,
    spikeOnHard: false,
    spikeOnOni: false,
    spikeOnUra: false,
  };

  // Title row — all five locales seeded with the same string so the new song is
  // visible regardless of the UI locale.
  const titleRow: WordListItem = { key: `song_${id}` };
  for (const l of LOCALE_KEYS) titleRow[l] = title;

  return {
    ...d,
    musicinfo: { ...d.musicinfo, items: [...d.musicinfo.items, info] },
    wordlist: { ...d.wordlist, items: [...d.wordlist.items, titleRow] },
  };
}

/**
 * Remove a song from all three datatables: its musicinfo + music_order entries
 * and every wordlist row keyed to it (title / subtitle / detail). The on-disk
 * fumen folder + sound file are removed at *save* time, derived
 * from the baseline-vs-draft musicinfo diff — see fs/write.ts. Returns the same
 * reference if the uniqueId isn't present.
 */
export function deleteSong(d: RawDatatables, uniqueId: number): RawDatatables {
  const item = d.musicinfo.items.find((i) => i.uniqueId === uniqueId);
  if (!item) return d;
  const id = item.id;
  const wordKeys = new Set([`song_${id}`, `song_sub_${id}`, `song_detail_${id}`]);
  return {
    ...d,
    musicinfo: { ...d.musicinfo, items: d.musicinfo.items.filter((i) => i.uniqueId !== uniqueId) },
    musicOrder: { ...d.musicOrder, items: d.musicOrder.items.filter((o) => o.uniqueId !== uniqueId) },
    wordlist: { ...d.wordlist, items: d.wordlist.items.filter((w) => !wordKeys.has(w.key)) },
  };
}

/** Replace one musicinfo item (matched by uniqueId) with a shallow patch. */
function patchMusicInfo(
  d: RawDatatables,
  uniqueId: number,
  patch: Partial<MusicInfoItem>,
): RawDatatables {
  let changed = false;
  const items = d.musicinfo.items.map((it) => {
    if (it.uniqueId !== uniqueId) return it;
    // Skip the allocation if every patched value already matches.
    const same = (Object.keys(patch) as (keyof MusicInfoItem)[]).every(
      (k) => it[k] === patch[k],
    );
    if (same) return it;
    changed = true;
    return { ...it, ...patch };
  });
  if (!changed) return d;
  return { ...d, musicinfo: { ...d.musicinfo, items } };
}

/** Set a single difficulty star. Clamped to 0..10 (the game's star range). */
export function setStar(
  d: RawDatatables,
  uniqueId: number,
  field: StarField,
  value: number,
): RawDatatables {
  const v = Math.max(0, Math.min(10, Math.round(value)));
  return patchMusicInfo(d, uniqueId, { [field]: v });
}

/** Patch only fields that remain editable after a song has been created. */
export function editMusicInfo(
  d: RawDatatables,
  uniqueId: number,
  patch: MusicInfoEditablePatch,
): RawDatatables {
  return patchMusicInfo(d, uniqueId, patch);
}

/** Synchronize fields owned by the chart pipeline rather than Metadata inputs. */
export function syncChartMetadata(
  d: RawDatatables,
  uniqueId: number,
  patch: MusicInfoChartDerivedPatch,
): RawDatatables {
  return patchMusicInfo(d, uniqueId, patch);
}

/**
 * Enable or disable Ura metadata. "On" gives starUra a sensible default (the
 * Oni star, or 1) if it was 0; "off" zeroes it. Chart-file creation/removal is
 * deliberately separate and belongs to the chart editor.
 */
export function setUraEnabled(d: RawDatatables, uniqueId: number, on: boolean): RawDatatables {
  const item = d.musicinfo.items.find((i) => i.uniqueId === uniqueId);
  if (!item) return d;
  if (on) {
    const cur = typeof item.starUra === 'number' ? item.starUra : 0;
    if (cur > 0) return d;
    const oni = typeof item.starMania === 'number' && item.starMania > 0 ? item.starMania : 1;
    return patchMusicInfo(d, uniqueId, { starUra: oni });
  }
  return patchMusicInfo(d, uniqueId, { starUra: 0 });
}

/**
 * Move a music_order entry to a position within a (possibly different) genre
 * folder. The dragged card is addressed by *where it sits on the board* —
 * `sourceGenreNo` + `sourceIndex` (its slot in that folder's current list) —
 * rather than by id alone, so a song listed in several genres moves the exact
 * copy that was grabbed instead of the first one found. `targetIndex` is the
 * destination slot within the target folder's current card list (0 = top,
 * folder length = bottom).
 *
 * The on-disk music_order is genre-contiguous (every genre's entries form one
 * unbroken run), so a move is a single splice that keeps the runs intact. A
 * placement's genre is independent from the song's canonical musicinfo genre.
 *
 * Returns the same reference (a no-op) when the resulting id/genre sequence is
 * unchanged, so dropping a card back where it started doesn't dirty the project.
 */
export function reorderMusicOrder(
  d: RawDatatables,
  songId: string,
  sourceGenreNo: number,
  sourceIndex: number,
  targetGenreNo: number,
  targetIndex: number,
): RawDatatables {
  const orig = d.musicOrder.items;
  // Resolve each entry's folder exactly as OrderArea's board does: an entry is a
  // card only when its id maps to a known song, and its folder is the entry's
  // genreNo (else that song's musicinfo genre). Addressing the drag by (folder,
  // slot) is what keeps a duplicate in another genre from being moved instead.
  const folderOf = makeFolderOf(d);

  // The dragged entry is the sourceIndex-th card in the source folder's run.
  const sourceRun: number[] = [];
  orig.forEach((o, i) => {
    if (folderOf(o) === sourceGenreNo) sourceRun.push(i);
  });
  const fromIdx = sourceRun[sourceIndex] ?? -1;
  // Bail on a stale/mismatched drag: the addressed slot must hold this song.
  if (fromIdx < 0 || orig[fromIdx].id !== songId) return d;

  const moved = orig[fromIdx];
  const newEntry =
    moved.genreNo === targetGenreNo ? moved : { ...moved, genreNo: targetGenreNo };

  // Absolute indices of the target folder's run in the original array.
  const targetAbs: number[] = [];
  orig.forEach((o, i) => {
    if (folderOf(o) === targetGenreNo) targetAbs.push(i);
  });
  // Map the folder-local drop slot to an absolute "insert before" index.
  let insertAbs: number;
  if (targetIndex >= targetAbs.length) {
    insertAbs = targetAbs.length ? targetAbs[targetAbs.length - 1] + 1 : orig.length;
  } else {
    insertAbs = targetAbs[Math.max(0, targetIndex)];
  }

  const items = orig.slice();
  items.splice(fromIdx, 1);
  if (fromIdx < insertAbs) insertAbs -= 1; // removal shifted the anchor left
  items.splice(insertAbs, 0, newEntry);

  // No-op only when every slot still holds the exact same entry object. A
  // signature over id:genreNo would miss reorders of same-genre duplicates
  // (identical id + genre) and silently drop the move.
  if (items.every((o, i) => o === orig[i])) return d;

  return { ...d, musicOrder: { ...d.musicOrder, items } };
}

/**
 * Insert a new music_order placement for `uniqueId` at the top of `genreNo`'s
 * folder. The song keeps its canonical musicinfo genre; only this placement's
 * folder is `genreNo`. The genre-contiguous invariant is preserved by inserting
 * immediately before the folder's current first entry (or appending when the
 * folder is empty, so the new single-entry run stays contiguous).
 *
 * Returns the same reference (a no-op) when `uniqueId` has no musicinfo row.
 */
export function insertMusicOrderEntry(
  d: RawDatatables,
  uniqueId: number,
  genreNo: number,
): RawDatatables {
  const song = d.musicinfo.items.find((i) => i.uniqueId === uniqueId);
  if (!song || typeof song.id !== 'string') return d;

  const orig = d.musicOrder.items;
  const folderOf = makeFolderOf(d);
  // Placement folder is explicit so a song shown outside its canonical genre
  // still lands in the folder the user added it to.
  const entry: MusicOrderItem = { uniqueId, id: song.id, genreNo };
  const firstOfGenre = orig.findIndex((o) => folderOf(o) === genreNo);
  const insertAt = firstOfGenre >= 0 ? firstOfGenre : orig.length;

  const items = orig.slice();
  items.splice(insertAt, 0, entry);
  return { ...d, musicOrder: { ...d.musicOrder, items } };
}

/**
 * Remove the placement addressed by (folder `genreNo`, folder-local `index`)
 * from music_order. As in `reorderMusicOrder`, the entry is addressed by folder
 * slot rather than id alone so removing one copy of a song listed in several
 * genres doesn't disturb the others. Only the placement is dropped — the song's
 * musicinfo/wordlist rows and files are untouched.
 *
 * Returns the same reference (a no-op) when the addressed slot no longer holds
 * `songId`.
 */
export function removeMusicOrderEntry(
  d: RawDatatables,
  songId: string,
  genreNo: number,
  index: number,
): RawDatatables {
  const orig = d.musicOrder.items;
  const folderOf = makeFolderOf(d);

  const run: number[] = [];
  orig.forEach((o, i) => {
    if (folderOf(o) === genreNo) run.push(i);
  });
  const removeIdx = run[index] ?? -1;
  // Bail on a stale/mismatched target: the addressed slot must hold this song.
  if (removeIdx < 0 || orig[removeIdx].id !== songId) return d;

  const items = orig.slice();
  items.splice(removeIdx, 1);
  return { ...d, musicOrder: { ...d.musicOrder, items } };
}

/**
 * Sort one music_order genre folder by the displayed song title. This mirrors
 * the nijiiro-toolset sortAlphabetically.py idea, but scoped to one genre so
 * Phase 2's genre-contiguous order invariant is preserved.
 */
export function sortMusicOrderGenre(
  d: RawDatatables,
  genreNo: number,
  locale: Locale,
): RawDatatables {
  const byUniqueId = new Map(d.musicinfo.items.map((i) => [i.uniqueId, i]));
  const byId = new Map(d.musicinfo.items.map((i) => [i.id, i]));
  const target = d.musicOrder.items
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .filter(({ entry }) => orderEntryGenre(entry, byUniqueId, byId) === genreNo);

  if (target.length < 2) return d;

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sorted = target.slice().sort((a, b) => {
    const titleCmp = collator.compare(
      wordlistTitle(d, a.entry.id, locale),
      wordlistTitle(d, b.entry.id, locale),
    );
    if (titleCmp !== 0) return titleCmp;
    const idCmp = collator.compare(a.entry.id ?? '', b.entry.id ?? '');
    if (idCmp !== 0) return idCmp;
    return a.originalIndex - b.originalIndex;
  });

  let cursor = 0;
  let changed = false;
  const items = d.musicOrder.items.map((entry) => {
    if (orderEntryGenre(entry, byUniqueId, byId) !== genreNo) return entry;
    const next = sorted[cursor++].entry;
    if (next !== entry) changed = true;
    return next;
  });

  if (!changed) return d;
  return { ...d, musicOrder: { ...d.musicOrder, items } };
}

/** Set one localized wordlist value, scaffolding every game locale if needed. */
function setLocalizedWord(
  d: RawDatatables,
  key: string,
  locale: Locale,
  value: string,
): RawDatatables {
  const items = d.wordlist.items;
  const idx = items.findIndex((w) => w.key === key);
  if (idx >= 0) {
    if (items[idx][locale] === value) return d;
    const next = items.slice();
    next[idx] = { ...items[idx], [locale]: value };
    return { ...d, wordlist: { ...d.wordlist, items: next } };
  }
  // No existing entry — scaffold one with all locales empty, then set this one.
  const fresh: WordListItem = { key };
  for (const l of LOCALE_KEYS) fresh[l] = '';
  fresh[locale] = value;
  return { ...d, wordlist: { ...d.wordlist, items: [...items, fresh] } };
}

/** Set one localized title string. */
export function setTitle(d: RawDatatables, songId: string, locale: Locale, value: string): RawDatatables {
  return setLocalizedWord(d, `song_${songId}`, locale, value);
}

/** Set one localized subtitle string. */
export function setSubtitle(d: RawDatatables, songId: string, locale: Locale, value: string): RawDatatables {
  return setLocalizedWord(d, `song_sub_${songId}`, locale, value);
}
