import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  pickProject,
  queryRead,
  requestReadWrite,
  validateProjectHandle,
} from '../../src/fs/project';

class MemDir {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, MemDir>();

  constructor(readonly name: string) {}

  add(name: string): MemDir {
    const dir = new MemDir(name);
    this.children.set(name, dir);
    return dir;
  }

  async getDirectoryHandle(name: string): Promise<MemDir> {
    const dir = this.children.get(name);
    if (!dir) throw new DOMException(`no dir ${name}`, 'NotFoundError');
    return dir;
  }
}

function addRequiredChildren(dir: MemDir): void {
  dir.add('datatable');
  dir.add('fumen');
  dir.add('sound');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('project root validation', () => {
  test('accepts an x64 directory directly', async () => {
    const x64 = new MemDir('x64');
    addRequiredChildren(x64);

    const result = await validateProjectHandle(x64 as unknown as FileSystemDirectoryHandle);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected project validation to pass');
    expect(result.root.handle).toBe(x64);
    expect(result.root.datatable).toBe(x64.children.get('datatable'));
    expect(result.root.fumen).toBe(x64.children.get('fumen'));
    expect(result.root.sound).toBe(x64.children.get('sound'));
  });

  test('finds x64 under a picked TaikoCHN/Data ancestor', async () => {
    const picked = new MemDir('TaikoCHN');
    const data = picked.add('Data');
    const x64 = data.add('x64');
    addRequiredChildren(x64);

    const result = await validateProjectHandle(picked as unknown as FileSystemDirectoryHandle);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected project validation to pass');
    // The remembered handle is the folder the user picked; the data dirs resolve under x64.
    expect(result.root.handle).toBe(picked);
    expect(result.root.datatable).toBe(x64.children.get('datatable'));
    expect(result.root.fumen).toBe(x64.children.get('fumen'));
    expect(result.root.sound).toBe(x64.children.get('sound'));
  });

  test('roots at the picked Data folder and descends into its x64 child', async () => {
    const picked = new MemDir('Data');
    const x64 = picked.add('x64');
    addRequiredChildren(x64);

    const result = await validateProjectHandle(picked as unknown as FileSystemDirectoryHandle);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected project validation to pass');
    expect(result.root.handle).toBe(picked);
    expect(result.root.datatable).toBe(x64.children.get('datatable'));
    expect(result.root.fumen).toBe(x64.children.get('fumen'));
    expect(result.root.sound).toBe(x64.children.get('sound'));
  });

  test('rejects folders without datatable, fumen, and sound directories', async () => {
    const picked = new MemDir('wrong-folder');
    picked.add('datatable');

    const result = await validateProjectHandle(picked as unknown as FileSystemDirectoryHandle);

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'invalid',
        reason:
          'Picked folder "wrong-folder" does not look like a Taiko install. ' +
          'Expected to find datatable/, fumen/, and sound/ subdirectories ' +
          '(either directly or under Data/x64/).',
      },
    });
  });
});

describe('project permissions', () => {
  test('queryRead defaults to granted when queryPermission is absent', async () => {
    await expect(queryRead({} as FileSystemDirectoryHandle)).resolves.toBe('granted');
  });

  test('queryRead asks for readwrite permission without prompting', async () => {
    const queryPermission = vi.fn().mockResolvedValue('prompt' satisfies PermissionState);
    const handle = { queryPermission } as unknown as FileSystemDirectoryHandle;

    await expect(queryRead(handle)).resolves.toBe('prompt');
    expect(queryPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  test('requestReadWrite defaults to granted when requestPermission is absent', async () => {
    await expect(requestReadWrite({} as FileSystemDirectoryHandle)).resolves.toBe('granted');
  });

  test('requestReadWrite asks for readwrite permission', async () => {
    const requestPermission = vi.fn().mockResolvedValue('granted' satisfies PermissionState);
    const handle = { requestPermission } as unknown as FileSystemDirectoryHandle;

    await expect(requestReadWrite(handle)).resolves.toBe('granted');
    expect(requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });
});

describe('pickProject', () => {
  test('returns an invalid error when the folder picker is unavailable', async () => {
    vi.stubGlobal('window', {});

    await expect(pickProject()).resolves.toEqual({
      ok: false,
      error: { kind: 'invalid', reason: 'showDirectoryPicker is unavailable.' },
    });
  });

  test('maps picker cancellation and denial to typed errors', async () => {
    const showDirectoryPicker = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'))
      .mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    vi.stubGlobal('window', { showDirectoryPicker });

    await expect(pickProject()).resolves.toEqual({ ok: false, error: { kind: 'cancelled' } });
    await expect(pickProject()).resolves.toEqual({ ok: false, error: { kind: 'permission-denied' } });
    expect(showDirectoryPicker).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  test('validates the picked directory on success', async () => {
    const picked = new MemDir('x64');
    addRequiredChildren(picked);
    const showDirectoryPicker = vi.fn().mockResolvedValue(picked);
    vi.stubGlobal('window', { showDirectoryPicker });

    const result = await pickProject();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected picker validation to pass');
    expect(result.root.handle).toBe(picked);
  });
});
