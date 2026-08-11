// Pure, immutable transforms over a DanConfig (one file's dan array). Each
// returns a new config with structural sharing — only the touched dan/song/
// border is a fresh object — mirroring model/edits.ts. Dans are keyed by
// `danId` (unique within a file, and stable: normal danIds are positional and
// gaiden edits the title, never the id). verupNo is NOT touched here; the store
// applies the auto-bump policy (see PLAN.md, Dani Dojo) around these edits.

import {
  BORDER_TYPE_ALL,
  BORDER_TYPE_PER_SONG,
  NORMAL_MAX_DANS,
  normalDanTitleForIndex,
  type DanConfig,
  type DanEntry,
  type OdaiBorder,
  type OdaiSong,
} from '../codec/serverdata';

export type DanSection = 'normal' | 'gaiden';

// ── scaffolds ──────────────────────────────────────────────────────────────

/** A blank song slot (songNo 0 = "no song"; Oni by default). */
export function emptyOdaiSong(): OdaiSong {
  return { songNo: 0, level: 4, isHiddenSongName: false };
}

/** The three blank slots a fresh/cleared dan carries. */
function emptyOdaiSongs(): OdaiSong[] {
  return [emptyOdaiSong(), emptyOdaiSong(), emptyOdaiSong()];
}

/** A seed clear-criterion: a SoulGauge All border (the corpus's ubiquitous first row). */
export function scaffoldBorder(): OdaiBorder {
  return {
    odaiType: 1,
    borderType: BORDER_TYPE_ALL,
    redBorderTotal: 90,
    goldBorderTotal: 95,
    redBorder_1: 0, redBorder_2: 0, redBorder_3: 0,
    goldBorder_1: 0, goldBorder_2: 0, goldBorder_3: 0,
  };
}

/** A dan whose songs are all unset — the empty/cleared state. */
export function isEmptyDan(d: DanEntry): boolean {
  return d.aryOdaiSong.every((s) => !s.songNo);
}

/**
 * True when a loaded file slot's draft differs from its baseline — a dan was
 * added, removed, or edited. Shared by the Dojo page header (per-file Save
 * button) and the rail rows so both agree on "unsaved".
 */
export function danSectionEdited(slot: { loaded: boolean; baseline: DanConfig; draft: DanConfig }): boolean {
  if (!slot.loaded) return false;
  const baseMap = new Map(slot.baseline.map((d) => [d.danId, JSON.stringify(d)]));
  const removed = [...baseMap.keys()].some((id) => !slot.draft.some((d) => d.danId === id));
  return removed || slot.draft.some((d) => baseMap.get(d.danId) !== JSON.stringify(d));
}

/** A fresh normal-dojo config: one empty dan at the first rank. */
export function scaffoldNormalConfig(): DanConfig {
  return [{ danId: 1, verupNo: 1, title: normalDanTitleForIndex(0), aryOdaiSong: emptyOdaiSongs(), aryOdaiBorder: [] }];
}

/** A fresh gaiden config: one empty gaiden set at danId 20. */
export function scaffoldGaidenConfig(): DanConfig {
  return [{ danId: 20, verupNo: 1, title: 'gaiden_new', aryOdaiSong: emptyOdaiSongs(), aryOdaiBorder: [] }];
}

// ── dan add / remove / clear ────────────────────────────────────────────────

/** Append the next normal dan (next danId + positional rank). No-op past 19. */
export function addNormalDan(config: DanConfig): DanConfig {
  if (config.length >= NORMAL_MAX_DANS) return config;
  const index = config.length;
  return [
    ...config,
    { danId: index + 1, verupNo: 1, title: normalDanTitleForIndex(index), aryOdaiSong: emptyOdaiSongs(), aryOdaiBorder: [] },
  ];
}

/** Append a new gaiden set (danId continues past the normal range). */
export function addGaidenDan(config: DanConfig): DanConfig {
  const maxId = config.reduce((m, d) => Math.max(m, d.danId), NORMAL_MAX_DANS);
  const danId = maxId + 1;
  return [
    ...config,
    { danId, verupNo: 1, title: `gaiden_${danId}`, aryOdaiSong: emptyOdaiSongs(), aryOdaiBorder: [] },
  ];
}

/** Remove a dan — only allowed on the trailing entry (keeps the ladder contiguous). */
export function removeTrailingDan(config: DanConfig, danId: number): DanConfig {
  if (config.length === 0 || config[config.length - 1].danId !== danId) return config;
  return config.slice(0, -1);
}

/** Reset a dan to three empty song slots and no criteria. */
export function clearDan(config: DanConfig, danId: number): DanConfig {
  return patchDan(config, danId, (d) => ({ ...d, aryOdaiSong: emptyOdaiSongs(), aryOdaiBorder: [] }));
}

// ── dan-level edits ─────────────────────────────────────────────────────────

/** Set a dan's title key (used for gaiden's free-text rename). */
export function setDanTitle(config: DanConfig, danId: number, title: string): DanConfig {
  return patchDan(config, danId, (d) => (d.title === title ? d : { ...d, title }));
}

