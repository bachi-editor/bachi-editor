// Save pipeline: encode dirty datatables through the AES+gzip envelope, then
// write the new bytes directly to their production targets.
//
// Only the datatables the user actually edited are written — untouched files
// keep their original on-disk bytes. An edited file is re-emitted in the layout
// it already had on disk (see codec/datatable/serde), so the diff against the
// game's own file stays confined to the records the user actually changed.
// The File System Access API's createWritable swaps the file contents once
// close() resolves without creating sidecar files in the game data folder.

import {
  detectPayloadStyle,
  encodeStyledJsonPayload,
  MINIFIED_JSON_STYLE,
  openEnvelope,
  sealEnvelope,
  verifyEncoderSelfConsistent,
  type JsonTextStyle,
} from '../codec';
import type { Fumen, MusicInfoItem } from '../codec';
import { patchNus3BankDemoStartMs } from '../codec';
import type { ProjectRoot } from './project';
import { datatableKeyOf, type RawDatatables } from './datatables';
import { fumenKeyOf } from './fumens';
import { diffDatatables, DatatableName } from '../model/diff';

const FILE_KEYS: Record<DatatableName, keyof RawDatatables> = {
  'musicinfo.bin': 'musicinfo',
  'music_order.bin': 'musicOrder',
  'wordlist.bin': 'wordlist',
  'music_attribute.bin': 'musicAttribute',
  'music_usbsetting.bin': 'musicUsbSetting',
  'music_ai_section.bin': 'musicAiSection',
};

/** Encode a datatable object to its on-disk bytes (JSON → gzip → AES). */
export async function sealDatatable(
  obj: unknown,
  keyHex: string,
  style: JsonTextStyle = MINIFIED_JSON_STYLE,
): Promise<Uint8Array> {
  return sealEnvelope(encodeStyledJsonPayload(obj, style), keyHex);
}

/**
 * The JSON layout of the file we are about to overwrite. Read from disk rather
 * than remembered from load, so the style matches whatever is actually there.
 * A file we cannot read back falls through to compact JSON — a formatting
 * preference must never be the thing that blocks a save.
 *
 * Exported because the server bundle seals the same objects (see fs/exportBundle)
 * and must produce the same bytes a save would.
 */
export async function datatableStyleOnDisk(root: ProjectRoot, name: DatatableName, keyHex: string): Promise<JsonTextStyle> {
  try {
    const bytes = await readBytes(root.datatable, name);
    if (!bytes) return MINIFIED_JSON_STYLE;
    const { payload } = await openEnvelope(bytes, keyHex);
    return detectPayloadStyle(payload);
  } catch {
    return MINIFIED_JSON_STYLE;
  }
}

type WritableFileHandle = FileSystemFileHandle & {
  createWritable?: (opts?: { keepExistingData?: boolean }) => Promise<FileSystemWritableFileStream>;
};

/**
 * True when the project root's handles support writing through the File System
 * Access API.
 */
export function canWrite(root: ProjectRoot): boolean {
  const h = root.datatable as unknown as { getFileHandle?: unknown };
  return typeof h.getFileHandle === 'function';
}

async function readBytes(dir: FileSystemDirectoryHandle, name: string): Promise<Uint8Array | undefined> {
  try {
    const fh = await dir.getFileHandle(name);
    const f = await fh.getFile();
    return new Uint8Array(await f.arrayBuffer());
  } catch {
    return undefined;
  }
}

