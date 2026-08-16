// Project-root handling. The user opens the game's `Data/` folder; the datatable
// files we edit live one level deeper under `Data/x64/` (`datatable/`, `fumen/`,
// `sound/`). We remember the folder the user actually picked (so re-grant and the
// path crumb reflect their choice) and auto-descend to the `x64/` that holds those
// three directories. The picker accepts:
//   - the `Data/` folder (descends into `x64/`), or
//   - the `x64/` directory directly, or
//   - any ancestor (e.g. `TaikoCHN/`) we can auto-descend through to reach it.
// Auto-descend is deliberately conservative (a few well-known sub-paths) to avoid
// guessing.

import {
  decodeFumen,
  decodeJsonPayload,
  detectGameVersion,
  isValidKeyHex,
  openEnvelope,
  type GameVersion,
  type MusicInfoFile,
} from '../codec';

const REQUIRED_CHILDREN = ['datatable', 'fumen', 'sound'] as const;

/** The two AES-256 keys (64 hex chars each) the user supplies to open a project. */
export interface ProjectKeys {
  /** Decodes datatable/*.bin (musicinfo, music_order, wordlist). */
  datatable: string;
  /** Decodes fumen/<id>/*.bin charts. */
  fumen: string;
}

/** Resolved project directories before keys and data semantics are validated. */
export interface ProjectDirectories {
  /**
   * The folder the user picked and we remember — typically the game `Data/`
   * folder (may also be `x64/` itself or an ancestor). Used for re-grant and the
   * displayed path; the data directories below are resolved under its `x64/`.
   */
  handle: FileSystemDirectoryHandle;
  /** The child directories we'll read from (resolved under `handle`'s `x64/`). */
  datatable: FileSystemDirectoryHandle;
  fumen: FileSystemDirectoryHandle;
  sound: FileSystemDirectoryHandle;
}

/** A fully opened project whose game-data semantics have been selected. */
export interface ProjectRoot extends ProjectDirectories {
  /**
   * Data-family semantics selected and validated when the project was opened.
   */
  gameVersion: GameVersion;
  /**
   * The AES keys used for this project's load/save. Optional only so focused
   * tests can construct roots for code paths that never decode game files.
   */
  keys?: ProjectKeys;
}

export type ProjectOpenError =
  | { kind: 'cancelled' }
  | { kind: 'permission-denied' }
  | { kind: 'invalid'; reason: string };

/**
 * From the folder the user picked, find the directory that actually holds the
 * datatable/fumen/sound children — i.e. the `x64/`. Checks the picked folder
 * itself and a few well-known sub-paths so users can pick `Data/` (the common
 * case), `x64/` directly, or an ancestor like `TaikoCHN/`.
 */
