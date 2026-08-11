// In-memory representation of a Taiko CHN (v12r00_cn) fumen chart.
//
// Format reverse-engineered against the real corpus under
// resources/TaikoCHN/Data/x64/fumen/ and cross-validated against tja2fumen
// (https://github.com/vivaria/tja2fumen, MIT). The struct shapes used here
// match tja2fumen's struct format strings:
//
//   measure header : "ffBBHiiiiiii" (40 bytes)
//   per branch     : "HHf"          (8 bytes)
//   per note       : "ififHHf"      (24 bytes)
//   drumroll suffix: 8 raw bytes (only for note types 0x6 and 0x9)
//
// Design principle: every byte of the original payload must round-trip
// exactly. Fields we understand are typed; unknown bytes are preserved
// verbatim in opaque Uint8Array slices so encode() reproduces them.

export const FUMEN_HEADER_SIZE = 520;

/** The header's first 432 bytes are 108 little-endian f32 hit-timing-window
 *  thresholds; the remaining 88 bytes are 22 i32 fields. */
export const FUMEN_TIMING_WINDOW_COUNT = 108;

/** Measure header: bpm(4) + offset(4) + gogo(1) + barline(1) + pad(2)
 *  + branch_info[6](24) + measure_padding(4) = 40 */
export const FUMEN_MEASURE_HEADER_SIZE = 40;

/** Per-branch fixed: total_notes(u16,2) + padding(u16,2) + speed(f32,4) */
export const FUMEN_BRANCH_HEADER_SIZE = 8;

/** Per-note size: type(4) + pos(4) + item(4) + pad(4) + scoreInit(2) + scoreDiff(2) + duration(4) */
export const FUMEN_NOTE_SIZE = 24;

/** Drumroll/balloon notes have 8 extra trailing bytes preserved verbatim. */
export const FUMEN_DRUMROLL_SUFFIX_SIZE = 8;

/** Branches per measure: normal, professional, master. */
export const FUMEN_BRANCH_COUNT = 3;

/** Note types that have an 8-byte drumroll suffix following their 24-byte record. */
export const DRUMROLL_NOTE_TYPES = new Set<number>([0x6, 0x9]);

/** Symbolic names for fumen note type ids (from tja2fumen FUMEN_NOTE_TYPES). */
export const FUMEN_NOTE_TYPE_NAMES: Record<number, string> = {
  0x1: 'Don',
  0x2: 'Don2',
  0x3: 'Don3',
  0x4: 'Ka',
  0x5: 'Ka2',
  0x6: 'Drumroll',
  0x7: 'DON',
  0x8: 'KA',
  0x9: 'DRUMROLL',
  0xa: 'Balloon',
  0xb: 'DON2',
  0xc: 'Kusudama',
  0xd: 'KA2',
};

/**
 * Note-type ids that appear in the corpus but whose individual gameplay meaning
 * is not yet confirmed. Every one is confined to the `wii5op` medley (Taiko Wii 5
 * opening) and its difficulty/player variants, is a tap-type note (duration 0,
 * score-bearing — not a roll or balloon), carries no drumroll suffix, and
 * round-trips byte-perfectly. The editor renders and preserves them (and allows
 * move/delete) but does not author them, since naming each id (hakushu/bongo/etc.)
 * needs the tja2fumen note table or an in-game cross-check. See spec.md.
 *
 * Census basis (2026-06-12, full corpus): ids 0x0e,0x0f,0x10,0x11,0x13,0x14,0x15,
 * 0x16,0x18,0x19 — ~486 notes, all in wii5op.
 */
export const SPECIAL_NOTE_TYPES = new Set<number>([
  0x0e, 0x0f, 0x10, 0x11, 0x13, 0x14, 0x15, 0x16, 0x18, 0x19,
]);

/** True when the note type is named or a documented special (wii5op) type. */
export function isKnownNoteType(type: number): boolean {
  return type in FUMEN_NOTE_TYPE_NAMES || SPECIAL_NOTE_TYPES.has(type);
}

/** A display label for any note type: its symbolic name, a `Special 0xNN` label
 *  for the documented wii5op specials, or `Unknown 0xNN` for anything else. */
export function fumenNoteTypeLabel(type: number): string {
  const name = FUMEN_NOTE_TYPE_NAMES[type];
  if (name) return name;
  const hex = `0x${type.toString(16)}`;
  return SPECIAL_NOTE_TYPES.has(type) ? `Special ${hex}` : `Unknown ${hex}`;
}

