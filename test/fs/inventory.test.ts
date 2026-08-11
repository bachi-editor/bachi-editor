import { describe, expect, test } from 'vitest';
import { EMPTY_INVENTORY, loadAssetInventory } from '../../src/fs/inventory';
import type { ProjectRoot } from '../../src/fs/project';

function dir(
  entries: [string, { kind: 'file' | 'directory' }][],
  fail = false,
): FileSystemDirectoryHandle {
  return {
    async *[Symbol.asyncIterator]() {
      if (fail) throw new Error('unreadable');
      for (const entry of entries) yield entry;
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe('loadAssetInventory', () => {
  test('indexes fumen directories and sound files only', async () => {
    const root = {
      fumen: dir([
        ['aaa', { kind: 'directory' }],
        ['not-a-song.bin', { kind: 'file' }],
      ]),
      sound: dir([
        ['song_aaa.nus3bank', { kind: 'file' }],
        ['nested', { kind: 'directory' }],
      ]),
    } as unknown as ProjectRoot;

    const inv = await loadAssetInventory(root);

    expect([...inv.fumenIds]).toEqual(['aaa']);
    expect([...inv.soundFiles]).toEqual(['song_aaa.nus3bank']);
  });

  test('treats unreadable asset directories as empty', async () => {
    const root = {
      fumen: dir([], true),
      sound: dir([], true),
    } as unknown as ProjectRoot;

    await expect(loadAssetInventory(root)).resolves.toEqual({ fumenIds: new Set(), soundFiles: new Set() });
    expect(EMPTY_INVENTORY.fumenIds.size).toBe(0);
    expect(EMPTY_INVENTORY.soundFiles.size).toBe(0);
  });
});
