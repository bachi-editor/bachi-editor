// Load + decode the datatables the editor owns from an open ProjectRoot.
//
// We always go through the AES+gzip envelope (codec/envelope) — even though
// TaikoLocalServer prefers `.json` siblings when they exist, the game itself
// reads the .bin and that's our source of truth.
//
// Three of the six are *companion* tables: per-song rows the editor never edits
// field-by-field but must keep in step with musicinfo, because the game reads
// them when a song starts. See CompanionSongFile in codec/datatable/types.

import {
  decodeJsonPayload,
  openEnvelope,
  CompanionSongFile,
  MusicInfoFile,
  MusicOrderFile,
  WordListFile,
} from '../codec';
import type { ProjectRoot } from './project';

/** The user-supplied datatable key for this project. */
export function datatableKeyOf(root: ProjectRoot): string {
  const key = root.keys?.datatable;
  if (!key) throw new Error('Datatable key is not set for this project.');
  return key;
}

/**
 * Companion tables, keyed by the `RawDatatables` field that holds them. A
 * project that is missing one simply leaves that field undefined: the editor
 * still works, it just cannot maintain what is not there.
 */
export const COMPANION_TABLES = {
  musicAttribute: 'music_attribute.bin',
  musicUsbSetting: 'music_usbsetting.bin',
  musicAiSection: 'music_ai_section.bin',
} as const;

export type CompanionTableKey = keyof typeof COMPANION_TABLES;

export const COMPANION_TABLE_KEYS = Object.keys(COMPANION_TABLES) as CompanionTableKey[];

export interface RawDatatables {
  musicinfo: MusicInfoFile;
  musicOrder: MusicOrderFile;
  wordlist: WordListFile;
  musicAttribute?: CompanionSongFile;
  musicUsbSetting?: CompanionSongFile;
  musicAiSection?: CompanionSongFile;
}

async function readBinFile(dir: FileSystemDirectoryHandle, name: string): Promise<Uint8Array> {
  const handle = await dir.getFileHandle(name);
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function readJsonBin<T>(dir: FileSystemDirectoryHandle, name: string, keyHex: string): Promise<T> {
  const bytes = await readBinFile(dir, name);
  const { payload } = await openEnvelope(bytes, keyHex);
  return decodeJsonPayload<T>(payload);
}

/**
 * A genuinely absent companion table is tolerated so an older/incomplete
 * project can still open and report the gap. A present table that cannot be
 * decrypted or decoded is corruption, so loading stops instead of silently
 * treating it as absent and later exporting a partial catalogue.
 */
async function readCompanion(
  dir: FileSystemDirectoryHandle,
  name: string,
  keyHex: string,
): Promise<CompanionSongFile | undefined> {
  try {
    const file = await readJsonBin<CompanionSongFile>(dir, name, keyHex);
    if (!Array.isArray(file?.items)) {
      throw new Error(`${name} does not contain an items array.`);
    }
    return file;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return undefined;
    throw new Error(
      `Could not load ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function loadDatatables(root: ProjectRoot): Promise<RawDatatables> {
  const key = datatableKeyOf(root);
  const [musicinfo, musicOrder, wordlist] = await Promise.all([
    readJsonBin<MusicInfoFile>(root.datatable, 'musicinfo.bin', key),
    readJsonBin<MusicOrderFile>(root.datatable, 'music_order.bin', key),
    readJsonBin<WordListFile>(root.datatable, 'wordlist.bin', key),
  ]);
  const companions = await Promise.all(
    COMPANION_TABLE_KEYS.map((field) => readCompanion(root.datatable, COMPANION_TABLES[field], key)),
  );
  const out: RawDatatables = { musicinfo, musicOrder, wordlist };
  COMPANION_TABLE_KEYS.forEach((field, index) => {
    if (companions[index]) out[field] = companions[index];
  });
  return out;
}
