// Tiny IndexedDB wrapper for browser-owned binary/handle persistence. File
// System handles and ArrayBuffers are structured-cloneable; handle permission
// state is not, so the next page load still has to query/request it.
//
// One database and one small object store are enough for the project/Dani
// handles plus the optional user-supplied G.719 codec modules.

import { isGameVersion, type GameVersion } from '../codec/datatable/gameVersion';

const DB_NAME = 'taiko-editor';
const DB_VERSION = 1;
const STORE = 'handles';
const ROOT_KEY = 'projectRoot';
const G719_WASM_KEY = 'g719DecoderWasm';
const G719_ENCODER_WASM_KEY = 'g719EncoderWasm';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const s = t.objectStore(STORE);
      const r = run(s);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}

export interface ProjectRootRecord {
  handle: FileSystemDirectoryHandle;
  gameVersion?: GameVersion;
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'directory';
}

export async function saveProjectRootHandle(
  handle: FileSystemDirectoryHandle,
  gameVersion: GameVersion,
): Promise<void> {
  // One structured-clone write keeps the handle and its interpretation atomic.
  const value: ProjectRootRecord = { handle, gameVersion };
  await tx('readwrite', (s) => s.put(value, ROOT_KEY));
}

/** Load the current wrapper, while upgrading legacy raw-handle values in memory. */
export async function loadProjectRootRecord(): Promise<ProjectRootRecord | undefined> {
  const value = await tx<unknown>('readonly', (s) => s.get(ROOT_KEY));
  if (isDirectoryHandle(value)) return { handle: value };
  if (typeof value !== 'object' || value === null) return undefined;

  const candidate = value as { handle?: unknown; gameVersion?: unknown };
  if (!isDirectoryHandle(candidate.handle)) return undefined;
  if (candidate.gameVersion === undefined) return { handle: candidate.handle };
  // Preserve the remembered folder if a future/invalid version value appears;
  // callers can ask the user to select its interpretation again.
  if (!isGameVersion(candidate.gameVersion)) return { handle: candidate.handle };
  return { handle: candidate.handle, gameVersion: candidate.gameVersion };
}

/** Legacy projection retained for callers that only need the remembered folder. */
export async function loadProjectRootHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return (await loadProjectRootRecord())?.handle;
}

export async function clearProjectRootHandle(): Promise<void> {
  await tx('readwrite', (s) => s.delete(ROOT_KEY));
}

// ── Optional user-supplied G.719 decoder ────────────────────────────────────
// The binary is intentionally not part of the application bundle. IndexedDB is
// a better fit than localStorage here: it stores the ArrayBuffer directly and
// avoids base64 expansion plus localStorage's synchronous main-thread I/O.

export interface StoredG719DecoderWasm {
  name: string;
  size: number;
  storedAt: number;
  bytes: ArrayBuffer;
}

export async function saveG719DecoderWasm(record: StoredG719DecoderWasm): Promise<void> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable in this browser.');
  await tx('readwrite', (s) => s.put(record, G719_WASM_KEY));
}

export async function loadG719DecoderWasm(): Promise<StoredG719DecoderWasm | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  const value = await tx<StoredG719DecoderWasm | undefined>('readonly', (s) =>
    s.get(G719_WASM_KEY) as IDBRequest<StoredG719DecoderWasm | undefined>,
  );
  if (
    !value
    || typeof value.name !== 'string'
    || typeof value.size !== 'number'
    || typeof value.storedAt !== 'number'
    || !(value.bytes instanceof ArrayBuffer)
  ) {
    return undefined;
  }
  return value;
}

export async function clearG719DecoderWasm(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await tx('readwrite', (s) => s.delete(G719_WASM_KEY));
}

// ── Optional user-supplied G.719 encoder ────────────────────────────────────

export interface StoredG719EncoderWasm {
  name: string;
  size: number;
  storedAt: number;
  bytes: ArrayBuffer;
}

export async function saveG719EncoderWasm(record: StoredG719EncoderWasm): Promise<void> {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is unavailable in this browser.');
  await tx('readwrite', (s) => s.put(record, G719_ENCODER_WASM_KEY));
}

export async function loadG719EncoderWasm(): Promise<StoredG719EncoderWasm | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  const value = await tx<StoredG719EncoderWasm | undefined>('readonly', (s) =>
    s.get(G719_ENCODER_WASM_KEY) as IDBRequest<StoredG719EncoderWasm | undefined>,
  );
  if (
    !value
    || typeof value.name !== 'string'
    || typeof value.size !== 'number'
    || typeof value.storedAt !== 'number'
    || !(value.bytes instanceof ArrayBuffer)
  ) {
    return undefined;
  }
  return value;
}

export async function clearG719EncoderWasm(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await tx('readwrite', (s) => s.delete(G719_ENCODER_WASM_KEY));
}

// ── Dani Dojo file handles ──────────────────────────────────────────────────
// The standalone dani editor keeps its own file handles (one per section) so a
// page reload can re-read the last-opened dan_data.json / gaiden_data.json,
// mirroring the project-root persistence (permission is still re-checked on load).
const DANI_KEY: Record<'normal' | 'gaiden', string> = {
  normal: 'daniNormalHandle',
  gaiden: 'daniGaidenHandle',
};

export async function saveDaniFileHandle(section: 'normal' | 'gaiden', handle: FileSystemFileHandle): Promise<void> {
  if (typeof indexedDB === 'undefined') return; // best-effort; unavailable in tests/SSR
  await tx('readwrite', (s) => s.put(handle, DANI_KEY[section]));
}

export async function loadDaniFileHandle(section: 'normal' | 'gaiden'): Promise<FileSystemFileHandle | undefined> {
  if (typeof indexedDB === 'undefined') return undefined;
  const value = await tx<FileSystemFileHandle | undefined>('readonly', (s) =>
    s.get(DANI_KEY[section]) as IDBRequest<FileSystemFileHandle | undefined>,
  );
  return value ?? undefined;
}

export async function clearDaniFileHandle(section: 'normal' | 'gaiden'): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await tx('readwrite', (s) => s.delete(DANI_KEY[section]));
}
