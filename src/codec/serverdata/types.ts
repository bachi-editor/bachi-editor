// Dani Dojo (段位道場) server config — the shape of `dan_data.json` /
// `gaiden_data.json`. These are **plaintext** JSON files served by
// TaikoLocalServer from `Host/wwwroot/data/`; they are NOT part of the
// encrypted game datatable and involve no AES/gzip. The schema mirrors
// `Contracts.AdminApi/ServerData/DanData.cs` 1:1 (see PLAN.md, Dani Dojo).
//
// Field names mirror the on-disk JSON exactly so we round-trip without
// renaming. `dan_data.json` (DanType.Normal) and `gaiden_data.json`
// (DanType.Gaiden) share this exact `DanData[]` shape.

/** One pass/clear criterion, evaluated over the dan's 3-song set. */
export interface OdaiBorder {
  /** DanConditionType, 1..8 — see DAN_CONDITION_TYPES. */
  odaiType: number;
  /** DanBorderType: 1 = All (whole set, uses *Total) · 2 = PerSong (uses *_1/_2/_3). */
  borderType: number;
  // borderType === 1 (All): one threshold over the combined 3-song performance.
  redBorderTotal: number;
  goldBorderTotal: number;
  // borderType === 2 (PerSong): one threshold per song.
  redBorder_1: number;
  redBorder_2: number;
  redBorder_3: number;
  goldBorder_1: number;
  goldBorder_2: number;
  goldBorder_3: number;
}

/** One of the (exactly 3) songs played back-to-back in a dan. */
export interface OdaiSong {
  /** Song No.; stored as `songNo` here and as `uniqueId` in musicinfo. */
  songNo: number;
  /** Course index: 1 Easy · 2 Normal · 3 Hard · 4 Oni · 5 Ura Oni. */
  level: number;
  /** Hide the song title in-game (a "?" challenge stage). */
  isHiddenSongName: boolean;
}

/** One dan rank — a row of `dan_data.json` / `gaiden_data.json`. */
export interface DanEntry {
  /** Unique rank id. Normal dans 1..19 in the corpus; gaiden continues (20+). */
  danId: number;
  /** Version; bump on edit so the client re-fetches updated odai (see PLAN.md, Dani Dojo). */
  verupNo: number;
  /** Rank key (see DAN_TITLE_KEYS); free text for gaiden entries. */
  title: string;
  /** The 3 stage songs. */
  aryOdaiSong: OdaiSong[];
  /** 1..N pass/clear criteria. */
  aryOdaiBorder: OdaiBorder[];
}

/** A whole dani config file: an array of dan entries. */
export type DanConfig = DanEntry[];

/** The game UI (and grader) assumes exactly this many songs per dan. */
export const EXPECTED_ODAI_SONGS = 3;

/**
 * Every official dan (段位道場 2020–2025 + the CHN corpus) carries at most this
 * many clear criteria, and the in-game result screen shows exactly four
 * (条件1〜条件4). Used for a "too many criteria" warning, not a hard cap.
 */
export const MAX_ODAI_BORDERS = 4;

// odaiType values referenced by structural conventions (see DAN_CONDITION_TYPES).
export const ODAI_TYPE_SOUL_GAUGE = 1;
export const ODAI_TYPE_DRUMROLL = 6;
export const ODAI_TYPE_SCORE = 7;

// ── odaiType — DanConditionType (Domain/Enums/DanConditionType.cs) ─────────
export type DanConditionComparison = '<' | '≥';

export interface DanConditionType {
  value: number;
  /** Enum name from DanConditionType.cs. */
  name: string;
  /** Human label (with the in-game kanji where it has one). */
  label: string;
  /** Unit the red/gold thresholds are expressed in. */
  unit: string;
  /**
   * The exact pass comparison: OkCount and BadCount use 未満 (`<`); every other
   * condition uses 以上 (`≥`). This is separate from red/gold threshold
   * ordering: for `<` conditions, gold is normally no higher than red.
   */
  comparison: DanConditionComparison;
}

export const DAN_CONDITION_TYPES: readonly DanConditionType[] = [
  { value: 1, name: 'SoulGauge', label: 'Soul Gauge', unit: '%', comparison: '≥' },
  { value: 2, name: 'GoodCount', label: 'Good · 良', unit: 'hits', comparison: '≥' },
  { value: 3, name: 'OkCount', label: 'OK · 可', unit: 'hits', comparison: '<' },
  { value: 4, name: 'BadCount', label: 'Bad · 不可', unit: 'hits', comparison: '<' },
  { value: 5, name: 'ComboCount', label: 'Max Combo', unit: 'combo', comparison: '≥' },
  { value: 6, name: 'DrumrollCount', label: 'Drumroll', unit: 'hits', comparison: '≥' },
  { value: 7, name: 'Score', label: 'Score', unit: 'pts', comparison: '≥' },
  { value: 8, name: 'TotalHitCount', label: 'Total Hits · 連打含む', unit: 'hits', comparison: '≥' },
];

