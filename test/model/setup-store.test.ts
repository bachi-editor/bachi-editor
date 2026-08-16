import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as datatablesFs from '../../src/fs/datatables';
import * as idb from '../../src/fs/idb';
import * as inventoryFs from '../../src/fs/inventory';
import * as projectFs from '../../src/fs/project';
import type { RawDatatables } from '../../src/fs/datatables';
import type { ProjectRoot } from '../../src/fs/project';
import { useAppStore } from '../../src/model/store';

const s = () => useAppStore.getState();
const initialSupport = s().support;
const initialUi = s().ui;

function fakeDirectory(name: string): FileSystemDirectoryHandle {
  return { kind: 'directory', name } as FileSystemDirectoryHandle;
}

function rememberKeys(): void {
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => key === 'tk-project-keys'
      ? JSON.stringify({ datatable: 'datatable-key', fumen: 'fumen-key' })
      : null),
    setItem: vi.fn(),
  });
}

function emptyDatatables(): RawDatatables {
  return {
    musicinfo: { items: [] },
    musicOrder: { items: [] },
    wordlist: { items: [] },
    musicAttribute: { items: [] },
    musicUsbSetting: { items: [] },
    musicAiSection: { items: [] },
  };
}

function mockSuccessfulOpen(handle: FileSystemDirectoryHandle, gameVersion: 'chn' | 'jpn') {
  const root: ProjectRoot = {
    handle,
    datatable: fakeDirectory('datatable'),
    fumen: fakeDirectory('fumen'),
    sound: fakeDirectory('sound'),
    gameVersion,
    keys: { datatable: 'datatable-key', fumen: 'fumen-key' },
  };
  const open = vi.spyOn(projectFs, 'openProjectWithKeys').mockResolvedValue({ ok: true, root });
  vi.spyOn(datatablesFs, 'loadDatatables').mockResolvedValue(emptyDatatables());
  vi.spyOn(inventoryFs, 'loadAssetInventory').mockResolvedValue({ fumenIds: new Set(), soundFiles: new Set() });
  const save = vi.spyOn(idb, 'saveProjectRootHandle').mockResolvedValue();
  return { root, open, save };
}

