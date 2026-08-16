// Sound-bank file management for the Sound tab. Replacements and removals touch
// only the per-song production file under sound/.

import { readNus3BankId, type MusicInfoItem } from '../codec';
import type { ProjectRoot } from './project';

export interface ResolvedSoundFile {
  /** File name under root.sound, e.g. "song_10binz.nus3bank". */
  filename: string;
  /** Display path relative to x64/, e.g. "sound/song_10binz.nus3bank". */
  displayPath: string;
  /** Datatable declaration without the .nus3bank extension. */
  declaration: string;
  /** Whether the path came from musicinfo.songFileName rather than convention. */
  declared: boolean;
}

export interface SoundFileInfo {
  resolved: ResolvedSoundFile;
  exists: boolean;
  size: number;
  modified?: number;
  sha256?: string;
}

export interface SoundWriteResult {
  filename: string;
  byteDelta: number;
}

type WritableFileHandle = FileSystemFileHandle & {
  createWritable?: (opts?: { keepExistingData?: boolean }) => Promise<FileSystemWritableFileStream>;
};

type RemovableDir = FileSystemDirectoryHandle & {
  removeEntry?: (name: string, opts?: { recursive?: boolean }) => Promise<void>;
};

function normalizeSeparators(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

function withoutNus3bankExt(name: string): string {
  return name.toLowerCase().endsWith('.nus3bank') ? name.slice(0, -'.nus3bank'.length) : name;
}

/** Resolve the on-disk sound filename from musicinfo.songFileName. */
export function resolveSoundFile(item: MusicInfoItem): ResolvedSoundFile {
  const raw = typeof item.songFileName === 'string' ? normalizeSeparators(item.songFileName) : '';
  const declared = raw.length > 0;
  const declaration = declared ? withoutNus3bankExt(raw) : `sound/song_${item.id}`;
  const leaf = (declaration.split('/').filter(Boolean).pop() ?? `song_${item.id}`).trim();
  const filename = `${withoutNus3bankExt(leaf)}.nus3bank`;
  return {
    filename,
    displayPath: `sound/${filename}`,
    declaration,
    declared,
  };
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

async function readFile(dir: FileSystemDirectoryHandle, name: string): Promise<File | undefined> {
  try {
    const fh = await dir.getFileHandle(name);
    return await fh.getFile();
  } catch {
    return undefined;
  }
}

async function readBankIdPrefix(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<number | undefined> {
  try {
    const fh = await dir.getFileHandle(name);
    const file = await fh.getFile();
    const prefix = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
    return readNus3BankId(prefix);
  } catch {
    return undefined;
  }
}

/** Pick an unused id after the highest bank id the project currently stores. */
export function nextAvailableNus3BankId(ids: Iterable<number>, fallback: number): number {
  const used = new Set(
    [...ids].filter((id) => Number.isInteger(id) && id >= 0 && id <= 0xffff_ffff),
  );
  if (used.size === 0) return fallback;
  const highest = Math.max(...used);
  if (highest < 0xffff_ffff) return highest + 1;
  let candidate = 0;
  for (const id of [...used].sort((a, b) => a - b)) {
    if (id < candidate) continue;
    if (id > candidate) return candidate;
    candidate += 1;
  }
  if (candidate <= 0xffff_ffff) return candidate;
  throw new Error('The project has no unused nus3bank id.');
}

/**
 * Read only the small BINF-bearing prefix of each sound bank, in bounded
 * batches, and allocate a collision-free id for a newly created bank.
 */
export async function allocateNus3BankId(
  root: ProjectRoot,
  filenames: Iterable<string>,
  fallback: number,
): Promise<number> {
  const names = [...filenames].filter((name) => name.toLowerCase().endsWith('.nus3bank'));
  const ids: number[] = [];
  const batchSize = 32;
  for (let start = 0; start < names.length; start += batchSize) {
    const batch = await Promise.all(
      names.slice(start, start + batchSize).map((name) => readBankIdPrefix(root.sound, name)),
    );
    for (const id of batch) if (id !== undefined) ids.push(id);
  }
  return nextAvailableNus3BankId(ids, fallback);
}

async function writeBytes(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<void> {
  const fh = (await dir.getFileHandle(name, { create: true })) as WritableFileHandle;
  if (typeof fh.createWritable !== 'function') {
    throw new Error(`This folder is read-only (no write access to ${name}).`);
  }
  const w = await fh.createWritable();
  await w.write(bytes as unknown as BufferSource);
  await w.close();
}

async function removeEntrySafe(dir: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  const fn = (dir as RemovableDir).removeEntry;
  if (typeof fn !== 'function') return false;
  try {
    await fn.call(dir, name);
    return true;
  } catch {
    return false;
  }
}

async function sha256Short(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  const out = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return out.slice(0, 12);
}

export async function loadSoundFileInfo(root: ProjectRoot, item: MusicInfoItem): Promise<SoundFileInfo> {
  const resolved = resolveSoundFile(item);
  const file = await readFile(root.sound, resolved.filename);
  if (!file) {
    return { resolved, exists: false, size: 0 };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  return {
    resolved,
    exists: true,
    size: file.size,
    modified: file.lastModified,
    sha256: await sha256Short(bytes),
  };
}

/** Read the full bank bytes for decode/playback, or undefined when absent. */
export async function readSoundBankBytes(
  root: ProjectRoot,
  item: MusicInfoItem,
): Promise<Uint8Array | undefined> {
  const resolved = resolveSoundFile(item);
  return readBytes(root.sound, resolved.filename);
}

/** Overwrite or create the bank in place without creating sidecar files. */
export async function replaceSoundFile(
  root: ProjectRoot,
  item: MusicInfoItem,
  source: File,
): Promise<SoundWriteResult> {
  const resolved = resolveSoundFile(item);
  const original = await readBytes(root.sound, resolved.filename);
  const bytes = new Uint8Array(await source.arrayBuffer());
  await writeBytes(root.sound, resolved.filename, bytes);
  return {
    filename: resolved.filename,
    byteDelta: bytes.byteLength - (original?.byteLength ?? 0),
  };
}

/** Remove the existing bank from sound/ without creating sidecar files. */
export async function removeSoundFile(root: ProjectRoot, item: MusicInfoItem): Promise<SoundWriteResult> {
  const resolved = resolveSoundFile(item);
  const original = await readBytes(root.sound, resolved.filename);
  if (!original) {
    throw new Error(`${resolved.displayPath} does not exist on disk.`);
  }
  const removed = await removeEntrySafe(root.sound, resolved.filename);
  if (!removed) {
    throw new Error(`This folder cannot remove ${resolved.filename}.`);
  }
  return {
    filename: resolved.filename,
    byteDelta: -original.byteLength,
  };
}
