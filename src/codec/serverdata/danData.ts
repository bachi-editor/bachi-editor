// Dani config codec-lite: plaintext JSON text ↔ typed DanConfig.
//
// Unlike the game datatables there is no AES/gzip envelope — these files are
// plaintext on disk. But byte-perfect round-trip still matters (an unchanged
// file must re-save identically, and diffs must be clean), and the on-disk
// style is NOT what `JSON.stringify(v, null, 2)` produces. The real
// `dan_data.json` / `gaiden_data.json` use, verified against the corpus:
//   • 2-space indentation, LF newlines
//   • NO space after the key colon  ("danId":1, not "danId": 1)
//   • NO trailing newline (the file ends at the final `]`)
//   • border objects OMIT the fields that don't apply to their borderType:
//       borderType 1 (All)     → odaiType,borderType,redBorderTotal,goldBorderTotal
//       borderType 2 (PerSong) → odaiType,borderType,{red,gold}Border_1/_2/_3 (interleaved)
//
// `serializeDanConfig` reproduces all of that; `test/codec/danData.test.ts`
// proves parse→serialize is byte-identical over both real files.

import {
  BORDER_TYPE_PER_SONG,
  type DanConfig,
  type DanEntry,
  type OdaiBorder,
  type OdaiSong,
} from './types';

/** Parse dani JSON text into the typed model. Throws on non-dani input. */
export function parseDanConfig(text: string): DanConfig {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error(`Not valid JSON: ${(e as Error).message}`);
  }
  if (!Array.isArray(data)) {
    throw new Error('A dani file must be a JSON array of dan entries.');
  }
  return data.map((entry, i) => parseDanEntry(entry, i));
}

function parseDanEntry(entry: unknown, index: number): DanEntry {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`Dan entry #${index} is not an object.`);
  }
  const e = entry as Record<string, unknown>;
  // A minimal shape gate so opening the wrong file (e.g. musicinfo.json) fails
  // loudly rather than producing a garbage config.
  if (typeof e.danId !== 'number' || !Array.isArray(e.aryOdaiSong) || !Array.isArray(e.aryOdaiBorder)) {
    throw new Error(`Dan entry #${index} is missing danId / aryOdaiSong / aryOdaiBorder — is this a dani file?`);
  }
  return {
    danId: numOr0(e.danId),
    verupNo: numOr0(e.verupNo),
    title: typeof e.title === 'string' ? e.title : '',
    aryOdaiSong: e.aryOdaiSong.map(parseOdaiSong),
    aryOdaiBorder: e.aryOdaiBorder.map(parseOdaiBorder),
  };
}

function parseOdaiSong(song: unknown): OdaiSong {
  const s = (typeof song === 'object' && song !== null ? song : {}) as Record<string, unknown>;
  return {
    songNo: numOr0(s.songNo),
    level: numOr0(s.level),
    isHiddenSongName: s.isHiddenSongName === true,
  };
}

function parseOdaiBorder(border: unknown): OdaiBorder {
  const b = (typeof border === 'object' && border !== null ? border : {}) as Record<string, unknown>;
  // Every threshold defaults to 0; the on-disk file only carries the ones its
  // borderType uses, and the serializer re-emits by borderType.
  return {
    odaiType: numOr0(b.odaiType),
    borderType: numOr0(b.borderType),
    redBorderTotal: numOr0(b.redBorderTotal),
    goldBorderTotal: numOr0(b.goldBorderTotal),
    redBorder_1: numOr0(b.redBorder_1),
    redBorder_2: numOr0(b.redBorder_2),
    redBorder_3: numOr0(b.redBorder_3),
    goldBorder_1: numOr0(b.goldBorder_1),
    goldBorder_2: numOr0(b.goldBorder_2),
    goldBorder_3: numOr0(b.goldBorder_3),
  };
}

function numOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Serialize the typed model back to on-disk dani JSON text (byte-exact style). */
export function serializeDanConfig(config: DanConfig): string {
  return serializeValue(config.map(danEntryToPlain), 0);
}

// The plain objects below fix the on-disk key ORDER and, for borders, the
// borderType-conditional key SET. `serializeValue` then handles the whitespace.

function danEntryToPlain(d: DanEntry): Record<string, unknown> {
  return {
    danId: d.danId,
    verupNo: d.verupNo,
    title: d.title,
    aryOdaiSong: d.aryOdaiSong.map(odaiSongToPlain),
    aryOdaiBorder: d.aryOdaiBorder.map(odaiBorderToPlain),
  };
}

function odaiSongToPlain(s: OdaiSong): Record<string, unknown> {
  return { songNo: s.songNo, level: s.level, isHiddenSongName: s.isHiddenSongName };
}

function odaiBorderToPlain(b: OdaiBorder): Record<string, unknown> {
  if (b.borderType === BORDER_TYPE_PER_SONG) {
    // PerSong: interleaved red/gold per song (the corpus key order).
    return {
      odaiType: b.odaiType,
      borderType: b.borderType,
      redBorder_1: b.redBorder_1,
      goldBorder_1: b.goldBorder_1,
      redBorder_2: b.redBorder_2,
      goldBorder_2: b.goldBorder_2,
      redBorder_3: b.redBorder_3,
      goldBorder_3: b.goldBorder_3,
    };
  }
  // All (borderType 1) — and any other value falls back to the All shape.
  return {
    odaiType: b.odaiType,
    borderType: b.borderType,
    redBorderTotal: b.redBorderTotal,
    goldBorderTotal: b.goldBorderTotal,
  };
}

/**
 * Pretty-print a JSON value the way the dani files are written: 2-space indent,
 * `":"` with no following space, no trailing newline. Leaves are delegated to
 * `JSON.stringify` so string escaping and number formatting stay correct.
 */
function serializeValue(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  const padInner = '  '.repeat(indent + 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const items = value.map((v) => padInner + serializeValue(v, indent + 1));
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const items = entries.map(
      ([k, v]) => `${padInner}${JSON.stringify(k)}:${serializeValue(v, indent + 1)}`,
    );
    return `{\n${items.join(',\n')}\n${pad}}`;
  }
  return JSON.stringify(value);
}