async function writeBytes(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<void> {
  const fh = (await dir.getFileHandle(name, { create: true })) as WritableFileHandle;
  if (typeof fh.createWritable !== 'function') {
    throw new Error(`This folder is read-only (no write access to ${name}).`);
  }
  const w = await fh.createWritable();
  // Cast: the lib.dom typings narrow BufferSource to ArrayBuffer-backed views,
  // but a Uint8Array<ArrayBufferLike> is always fine at runtime.
  await w.write(bytes as unknown as BufferSource);
  await w.close();
}

export interface SavedFile {
  file: DatatableName;
  byteDelta: number;
}

/** One chart slot written back to disk (edited or newly created). */
export interface SavedFumen {
  songId: string;
  filename: string;
  byteDelta: number;
}

/** One chart slot removed from disk. */
export interface RemovedFumen {
  songId: string;
  filename: string;
  /** Negative: bytes removed. 0 if the file was already gone. */
  byteDelta: number;
}

/** A deleted song whose on-disk assets were removed. */
export interface RemovedAsset {
  songId: string;
}

/** One sound-bank metadata patch written back to disk. */
export interface SavedSoundBank {
  filename: string;
  byteDelta: number;
}

export interface SaveResult {
  saved: SavedFile[];
  savedFumens: SavedFumen[];
  savedSoundBanks: SavedSoundBank[];
  /** Newly created chart files (e.g. a new Ura triple). */
  createdFumens: SavedFumen[];
  /** Chart files removed (e.g. a deleted Ura). */
  removedFumens: RemovedFumen[];
  removedAssets: RemovedAsset[];
}

type RemovableDir = FileSystemDirectoryHandle & {
  removeEntry?: (name: string, opts?: { recursive?: boolean }) => Promise<void>;
};

/** Best-effort remove; returns false if the handle can't delete or the entry is gone. */
async function removeEntrySafe(
  dir: FileSystemDirectoryHandle,
  name: string,
  recursive = false,
): Promise<boolean> {
  const fn = (dir as RemovableDir).removeEntry;
  if (typeof fn !== 'function') return false;
  try {
    await fn.call(dir, name, { recursive });
    return true;
  } catch {
    return false;
  }
}

/** Resolve a song's sound file name from its musicinfo.songFileName declaration. */
function soundFileFor(item: MusicInfoItem): string | undefined {
  const v = item.songFileName;
  if (typeof v !== 'string' || v.trim().length === 0) return undefined;
  const base = v.split('/').pop() ?? v; // "sound/song_x" → "song_x"
  return base.endsWith('.nus3bank') ? base : `${base}.nus3bank`;
}

/** Remove a deleted song's fumen folder without creating sidecar files. */
async function deleteFumenFolder(root: ProjectRoot, songId: string): Promise<void> {
  try {
    await root.fumen.getDirectoryHandle(songId);
  } catch {
    return;
  }
  if (!await removeEntrySafe(root.fumen, songId, true)) {
    throw new Error(`This folder cannot remove fumen/${songId}.`);
  }
}

/** Remove a deleted song's sound bank without creating sidecar files. */
async function deleteSoundFile(root: ProjectRoot, item: MusicInfoItem): Promise<void> {
  const file = soundFileFor(item);
  if (!file) return;
  if (!await readBytes(root.sound, file)) return;
  if (!await removeEntrySafe(root.sound, file)) {
    throw new Error(`This folder cannot remove sound/${file}.`);
  }
}

/** A chart slot the user edited, ready to be sealed and written. */
export interface DirtyFumenInput {
  songId: string;
  filename: string;
  fumen: Fumen;
}

/** Seal a fumen through the AES+gzip envelope with the given fumen key. */
export async function sealFumen(fumen: Fumen, keyHex: string): Promise<Uint8Array> {
  // Encoder self-check (PLAN 5.4): encode → decode → re-encode must be byte-equal.
  // A failure means the in-memory codec would corrupt this chart — abort before
  // anything touches disk.
  const check = verifyEncoderSelfConsistent(fumen);
  if (!check.ok) {
    throw new Error('Encoder self-check failed — chart not written (codec bug). No files were changed.');
  }
  return sealEnvelope(check.bytesA, keyHex);
}

/** A chart slot to remove from disk. */
export interface RemovedFumenInput {
  songId: string;
  filename: string;
}

/** A sound-bank metadata edit ready to be patched into sound/<filename>. */
export interface DirtySoundBankInput {
  filename: string;
  preferredStem?: string;
  demoStartMs: number;
}

/** Remove one chart file under fumen/<id>/. */
async function removeFumenSlot(root: ProjectRoot, input: RemovedFumenInput): Promise<RemovedFumen> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await root.fumen.getDirectoryHandle(input.songId);
  } catch {
    return { songId: input.songId, filename: input.filename, byteDelta: 0 }; // folder already gone
  }
  const original = await readBytes(dir, input.filename);
  if (!original) {
    return { songId: input.songId, filename: input.filename, byteDelta: 0 }; // file already gone
  }
  if (!await removeEntrySafe(dir, input.filename)) {
    throw new Error(`This folder cannot remove fumen/${input.songId}/${input.filename}.`);
  }
  return { songId: input.songId, filename: input.filename, byteDelta: -original.length };
}