export interface FumenNote {
  type: number;        // i32
  position: number;    // f32 (ms within measure)
  item: number;        // i32
  padding: number;     // f32 (kept verbatim)
  scoreInit: number;   // u16 — 初項: legacy base score (uniform per chart); balloon/kusudama hit count for 0xa/0xc
  scoreDiff: number;   // u16 — 公差: legacy per-10-combo increment (uniform per chart); 0 only on balloons/drumrolls. See spec.md "Scoring model".
  duration: number;    // f32 (ms; for drumrolls/balloons)
  /** For drumroll-type notes only (0x6 and 0x9): 8 trailing bytes. */
  drumrollSuffix?: Uint8Array;
}

export interface FumenBranch {
  /** Padding after the u16 note count; observed as 0 but preserved verbatim. */
  padding: number;   // u16
  speed: number;     // f32 (scroll multiplier)
  notes: FumenNote[];
}

export interface FumenMeasure {
  bpm: number;
  offset: number;
  gogo: number;       // u8 (0/1)
  barline: number;    // u8 (0/1)
  padding1: number;   // u16 (after barline; observed 0)
  branchInfo: [number, number, number, number, number, number]; // i32[6]
  padding2: number;   // i32 (after branch_info; observed 0)
  branches: [FumenBranch, FumenBranch, FumenBranch];
}

/**
 * The 520-byte fumen header, typed against tja2fumen's `FumenHeader`
 * (https://github.com/vivaria/tja2fumen, MIT) and confirmed field-by-field
 * against the CHN `v12r00_cn` corpus (Phase 8.4 — see spec.md). Decode→encode is
 * byte-perfect through these fields (verified on all 15,075 corpus charts), so the
 * header carries no opaque tail. Byte offsets are relative to the header start.
 */
export interface FumenHeader {
  /** Bytes 0..431: 108 f32 = 36 identical (GOOD, OK, BAD) hit-window triples in
   *  ms, keyed by difficulty (half-frame multiples at 59.94 Hz). Three profiles:
   *  strict 25.025/75.075/108.44 (Hard/Oni/Ura), lenient 41.71/108.44/125.125
   *  (Easy/Normal), lenient-wide 41.71/125.125/125.125 (some 1★ Easy). Only the
   *  wii5op medley varies within its 108. See spec.md "Timing windows". */
  timingWindows: number[]; // length FUMEN_TIMING_WINDOW_COUNT
  /** byte 432 — stored "chart has branches" flag (0/1). **Not** derivable from
   *  note presence: 39 corpus charts set it inconsistently with their branch
   *  notes, so it is an independent persisted field (Phase 8.5 makes it editable). */
  hasBranches: number;
  hpMax: number; // 436 — soul-gauge max (corpus: always 10000)
  hpClear: number; // 440 — gauge needed to clear (corpus: 6000/7000/8000)
  hpGainGood: number; // 444 — gauge gain on a GOOD hit
  hpGainOk: number; // 448 — gauge gain on an OK hit
  hpLossBad: number; // 452 — gauge loss on a BAD hit (negative)
  normalNormalRatio: number; // 456 — score ratio (corpus: always 65536)
  normalProfessionalRatio: number; // 460 — branch score ratio
  normalMasterRatio: number; // 464 — branch score ratio
  branchPtsGood: number; // 468 — branch points for a GOOD hit
  branchPtsOk: number; // 472 — branch points for an OK hit
  branchPtsBad: number; // 476 — branch points for a BAD hit
  branchPtsDrumroll: number; // 480 — branch points per drumroll hit
  branchPtsGoodBig: number; // 484 — branch points for a big-note GOOD
  branchPtsOkBig: number; // 488 — branch points for a big-note OK
  branchPtsDrumrollBig: number; // 492 — branch points per big-drumroll hit
  branchPtsBalloon: number; // 496 — branch points per balloon hit
  branchPtsKusudama: number; // 500 — branch points per kusudama hit
  branchPtsUnknown: number; // 504 — reserved branch-points field (corpus: 0/20)
  dummyData: number; // 508 — legacy 旧配点 theoretical max score of the master branch (derived; see spec.md "Scoring model")
  measureCount: number; // 512 — number of measures that follow the header
  unknownData: number; // 516 — reserved (corpus: always 0 in all 15,075 files), preserved verbatim
}

export interface Fumen {
  /** The 520-byte header as a typed struct (see FumenHeader). */
  header: FumenHeader;
  measures: FumenMeasure[];
  /** Any trailing bytes after the last measure; preserved verbatim. */
  trailer: Uint8Array;
}