async function findX64Dir(start: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle | undefined> {
  const candidates: FileSystemDirectoryHandle[] = [start];
  // Try common ancestor paths: <picked>/Data/x64, <picked>/x64
  for (const subPath of [['Data', 'x64'], ['x64']]) {
    let cur: FileSystemDirectoryHandle | undefined = start;
    for (const seg of subPath) {
      try {
        cur = await cur!.getDirectoryHandle(seg);
      } catch {
        cur = undefined;
        break;
      }
    }
    if (cur) candidates.push(cur);
  }
  for (const c of candidates) {
    if (await hasAllRequiredChildren(c)) return c;
  }
  return undefined;
}

async function hasAllRequiredChildren(dir: FileSystemDirectoryHandle): Promise<boolean> {
  for (const name of REQUIRED_CHILDREN) {
    try {
      await dir.getDirectoryHandle(name);
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Resolve project directories: `handle` is the folder the user picked (what we
 * remember/show), while the data directories are resolved under `x64` (the dir
 * `findX64Dir` located, which may be `handle` itself or a descendant).
 */
async function intoProjectDirectories(
  handle: FileSystemDirectoryHandle,
  x64: FileSystemDirectoryHandle,
): Promise<ProjectDirectories> {
  const [datatable, fumen, sound] = await Promise.all(
    REQUIRED_CHILDREN.map((name) => x64.getDirectoryHandle(name)),
  );
  return { handle, datatable, fumen, sound };
}

/** Read permission on a stored handle. Will not prompt. */
export async function queryRead(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  // queryPermission lives on the handle prototype but isn't fully typed.
  type WithPerms = FileSystemDirectoryHandle & {
    queryPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
    requestPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  };
  const fn = (handle as WithPerms).queryPermission;
  if (typeof fn !== 'function') return 'granted';
  return fn.call(handle, { mode: 'readwrite' });
}

/** Request read/write permission on a stored handle. Will show the browser prompt. */
export async function requestReadWrite(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  type WithPerms = FileSystemDirectoryHandle & {
    requestPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  };
  const fn = (handle as WithPerms).requestPermission;
  if (typeof fn !== 'function') return 'granted';
  return fn.call(handle, { mode: 'readwrite' });
}

/**
 * Prompt the user to pick a folder and validate it.
 * Returns resolved directories on success, or a `ProjectOpenError` discriminator.
 */
export async function pickProject(): Promise<
  { ok: true; root: ProjectDirectories } | { ok: false; error: ProjectOpenError }
> {
  type WithPicker = Window & {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  };
  const showPicker = (window as WithPicker).showDirectoryPicker;
  if (typeof showPicker !== 'function') {
    return { ok: false, error: { kind: 'invalid', reason: 'showDirectoryPicker is unavailable.' } };
  }
  let picked: FileSystemDirectoryHandle;
  try {
    picked = await showPicker({ mode: 'readwrite' });
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
      return { ok: false, error: { kind: err.name === 'NotAllowedError' ? 'permission-denied' : 'cancelled' } };
    }
    throw err;
  }
  return await validateProjectHandle(picked);
}

/** Validate an existing (e.g. IDB-persisted) handle. */
export async function validateProjectHandle(
  handle: FileSystemDirectoryHandle,
): Promise<{ ok: true; root: ProjectDirectories } | { ok: false; error: ProjectOpenError }> {
  const x64 = await findX64Dir(handle);
  if (!x64) {
    return {
      ok: false,
      error: {
        kind: 'invalid',
        reason:
          `Picked folder "${handle.name}" does not look like a Taiko install. ` +
          `Expected to find datatable/, fumen/, and sound/ subdirectories ` +
          `(either directly or under Data/x64/).`,
      },
    };
  }
  return { ok: true, root: await intoProjectDirectories(handle, x64) };
}

// ── Multi-step open flow (pick folder → paste keys → validate + open) ─────────
// Settings keeps folder selection and the two AES keys separate so they can be
// validated together on the final "Open Project" click, with a field-specific
// error when something is off.

/**
 * Which part of the open form failed validation, so the UI can point the user
 * at the right field. `reason` distinguishes a malformed key ('format', 64 hex
 * chars) from a well-formed key that simply didn't decrypt ('decrypt').
 */
export type OpenValidationError =
  | { field: 'folder' }
  | { field: 'datatable'; reason: 'format' | 'decrypt' }
  | { field: 'fumen'; reason: 'format' | 'decrypt' }
  | { field: 'gameVersion'; selected: GameVersion; detected: GameVersion }
  | { field: 'generic'; message: string };

/** Show the OS folder picker (step 1). Does not validate — that happens on open. */
export async function pickProjectFolder(): Promise<
  | { ok: true; handle: FileSystemDirectoryHandle }
  | { ok: false; cancelled: boolean; message?: string }
> {
  type WithPicker = Window & {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  };
  const showPicker = (window as WithPicker).showDirectoryPicker;
  if (typeof showPicker !== 'function') {
    return { ok: false, cancelled: false, message: 'showDirectoryPicker is unavailable.' };
  }
  try {
    const handle = await showPicker({ mode: 'readwrite' });
    return { ok: true, handle };
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
      return { ok: false, cancelled: err.name === 'AbortError' };
    }
    throw err;
  }
}

async function readBinBytes(dir: FileSystemDirectoryHandle, name: string): Promise<Uint8Array> {
  const handle = await dir.getFileHandle(name);
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

/** Decrypt musicinfo once for both key validation and game-version detection. */
async function decodeMusicInfo(
  datatable: FileSystemDirectoryHandle,
  keyHex: string,
): Promise<MusicInfoFile | undefined> {
  try {
    const { payload } = await openEnvelope(await readBinBytes(datatable, 'musicinfo.bin'), keyHex);
    const musicinfo = decodeJsonPayload<MusicInfoFile>(payload);
    if (!Array.isArray(musicinfo?.items)) return undefined;
    return musicinfo;
  } catch {
    return undefined;
  }
}

/** Find any one `.bin` chart under fumen/<id>/, to probe the fumen key against. */
async function firstFumenBytes(fumen: FileSystemDirectoryHandle): Promise<Uint8Array | undefined> {
  try {
    for await (const [, entry] of fumen as unknown as AsyncIterable<[string, FileSystemHandle]>) {
      if (entry.kind !== 'directory') continue;
      const songDir = entry as unknown as FileSystemDirectoryHandle;
      for await (const [name, child] of songDir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (child.kind === 'file' && name.endsWith('.bin')) {
          const file = await (child as unknown as FileSystemFileHandle).getFile();
          return new Uint8Array(await file.arrayBuffer());
        }
      }
    }
  } catch {
    // Unreadable fumen tree — treat as "no sample" (can't deep-check the key).
  }
  return undefined;
}

/** True if `keyHex` decodes a sample chart; 'no-sample' when none exists to test. */
async function fumenKeyDecrypts(fumen: FileSystemDirectoryHandle, keyHex: string): Promise<boolean | 'no-sample'> {
  const bytes = await firstFumenBytes(fumen);
  if (!bytes) return 'no-sample';
  try {
    const { payload } = await openEnvelope(bytes, keyHex);
    decodeFumen(payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate the picked folder + the two pasted keys, then build the ProjectRoot
 * (step 3). Checks, in order: folder shape, key formats, then that each key
 * actually decrypts real files. On success the returned root carries the keys,
 * so every later load/save uses them.
 */
export async function openProjectWithKeys(
  handle: FileSystemDirectoryHandle,
  keys: ProjectKeys,
  gameVersion: GameVersion,
): Promise<{ ok: true; root: ProjectRoot } | { ok: false; error: OpenValidationError }> {
  const x64 = await findX64Dir(handle);
  if (!x64) return { ok: false, error: { field: 'folder' } };

  const datatableKey = keys.datatable.trim();
  const fumenKey = keys.fumen.trim();
  if (!isValidKeyHex(datatableKey)) return { ok: false, error: { field: 'datatable', reason: 'format' } };
  if (!isValidKeyHex(fumenKey)) return { ok: false, error: { field: 'fumen', reason: 'format' } };

  try {
    const root: ProjectRoot = {
      ...(await intoProjectDirectories(handle, x64)),
      keys: { datatable: datatableKey, fumen: fumenKey },
      gameVersion,
    };
    const musicinfo = await decodeMusicInfo(root.datatable, datatableKey);
    if (!musicinfo) {
      return { ok: false, error: { field: 'datatable', reason: 'decrypt' } };
    }
    const detected = detectGameVersion(musicinfo);
    if (detected && detected !== gameVersion) {
      return {
        ok: false,
        error: { field: 'gameVersion', selected: gameVersion, detected },
      };
    }
    if ((await fumenKeyDecrypts(root.fumen, fumenKey)) === false) {
      return { ok: false, error: { field: 'fumen', reason: 'decrypt' } };
    }
    return { ok: true, root };
  } catch (e) {
    return { ok: false, error: { field: 'generic', message: (e as Error).message } };
  }
}
