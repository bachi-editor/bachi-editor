// Load + decode the three v1 datatables from an open ProjectRoot.
//
// We always go through the AES+gzip envelope (codec/envelope) — even though
// TaikoLocalServer prefers `.json` siblings when they exist, the game itself
// reads the .bin and that's our source of truth.

import {
  decodeJsonPayload,
  openEnvelope,
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

export interface RawDatatables {
  musicinfo: MusicInfoFile;
  musicOrder: MusicOrderFile;
  wordlist: WordListFile;
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

export async function loadDatatables(root: ProjectRoot): Promise<RawDatatables> {
  const key = datatableKeyOf(root);
  const [musicinfo, musicOrder, wordlist] = await Promise.all([
    readJsonBin<MusicInfoFile>(root.datatable, 'musicinfo.bin', key),
    readJsonBin<MusicOrderFile>(root.datatable, 'music_order.bin', key),
    readJsonBin<WordListFile>(root.datatable, 'wordlist.bin', key),
  ]);
  return { musicinfo, musicOrder, wordlist };
}