/** Write one chart slot in place under fumen/<id>/. */
async function writeFumenSlot(root: ProjectRoot, input: DirtyFumenInput): Promise<SavedFumen> {
  const newBytes = await sealFumen(input.fumen, fumenKeyOf(root));
  const dir = await root.fumen.getDirectoryHandle(input.songId, { create: true });
  const original = await readBytes(dir, input.filename);
  await writeBytes(dir, input.filename, newBytes);
  return {
    songId: input.songId,
    filename: input.filename,
    byteDelta: newBytes.length - (original?.length ?? 0),
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Patch one sound bank's metadata in place under sound/. */
async function writeSoundBankMetadata(
  root: ProjectRoot,
  input: DirtySoundBankInput,
): Promise<SavedSoundBank | undefined> {
  const original = await readBytes(root.sound, input.filename);
  if (!original) {
    throw new Error(`sound/${input.filename} does not exist on disk.`);
  }
  const newBytes = patchNus3BankDemoStartMs(original, input.preferredStem, input.demoStartMs);
  if (bytesEqual(original, newBytes)) return undefined;
  await writeBytes(root.sound, input.filename, newBytes);
  return {
    filename: input.filename,
    byteDelta: newBytes.length - original.length,
  };
}

/**
 * Write every dirty datatable and every edited chart slot in place. Returns
 * what was written so the UI can report it. The encoder self-check runs on
 * each chart *before* any chart byte is written, so a codec
 * bug aborts without partial chart writes. Throws on the first write failure.
 */
export async function saveDatatables(
  root: ProjectRoot,
  baseline: RawDatatables,
  draft: RawDatatables,
  dirtyFumens: DirtyFumenInput[] = [],
  createdFumens: DirtyFumenInput[] = [],
  removedFumens: RemovedFumenInput[] = [],
  dirtySoundBanks: DirtySoundBankInput[] = [],
): Promise<SaveResult> {
  if (!canWrite(root)) {
    throw new Error('This project is open read-only. Re-open via the folder picker to save.');
  }
  // Self-check every chart to be written (edited + created) up front: if any
  // fails, abort before writing anything.
  for (const f of [...dirtyFumens, ...createdFumens]) {
    if (!verifyEncoderSelfConsistent(f.fumen).ok) {
      throw new Error(
        `Encoder self-check failed for ${f.songId}/${f.filename} — no files were written.`,
      );
    }
  }
  const diff = diffDatatables(baseline, draft);
  const saved: SavedFile[] = [];

  for (const fd of diff.files) {
    if (!fd.dirty) continue;
    const name = fd.file;
    const obj = draft[FILE_KEYS[name]];
    // A companion table the project does not have is never dirty, but never
    // write `undefined` over a real file if that ever changes.
    if (!obj) continue;
    const key = datatableKeyOf(root);
    const newBytes = await sealDatatable(obj, key, await datatableStyleOnDisk(root, name, key));
    const original = await readBytes(root.datatable, name);

    await writeBytes(root.datatable, name, newBytes);
    saved.push({ file: name, byteDelta: newBytes.length - (original?.length ?? 0) });
  }

  // Reconcile the filesystem for *deleted* songs: a song present in baseline but
  // gone from the draft has its fumen folder + sound file removed.
  // (Added songs create no files — they start chartless/silent until the user
  // supplies them.) The datatables are written first, so the catalogue no longer
  // references these files before we touch them.
  const removedAssets: RemovedAsset[] = [];
  const draftIds = new Set(draft.musicinfo.items.map((i) => i.uniqueId));
  const removedSongs = baseline.musicinfo.items.filter((i) => !draftIds.has(i.uniqueId));
  for (const item of removedSongs) {
    await deleteFumenFolder(root, item.id);
    await deleteSoundFile(root, item);
    removedAssets.push({ songId: item.id });
  }

  // Remove deleted chart slots (e.g. a turned-off Ura).
  const removed: RemovedFumen[] = [];
  for (const r of removedFumens) {
    removed.push(await removeFumenSlot(root, r));
  }

  // Write edited charts (datatables already point at them; an added song's
  // first chart simply appears under its fumen/<id>/ folder).
  const savedFumens: SavedFumen[] = [];
  for (const f of dirtyFumens) {
    savedFumens.push(await writeFumenSlot(root, f));
  }

  // Write newly created chart slots last.
  const createdSaved: SavedFumen[] = [];
  for (const f of createdFumens) {
    createdSaved.push(await writeFumenSlot(root, f));
  }

  // Patch sound-bank metadata last. This only changes TONE metadata bytes;
  // encoded audio data is preserved as-is.
  const savedSoundBanks: SavedSoundBank[] = [];
  for (const s of dirtySoundBanks) {
    const savedSound = await writeSoundBankMetadata(root, s);
    if (savedSound) savedSoundBanks.push(savedSound);
  }

  return {
    saved,
    savedFumens,
    savedSoundBanks,
    createdFumens: createdSaved,
    removedFumens: removed,
    removedAssets,
  };
}