export function danConditionType(value: number): DanConditionType | undefined {
  return DAN_CONDITION_TYPES.find((t) => t.value === value);
}

// ── borderType — DanBorderType (Domain/Enums/DanBorderType.cs) ─────────────
export const BORDER_TYPE_ALL = 1;
export const BORDER_TYPE_PER_SONG = 2;

export const DAN_BORDER_TYPES: readonly { value: number; name: string; label: string }[] = [
  { value: BORDER_TYPE_ALL, name: 'All', label: 'Whole set' },
  { value: BORDER_TYPE_PER_SONG, name: 'PerSong', label: 'Per song' },
];

// ── level — course index used by OdaiSong.level ───────────────────────────
export const DAN_COURSES: readonly { value: number; label: string }[] = [
  { value: 1, label: 'Easy' },
  { value: 2, label: 'Normal' },
  { value: 3, label: 'Hard' },
  { value: 4, label: 'Oni' },
  { value: 5, label: 'Ura Oni' },
];

export function danCourseLabel(level: number): string {
  return DAN_COURSES.find((c) => c.value === level)?.label ?? `Lv ${level}`;
}

// ── title — rank keys (DaniDojo.razor.cs:GetDanTitle) ──────────────────────
// A closed key set mapped to localized names in-game/WebUI. Not free text for
// normal dans; gaiden entries use bespoke keys (e.g. "gaiden_2022_odai_7").
export const DAN_TITLE_KEYS: readonly { key: string; label: string; jp: string }[] = [
  { key: '5kyuu', label: 'Fifth Kyuu', jp: '五級' },
  { key: '4kyuu', label: 'Fourth Kyuu', jp: '四級' },
  { key: '3kyuu', label: 'Third Kyuu', jp: '三級' },
  { key: '2kyuu', label: 'Second Kyuu', jp: '二級' },
  { key: '1kyuu', label: 'First Kyuu', jp: '一級' },
  { key: '1dan', label: 'First Dan', jp: '初段' },
  { key: '2dan', label: 'Second Dan', jp: '二段' },
  { key: '3dan', label: 'Third Dan', jp: '三段' },
  { key: '4dan', label: 'Fourth Dan', jp: '四段' },
  { key: '5dan', label: 'Fifth Dan', jp: '五段' },
  { key: '6dan', label: 'Sixth Dan', jp: '六段' },
  { key: '7dan', label: 'Seventh Dan', jp: '七段' },
  { key: '8dan', label: 'Eighth Dan', jp: '八段' },
  { key: '9dan', label: 'Ninth Dan', jp: '九段' },
  { key: '10dan', label: 'Tenth Dan', jp: '十段' },
  { key: '11dan', label: 'Kuroto', jp: '玄人' },
  { key: '12dan', label: 'Meijin', jp: '名人' },
  { key: '13dan', label: 'Chojin', jp: '超人' },
  { key: '14dan', label: 'Tatsujin', jp: '達人' },
  { key: '15dan', label: 'Gaiden', jp: '外伝' },
];

/** Localized rank name for a title key, or the raw key (gaiden/unknown). */
export function danTitleLabel(title: string): string {
  const known = DAN_TITLE_KEYS.find((t) => t.key === title);
  return known ? `${known.label} · ${known.jp}` : title;
}

/** Rank kanji + English name for a title key, for the two-line rank cell. */
export function danTitleParts(title: string): { jp: string; en: string } {
  const known = DAN_TITLE_KEYS.find((t) => t.key === title);
  return known ? { jp: known.jp, en: known.label } : { jp: '—', en: title };
}

// ── Normal-dojo positional titles ─────────────────────────────────────────
// The corpus's normal dans are a contiguous ladder: danId N always carries the
// N-th rank key (danId 1 = "5kyuu" … danId 19 = "14dan"). So a normal dan's
// title is positional, not free — added dans take the next rank automatically.
export const NORMAL_MAX_DANS = 19;

/** The rank key for the 0-based position of a normal dan (danId − 1). */
export function normalDanTitleForIndex(index: number): string {
  return DAN_TITLE_KEYS[index]?.key ?? '';
}