/** Set a dan's verupNo directly (manual override of the auto-bump). */
export function setDanVerupNo(config: DanConfig, danId: number, verupNo: number): DanConfig {
  return patchDan(config, danId, (d) => (d.verupNo === verupNo ? d : { ...d, verupNo }));
}

// ── song-slot edits ─────────────────────────────────────────────────────────

/** Append a blank song slot (validation keeps the dan honest at exactly 3). */
export function addOdaiSong(config: DanConfig, danId: number): DanConfig {
  return patchDan(config, danId, (d) => ({ ...d, aryOdaiSong: [...d.aryOdaiSong, emptyOdaiSong()] }));
}

/** Remove a song slot by index. */
export function removeOdaiSong(config: DanConfig, danId: number, slot: number): DanConfig {
  return patchDan(config, danId, (d) => {
    if (slot < 0 || slot >= d.aryOdaiSong.length) return d;
    return { ...d, aryOdaiSong: d.aryOdaiSong.filter((_, i) => i !== slot) };
  });
}

export function setOdaiSongNo(config: DanConfig, danId: number, slot: number, songNo: number): DanConfig {
  return patchSong(config, danId, slot, (s) => (s.songNo === songNo ? s : { ...s, songNo }));
}

export function setOdaiSongLevel(config: DanConfig, danId: number, slot: number, level: number): DanConfig {
  return patchSong(config, danId, slot, (s) => (s.level === level ? s : { ...s, level }));
}

export function setOdaiSongHidden(config: DanConfig, danId: number, slot: number, isHiddenSongName: boolean): DanConfig {
  return patchSong(config, danId, slot, (s) => (s.isHiddenSongName === isHiddenSongName ? s : { ...s, isHiddenSongName }));
}

// ── border (clear-criteria) edits ───────────────────────────────────────────

export function addBorder(config: DanConfig, danId: number): DanConfig {
  return patchDan(config, danId, (d) => ({ ...d, aryOdaiBorder: [...d.aryOdaiBorder, scaffoldBorder()] }));
}

export function removeBorder(config: DanConfig, danId: number, borderIndex: number): DanConfig {
  return patchDan(config, danId, (d) => ({
    ...d,
    aryOdaiBorder: d.aryOdaiBorder.filter((_, i) => i !== borderIndex),
  }));
}

export function setBorderOdaiType(config: DanConfig, danId: number, borderIndex: number, odaiType: number): DanConfig {
  return patchBorder(config, danId, borderIndex, (b) => (b.odaiType === odaiType ? b : { ...b, odaiType }));
}

/** Switch a border's evaluation mode. The typed model already carries every
 *  field (defaulting 0), and serialization emits by borderType, so this is a
 *  one-field change — no field juggling needed. */
export function setBorderType(config: DanConfig, danId: number, borderIndex: number, borderType: number): DanConfig {
  return patchBorder(config, danId, borderIndex, (b) => (b.borderType === borderType ? b : { ...b, borderType }));
}

/** Set one numeric threshold field on a border (redBorderTotal, goldBorder_2, …). */
export function setBorderValue(
  config: DanConfig,
  danId: number,
  borderIndex: number,
  key: BorderValueKey,
  value: number,
): DanConfig {
  return patchBorder(config, danId, borderIndex, (b) => (b[key] === value ? b : { ...b, [key]: value }));
}

export type BorderValueKey =
  | 'redBorderTotal' | 'goldBorderTotal'
  | 'redBorder_1' | 'redBorder_2' | 'redBorder_3'
  | 'goldBorder_1' | 'goldBorder_2' | 'goldBorder_3';

// ── internals ────────────────────────────────────────────────────────────────

function patchDan(config: DanConfig, danId: number, fn: (d: DanEntry) => DanEntry): DanConfig {
  let changed = false;
  const next = config.map((d) => {
    if (d.danId !== danId) return d;
    const nd = fn(d);
    if (nd !== d) changed = true;
    return nd;
  });
  return changed ? next : config;
}

function patchSong(config: DanConfig, danId: number, slot: number, fn: (s: OdaiSong) => OdaiSong): DanConfig {
  return patchDan(config, danId, (d) => {
    const cur = d.aryOdaiSong[slot];
    if (!cur) return d;
    const ns = fn(cur);
    if (ns === cur) return d;
    return { ...d, aryOdaiSong: d.aryOdaiSong.map((s, i) => (i === slot ? ns : s)) };
  });
}

function patchBorder(config: DanConfig, danId: number, borderIndex: number, fn: (b: OdaiBorder) => OdaiBorder): DanConfig {
  return patchDan(config, danId, (d) => {
    const cur = d.aryOdaiBorder[borderIndex];
    if (!cur) return d;
    const nb = fn(cur);
    if (nb === cur) return d;
    return { ...d, aryOdaiBorder: d.aryOdaiBorder.map((b, i) => (i === borderIndex ? nb : b)) };
  });
}

/** Content equality ignoring verupNo — the auto-bump policy's comparison. */
export function sameDanContentIgnoringVerup(a: DanEntry, b: DanEntry): boolean {
  return JSON.stringify({ ...a, verupNo: 0 }) === JSON.stringify({ ...b, verupNo: 0 });
}

export { BORDER_TYPE_ALL, BORDER_TYPE_PER_SONG };
