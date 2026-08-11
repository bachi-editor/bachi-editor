// JSON shapes for the CHN datatable .bin files. These are gzip+AES-wrapped
// JSON texts; see codec/envelope.ts. All top-level shapes use { items: [...] }.
//
// Field names mirror the actual on-disk JSON exactly so we can round-trip
// without renaming. Additional fields encountered at runtime are passed
// through via the index signature on each item type.

export interface MusicInfoItem {
  /** Numeric Song No. Game/server APIs call this song_no, MusicId, or SongId. */
  uniqueId: number;
  /** String Song ID used by fumen folders and wordlist keys (e.g. "10binz"). */
  id: string;
  /** System-managed relative sound path, e.g. "sound/song_10binz". */
  songFileName?: string;
  genreNo?: number;
  /** Enables the game's Papa/Mama support behavior for this song. */
  papamama?: boolean;
  /** Whether each difficulty contains branching routes. `Mania` is Oni. */
  branchEasy?: boolean;
  branchNormal?: boolean;
  branchHard?: boolean;
  branchMania?: boolean;
  branchUra?: boolean;
  /** Difficulty stars per level (0=easy, 1=normal, 2=hard, 3=oni, 4=ura). */
  starEasy?: number;
  starNormal?: number;
  starHard?: number;
  starMania?: number;
  starUra?: number;
  shinutiEasy?: number;
  shinutiNormal?: number;
  shinutiHard?: number;
  shinutiMania?: number;
  shinutiUra?: number;
  shinutiEasyDuet?: number;
  shinutiNormalDuet?: number;
  shinutiHardDuet?: number;
  shinutiManiaDuet?: number;
  shinutiUraDuet?: number;
  shinutiScoreEasy?: number;
  shinutiScoreNormal?: number;
  shinutiScoreHard?: number;
  shinutiScoreMania?: number;
  shinutiScoreUra?: number;
  shinutiScoreEasyDuet?: number;
  shinutiScoreNormalDuet?: number;
  shinutiScoreHardDuet?: number;
  shinutiScoreManiaDuet?: number;
  shinutiScoreUraDuet?: number;
  easyOnpuNum?: number;
  normalOnpuNum?: number;
  hardOnpuNum?: number;
  maniaOnpuNum?: number;
  uraOnpuNum?: number;
  rendaTimeEasy?: number;
  rendaTimeNormal?: number;
  rendaTimeHard?: number;
  rendaTimeMania?: number;
  rendaTimeUra?: number;
  fuusenTotalEasy?: number;
  fuusenTotalNormal?: number;
  fuusenTotalHard?: number;
  fuusenTotalMania?: number;
  fuusenTotalUra?: number;
  /** Current CHN-only special-chart flags. This family spells Oni explicitly. */
  spikeOnEasy?: boolean;
  spikeOnNormal?: boolean;
  spikeOnHard?: boolean;
  spikeOnOni?: boolean;
  spikeOnUra?: boolean;
  [extra: string]: unknown;
}

/** Fields maintained by the editor rather than directly edited by the user. */
export const MUSICINFO_SYSTEM_MANAGED_FIELDS = ['songFileName'] as const;

/**
 * Values generated from the difficulty fumens. They remain in musicinfo.bin
 * for the game, but the Metadata UI must not treat them as free-form inputs.
 */
export const MUSICINFO_CHART_DERIVED_FIELDS = [
  'branchEasy', 'branchNormal', 'branchHard', 'branchMania', 'branchUra',
  'easyOnpuNum', 'normalOnpuNum', 'hardOnpuNum', 'maniaOnpuNum', 'uraOnpuNum',
  'rendaTimeEasy', 'rendaTimeNormal', 'rendaTimeHard', 'rendaTimeMania', 'rendaTimeUra',
  'fuusenTotalEasy', 'fuusenTotalNormal', 'fuusenTotalHard', 'fuusenTotalMania', 'fuusenTotalUra',
] as const;

/**
 * Every user-editable post-creation musicinfo field. Identity (`uniqueId`,
 * `id`), canonical `genreNo`, system-managed fields, and chart-derived fields
 * are deliberately absent.
 */
export const MUSICINFO_EDITABLE_FIELDS = [
  'papamama',
  'starEasy', 'starNormal', 'starHard', 'starMania', 'starUra',
  'shinutiEasy', 'shinutiNormal', 'shinutiHard', 'shinutiMania', 'shinutiUra',
  'shinutiEasyDuet', 'shinutiNormalDuet', 'shinutiHardDuet', 'shinutiManiaDuet', 'shinutiUraDuet',
  'shinutiScoreEasy', 'shinutiScoreNormal', 'shinutiScoreHard', 'shinutiScoreMania', 'shinutiScoreUra',
  'shinutiScoreEasyDuet', 'shinutiScoreNormalDuet', 'shinutiScoreHardDuet', 'shinutiScoreManiaDuet', 'shinutiScoreUraDuet',
  'spikeOnEasy', 'spikeOnNormal', 'spikeOnHard', 'spikeOnOni', 'spikeOnUra',
] as const;

/** Complete non-identity field list supported by the current editor. */
export const MUSICINFO_SUPPORTED_FIELDS = [
  ...MUSICINFO_SYSTEM_MANAGED_FIELDS,
  ...MUSICINFO_CHART_DERIVED_FIELDS,
  ...MUSICINFO_EDITABLE_FIELDS,
] as const;

export type MusicInfoChartDerivedField = (typeof MUSICINFO_CHART_DERIVED_FIELDS)[number];
export type MusicInfoChartDerivedPatch = Partial<Pick<MusicInfoItem, MusicInfoChartDerivedField>>;
export type MusicInfoEditableField = (typeof MUSICINFO_EDITABLE_FIELDS)[number];
export type MusicInfoEditablePatch = Partial<Pick<MusicInfoItem, MusicInfoEditableField>>;

export interface MusicInfoFile {
  items: MusicInfoItem[];
  [extra: string]: unknown;
}

export interface MusicOrderItem {
  /** Song No. (matches MusicInfoItem.uniqueId). */
  uniqueId: number;
  /** Song ID (matches MusicInfoItem.id). */
  id?: string;
  genreNo?: number;
  closeDispType?: number;
  [extra: string]: unknown;
}

export interface MusicOrderFile {
  items: MusicOrderItem[];
  [extra: string]: unknown;
}

export interface WordListItem {
  key: string;
  japaneseText?: string;
  englishUsText?: string;
  chineseTText?: string;
  chineseSText?: string;
  koreanText?: string;
  [extra: string]: unknown;
}

export interface WordListFile {
  items: WordListItem[];
  [extra: string]: unknown;
}

/** Generic decode: any datatable wrapped in { items: [...] }. */
export interface GenericDatatableFile {
  items: unknown[];
  [extra: string]: unknown;
}
