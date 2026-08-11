// A one-shot scan of which on-disk assets actually exist, so the song list can
// flag what's missing per song without lazily probing every row. Cheap: two
// directory listings (fumen/ folders and sound/ files) at project open.
//
// This matters when a real install has incomplete content: affected songs show
// up flagged "no chart" or "no audio" instead of failing only when selected.

import type { ProjectRoot } from './project';

export interface AssetInventory {
  /** Song ids that have a fumen/<id>/ folder. */
  fumenIds: Set<string>;
  /** Sound file names present under sound/ (e.g. "song_10binz.nus3bank"). */
  soundFiles: Set<string>;
}

async function listNames(
  dir: FileSystemDirectoryHandle,
  kind: 'file' | 'directory',
): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    for await (const [name, entry] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      if (entry.kind === kind) out.add(name);
    }
  } catch {
    // Directory unreadable/absent — treat as empty.
  }
  return out;
}

export async function loadAssetInventory(root: ProjectRoot): Promise<AssetInventory> {
  const [fumenIds, soundFiles] = await Promise.all([
    listNames(root.fumen, 'directory'),
    listNames(root.sound, 'file'),
  ]);
  return { fumenIds, soundFiles };
}

export const EMPTY_INVENTORY: AssetInventory = { fumenIds: new Set(), soundFiles: new Set() };
