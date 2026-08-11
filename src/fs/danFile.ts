// Standalone single-file I/O for a Dani Dojo config (dan_data.json /
// gaiden_data.json). Deliberately NOT part of the game-project pipeline: no
// directory handle, no IndexedDB persistence, no wwwroot probing. Three verbs
// over one plaintext JSON file the user picks — Open · Save · Save As — plus a
// Blob-download fallback for browsers/paths without write access (see PLAN.md, Dani Dojo).

import { parseDanConfig, serializeDanConfig, type DanConfig } from '../codec/serverdata';

export interface DaniFileOpen {
  /** Kept in memory for the session so Save writes straight back. */
  handle: FileSystemFileHandle;
  fileName: string;
  config: DanConfig;
}

export type DaniFileError =
  | { kind: 'cancelled' }
  | { kind: 'unsupported'; reason: string }
  | { kind: 'read'; reason: string }
  | { kind: 'parse'; reason: string }
  | { kind: 'permission'; reason: string };

type OpenResult = { ok: true; file: DaniFileOpen } | { ok: false; error: DaniFileError };
type SaveAsResult =
  | { ok: true; handle: FileSystemFileHandle; fileName: string; bytes: number }
  | { ok: false; error: DaniFileError };

type WritableFileHandle = FileSystemFileHandle & {
  createWritable?: (opts?: { keepExistingData?: boolean }) => Promise<FileSystemWritableFileStream>;
  queryPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

type FilePickerType = { description?: string; accept: Record<string, string[]> };
type WithOpenPicker = Window & {
  showOpenFilePicker?: (opts?: {
    types?: FilePickerType[];
    excludeAcceptAllOption?: boolean;
    multiple?: boolean;
  }) => Promise<FileSystemFileHandle[]>;
};
type WithSavePicker = Window & {
  showSaveFilePicker?: (opts?: {
    suggestedName?: string;
    types?: FilePickerType[];
  }) => Promise<FileSystemFileHandle>;
};

const JSON_TYPES: FilePickerType[] = [{ description: 'Dani Dojo config', accept: { 'application/json': ['.json'] } }];

/** Whether the browser exposes the file open picker (Chromium only). */
export function canOpenDaniFile(): boolean {
  return typeof (window as WithOpenPicker).showOpenFilePicker === 'function';
}

/** Whether the browser exposes the save picker (for New / Save As). */
export function canSaveDaniFileAs(): boolean {
  return typeof (window as WithSavePicker).showSaveFilePicker === 'function';
}

/** Prompt the user to pick a dani JSON file, read + parse it, and keep the handle. */
export async function openDanFile(): Promise<OpenResult> {
  const show = (window as WithOpenPicker).showOpenFilePicker;
  if (typeof show !== 'function') {
    return { ok: false, error: { kind: 'unsupported', reason: 'showOpenFilePicker is unavailable in this browser.' } };
  }
  let handle: FileSystemFileHandle;
  try {
    [handle] = await show({ types: JSON_TYPES, multiple: false });
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
      return { ok: false, error: { kind: 'cancelled' } };
    }
    throw err;
  }
  let text: string;
  try {
    text = await (await handle.getFile()).text();
  } catch (e) {
    return { ok: false, error: { kind: 'read', reason: (e as Error).message } };
  }
  try {
    const config = parseDanConfig(text);
    return { ok: true, file: { handle, fileName: handle.name, config } };
  } catch (e) {
    return { ok: false, error: { kind: 'parse', reason: (e as Error).message } };
  }
}

/**
 * Write the config back through a bound handle (Open → edit → Save). Requests
 * read/write permission first; a denied write is surfaced typed so the UI can
 * fall back to Save As / download.
 */
export async function saveDanFile(handle: FileSystemFileHandle, config: DanConfig): Promise<{ bytes: number }> {
  const perm = await ensureWritable(handle);
  if (perm !== 'granted') {
    throw new DaniPermissionError('Write permission for this file was not granted.');
  }
  const wh = handle as WritableFileHandle;
  if (typeof wh.createWritable !== 'function') {
    throw new DaniPermissionError('This file is read-only (no write access).');
  }
  const text = serializeDanConfig(config);
  const w = await wh.createWritable();
  await w.write(text);
  await w.close();
  return { bytes: byteLength(text) };
}

/** Pick a new destination file and write the config there (New / Save As). */
export async function saveDanFileAs(config: DanConfig, suggestedName = 'dan_data.json'): Promise<SaveAsResult> {
  const show = (window as WithSavePicker).showSaveFilePicker;
  if (typeof show !== 'function') {
    return { ok: false, error: { kind: 'unsupported', reason: 'showSaveFilePicker is unavailable in this browser.' } };
  }
  let handle: FileSystemFileHandle;
  try {
    handle = await show({ suggestedName, types: JSON_TYPES });
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
      return { ok: false, error: { kind: 'cancelled' } };
    }
    throw err;
  }
  const wh = handle as WritableFileHandle;
  if (typeof wh.createWritable !== 'function') {
    return { ok: false, error: { kind: 'permission', reason: 'The chosen location is not writable.' } };
  }
  const text = serializeDanConfig(config);
  const w = await wh.createWritable();
  await w.write(text);
  await w.close();
  return { ok: true, handle, fileName: handle.name, bytes: byteLength(text) };
}

/** Blob download of the serialized config — the no-write-access fallback. */
export function downloadDanConfig(config: DanConfig, fileName = 'dan_data.json'): void {
  downloadText(serializeDanConfig(config), fileName);
}

/** Blob download of arbitrary serialized config text. */
function downloadText(text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been dispatched.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Raised when a write is refused so callers can offer Save As / download. */
export class DaniPermissionError extends Error {}

/**
 * Non-prompting read-permission query for reopening a persisted handle.
 * Returns 'granted' when the browser still trusts the handle without a gesture.
 */
export async function queryDaniReadPermission(handle: FileSystemFileHandle): Promise<PermissionState> {
  const wh = handle as WritableFileHandle;
  if (typeof wh.queryPermission === 'function') {
    return wh.queryPermission.call(handle, { mode: 'read' });
  }
  return 'granted';
}

async function ensureWritable(handle: FileSystemFileHandle): Promise<PermissionState> {
  const wh = handle as WritableFileHandle;
  if (typeof wh.queryPermission === 'function') {
    const q = await wh.queryPermission.call(handle, { mode: 'readwrite' });
    if (q === 'granted') return q;
  }
  if (typeof wh.requestPermission === 'function') {
    return wh.requestPermission.call(handle, { mode: 'readwrite' });
  }
  // No permission API (older/partial impls) — assume writable and let
  // createWritable surface any real failure.
  return 'granted';
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
