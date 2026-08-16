import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  loadProjectRootHandle,
  loadProjectRootRecord,
  saveProjectRootHandle,
} from '../../src/fs/idb';

function successfulRequest<T>(value: () => T, effect?: () => void): IDBRequest<T> {
  const request = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
  } as unknown as IDBRequest<T>;
  queueMicrotask(() => {
    effect?.();
    Object.defineProperty(request, 'result', { value: value(), configurable: true });
    request.onsuccess?.call(request, new Event('success'));
  });
  return request;
}

class MemoryIndexedDb {
  readonly values = new Map<IDBValidKey, unknown>();
  readonly puts: Array<{ key: IDBValidKey; value: unknown }> = [];
  private hasStore = false;

  readonly store = {
    put: (value: unknown, key: IDBValidKey) => successfulRequest(
      () => key,
      () => {
        this.values.set(key, value);
        this.puts.push({ key, value });
      },
    ),
    get: (key: IDBValidKey) => successfulRequest(() => this.values.get(key)),
    delete: (key: IDBValidKey) => successfulRequest(
      () => undefined,
      () => { this.values.delete(key); },
    ),
  };

  readonly db = {
    objectStoreNames: { contains: () => this.hasStore },
    createObjectStore: () => {
      this.hasStore = true;
      return this.store;
    },
    transaction: () => ({ objectStore: () => this.store }),
    close: () => undefined,
  };

  open(): IDBOpenDBRequest {
    const request = {
      result: this.db,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
    } as unknown as IDBOpenDBRequest;
    queueMicrotask(() => {
      if (!this.hasStore) request.onupgradeneeded?.call(request, new Event('upgradeneeded') as IDBVersionChangeEvent);
      request.onsuccess?.call(request, new Event('success'));
    });
    return request;
  }
}

const handle = (name: string) => ({ kind: 'directory', name }) as FileSystemDirectoryHandle;

let memory: MemoryIndexedDb;

beforeEach(() => {
  memory = new MemoryIndexedDb();
  vi.stubGlobal('indexedDB', memory as unknown as IDBFactory);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('project-root IndexedDB record', () => {
  test('stores the handle and game version in one wrapper write', async () => {
    const project = handle('Data');

    await saveProjectRootHandle(project, 'jpn');

    expect(memory.puts).toEqual([{
      key: 'projectRoot',
      value: { handle: project, gameVersion: 'jpn' },
    }]);
    await expect(loadProjectRootRecord()).resolves.toEqual({ handle: project, gameVersion: 'jpn' });
    await expect(loadProjectRootHandle()).resolves.toBe(project);
  });

  test('recognizes a legacy raw directory-handle value', async () => {
    const project = handle('legacy Data');
    // Version 1 stored the raw handle directly under this key.
    memory.values.set('projectRoot', project);

    await expect(loadProjectRootRecord()).resolves.toEqual({ handle: project });
    await expect(loadProjectRootHandle()).resolves.toBe(project);
  });

  test('keeps the remembered handle when a wrapper has an unknown version', async () => {
    const project = handle('future Data');
    memory.values.set('projectRoot', { handle: project, gameVersion: 'future' });

    await expect(loadProjectRootRecord()).resolves.toEqual({ handle: project });
  });
});
