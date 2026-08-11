import { FUMEN_HEADER_SIZE, FUMEN_TIMING_WINDOW_COUNT, FumenHeader } from './types';

// The 88 bytes after the 432-byte timing-window block are 22 little-endian i32
// fields. This table is the single source of truth for their (key, byte-offset)
// mapping, shared by decode + encode so the two can never drift. Mapped against
// tja2fumen's FumenHeader and confirmed against the CHN v12r00_cn corpus (Phase
// 8.4 probe — see spec.md).
type FumenHeaderIntKey = Exclude<keyof FumenHeader, 'timingWindows'>;

const INT_FIELDS: ReadonlyArray<readonly [FumenHeaderIntKey, number]> = [
  ['hasBranches', 432],
  ['hpMax', 436],
  ['hpClear', 440],
  ['hpGainGood', 444],
  ['hpGainOk', 448],
  ['hpLossBad', 452],
  ['normalNormalRatio', 456],
  ['normalProfessionalRatio', 460],
  ['normalMasterRatio', 464],
  ['branchPtsGood', 468],
  ['branchPtsOk', 472],
  ['branchPtsBad', 476],
  ['branchPtsDrumroll', 480],
  ['branchPtsGoodBig', 484],
  ['branchPtsOkBig', 488],
  ['branchPtsDrumrollBig', 492],
  ['branchPtsBalloon', 496],
  ['branchPtsKusudama', 500],
  ['branchPtsUnknown', 504],
  ['dummyData', 508],
  ['measureCount', 512],
  ['unknownData', 516],
];

/**
 * Decode the 520-byte fumen header into a typed struct. `bytes` may be the full
 * payload (only the first FUMEN_HEADER_SIZE bytes are read). Round-trips through
 * encodeHeader byte-perfectly for every corpus chart.
 */
export function decodeHeader(bytes: Uint8Array): FumenHeader {
  if (bytes.length < FUMEN_HEADER_SIZE) {
    throw new Error(`fumen header too small: ${bytes.length} bytes (need ≥${FUMEN_HEADER_SIZE})`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const timingWindows: number[] = new Array(FUMEN_TIMING_WINDOW_COUNT);
  for (let i = 0; i < FUMEN_TIMING_WINDOW_COUNT; i++) {
    timingWindows[i] = view.getFloat32(i * 4, true);
  }
  const header = { timingWindows } as FumenHeader;
  for (const [key, off] of INT_FIELDS) header[key] = view.getInt32(off, true);
  return header;
}

/** Serialize a typed header back to its 520 bytes. Inverse of decodeHeader. */
export function encodeHeader(header: FumenHeader): Uint8Array {
  if (header.timingWindows.length !== FUMEN_TIMING_WINDOW_COUNT) {
    throw new Error(
      `header.timingWindows must be ${FUMEN_TIMING_WINDOW_COUNT} floats, got ${header.timingWindows.length}`,
    );
  }
  const out = new Uint8Array(FUMEN_HEADER_SIZE);
  const view = new DataView(out.buffer);
  for (let i = 0; i < FUMEN_TIMING_WINDOW_COUNT; i++) {
    view.setFloat32(i * 4, header.timingWindows[i], true);
  }
  for (const [key, off] of INT_FIELDS) view.setInt32(off, header[key], true);
  return out;
}

/**
 * Build a header with sensible defaults (tja2fumen's, which match the CHN corpus
 * for the constant fields — hpMax 10000, normalNormalRatio 65536, etc.). Timing
 * windows default to zeros; a chart cloned from a real one (cloneFumen) carries
 * the real values. Intended for blank-chart scaffolding and tests.
 */
export function makeFumenHeader(overrides: Partial<FumenHeader> = {}): FumenHeader {
  return {
    timingWindows: new Array(FUMEN_TIMING_WINDOW_COUNT).fill(0),
    hasBranches: 0,
    hpMax: 10000,
    hpClear: 8000,
    hpGainGood: 10,
    hpGainOk: 5,
    hpLossBad: -20,
    normalNormalRatio: 65536,
    normalProfessionalRatio: 65536,
    normalMasterRatio: 65536,
    branchPtsGood: 20,
    branchPtsOk: 10,
    branchPtsBad: 0,
    branchPtsDrumroll: 1,
    branchPtsGoodBig: 20,
    branchPtsOkBig: 10,
    branchPtsDrumrollBig: 1,
    branchPtsBalloon: 30,
    branchPtsKusudama: 30,
    branchPtsUnknown: 20,
    dummyData: 0,
    measureCount: 0,
    unknownData: 0,
    ...overrides,
  };
}