function resetSetup() {
  useAppStore.setState({
    support: initialSupport,
    project: { kind: 'idle' },
    setup: { remembered: false, datatableKey: '', fumenKey: '', gameVersion: undefined, busy: false },
    ui: { ...initialUi, settingsOpen: false },
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  resetSetup();
});

afterEach(() => vi.unstubAllGlobals());

describe('UI language', () => {
  test('setUiLang updates the store and drives the song-title locale', () => {
    s().setUiLang('ja');
    expect(s().ui.uiLang).toBe('ja');
    expect(s().ui.locale).toBe('japaneseText');
    s().setUiLang('zh-Hant');
    expect(s().ui.uiLang).toBe('zh-Hant');
    expect(s().ui.locale).toBe('chineseTText');
    s().setUiLang('en');
    expect(s().ui.locale).toBe('englishUsText');
  });
});

describe('project setup reducers', () => {
  test('setupSetKey updates one key and clears the previous error', () => {
    useAppStore.setState({
      setup: { ...s().setup, error: { field: 'datatable', reason: 'decrypt' } },
    });
    s().setupSetKey('datatable', 'abc');
    expect(s().setup.datatableKey).toBe('abc');
    expect(s().setup.fumenKey).toBe('');
    expect(s().setup.error).toBeUndefined();

    s().setupSetKey('fumen', 'def');
    expect(s().setup.fumenKey).toBe('def');
  });

  test('setupSetGameVersion updates the selection and clears the previous error', () => {
    useAppStore.setState({
      setup: { ...s().setup, error: { field: 'datatable', reason: 'decrypt' } },
    });

    s().setupSetGameVersion('jpn');

    expect(s().setup.gameVersion).toBe('jpn');
    expect(s().setup.error).toBeUndefined();
  });

  test('setupOpenProject is a no-op without a chosen folder', async () => {
    s().setupSetGameVersion('chn');
    await s().setupOpenProject();
    expect(s().project.kind).toBe('idle');
    expect(s().setup.busy).toBe(false);
  });

  test('setupOpenProject is a no-op without a selected game version', async () => {
    const open = vi.spyOn(projectFs, 'openProjectWithKeys');
    useAppStore.setState({
      setup: { ...s().setup, handle: fakeDirectory('project'), folderName: 'project' },
    });

    await s().setupOpenProject();

    expect(open).not.toHaveBeenCalled();
    expect(s().project.kind).toBe('idle');
    expect(s().setup.busy).toBe(false);
  });
});

describe('remembered project version gate', () => {
  test('a legacy handle-only record seeds Settings instead of opening silently', async () => {
    const handle = fakeDirectory('legacy-project');
    rememberKeys();
    vi.spyOn(idb, 'loadProjectRootRecord').mockResolvedValue({ handle });
    vi.spyOn(projectFs, 'queryRead').mockResolvedValue('granted');
    const open = vi.spyOn(projectFs, 'openProjectWithKeys');
    useAppStore.setState({ support: { ok: true, missing: [] } });

    await s().initFromStoredHandle();

    expect(open).not.toHaveBeenCalled();
    expect(s().project.kind).toBe('idle');
    expect(s().setup.handle).toBe(handle);
    expect(s().setup.gameVersion).toBeUndefined();
    expect(s().setup.remembered).toBe(true);
    expect(s().ui.settingsOpen).toBe(true);
  });

  test('permission reconnect without a remembered version seeds Settings', async () => {
    const handle = {
      ...fakeDirectory('permission-project'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
    } as FileSystemDirectoryHandle;
    rememberKeys();
    const open = vi.spyOn(projectFs, 'openProjectWithKeys');
    useAppStore.setState({ project: { kind: 'needs-permission', handle } });

    await s().reconnect();

    expect(open).not.toHaveBeenCalled();
    expect(s().project.kind).toBe('idle');
    expect(s().setup.handle).toBe(handle);
    expect(s().setup.gameVersion).toBeUndefined();
    expect(s().setup.remembered).toBe(true);
  });

  test('permission state preserves the remembered version', async () => {
    const handle = fakeDirectory('permission-project');
    vi.spyOn(idb, 'loadProjectRootRecord').mockResolvedValue({ handle, gameVersion: 'chn' });
    vi.spyOn(projectFs, 'queryRead').mockResolvedValue('prompt');
    useAppStore.setState({ support: { ok: true, missing: [] } });

    await s().initFromStoredHandle();

    expect(s().project).toEqual({ kind: 'needs-permission', handle, gameVersion: 'chn' });
  });
});

describe('project version forwarding and persistence', () => {
  test('manual open forwards and persists the selected version', async () => {
    const handle = fakeDirectory('manual-project');
    const { root, open, save } = mockSuccessfulOpen(handle, 'jpn');
    useAppStore.setState({
      setup: {
        ...s().setup,
        handle,
        folderName: handle.name,
        gameVersion: 'jpn',
        datatableKey: ' datatable-key ',
        fumenKey: ' fumen-key ',
      },
    });

    await s().setupOpenProject();

    expect(open).toHaveBeenCalledWith(handle, root.keys, 'jpn');
    expect(save).toHaveBeenCalledWith(handle, 'jpn');
    expect(s().setup.gameVersion).toBe('jpn');
    const project = s().project;
    expect(project.kind).toBe('open');
    if (project.kind !== 'open') throw new Error('expected project to open');
    expect(project.project.root.gameVersion).toBe('jpn');
  });

  test('remembered init forwards and re-persists the stored version', async () => {
    const handle = fakeDirectory('remembered-project');
    const { open, save } = mockSuccessfulOpen(handle, 'chn');
    rememberKeys();
    vi.spyOn(idb, 'loadProjectRootRecord').mockResolvedValue({ handle, gameVersion: 'chn' });
    vi.spyOn(projectFs, 'queryRead').mockResolvedValue('granted');
    useAppStore.setState({ support: { ok: true, missing: [] } });

    await s().initFromStoredHandle();

    expect(open).toHaveBeenCalledWith(
      handle,
      { datatable: 'datatable-key', fumen: 'fumen-key' },
      'chn',
    );
    expect(save).toHaveBeenCalledWith(handle, 'chn');
    expect(s().setup.gameVersion).toBe('chn');
  });

  test('permission reconnect forwards and re-persists the stored version', async () => {
    const handle = {
      ...fakeDirectory('permission-project'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
    } as FileSystemDirectoryHandle;
    const { open, save } = mockSuccessfulOpen(handle, 'jpn');
    rememberKeys();
    useAppStore.setState({ project: { kind: 'needs-permission', handle, gameVersion: 'jpn' } });

    await s().reconnect();

    expect(open).toHaveBeenCalledWith(
      handle,
      { datatable: 'datatable-key', fumen: 'fumen-key' },
      'jpn',
    );
    expect(save).toHaveBeenCalledWith(handle, 'jpn');
    expect(s().setup.gameVersion).toBe('jpn');
  });

  test('picking a different folder resets only the candidate version', async () => {
    const oldHandle = fakeDirectory('old-project');
    const newHandle = fakeDirectory('new-project');
    useAppStore.setState({
      setup: {
        ...s().setup,
        handle: oldHandle,
        folderName: oldHandle.name,
        gameVersion: 'chn',
        remembered: true,
      },
    });
    vi.spyOn(projectFs, 'pickProjectFolder').mockResolvedValue({ ok: true, handle: newHandle });
    const save = vi.spyOn(idb, 'saveProjectRootHandle');
    const clear = vi.spyOn(idb, 'clearProjectRootHandle');

    await s().setupPickFolder();

    expect(s().setup.handle).toBe(newHandle);
    expect(s().setup.gameVersion).toBeUndefined();
    expect(s().setup.remembered).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  test('forgetting a project clears its persisted record and candidate version', async () => {
    const clear = vi.spyOn(idb, 'clearProjectRootHandle').mockResolvedValue();
    useAppStore.setState({ setup: { ...s().setup, gameVersion: 'chn', remembered: true } });

    await s().forgetProject();

    expect(clear).toHaveBeenCalledOnce();
    expect(s().setup.gameVersion).toBeUndefined();
    expect(s().setup.remembered).toBe(false);
  });
});
