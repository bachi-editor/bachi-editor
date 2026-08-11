// The game dumps the corpus tests exercise. CHN is the primary reference dump;
// JPN39.06 was added later and is byte-compatible (same codecs, same datatable
// schema) — the shared loader keys decrypt both. Running the corpus/round-trip
// assertions over every entry here is how we prove a newly-added dump doesn't
// break the codecs (AGENTS.md requirement #2: never break codec round-trips).

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const REPO = resolve(__dirname, '../../..');

export interface Dump {
  /** Short region label, surfaced in parametrized test names via `$region`. */
  region: string;
  /** Absolute path to the dump's `Data/x64` directory. */
  x64: string;
}

export const DUMPS: readonly Dump[] = [
  { region: 'CHN', x64: resolve(REPO, 'resources/TaikoCHN/Data/x64') },
  { region: 'JPN', x64: resolve(REPO, 'resources/JPN39.06/Data/x64') },
];

/** Recursively yield every `.bin` file path under `root`. */
export async function* walkBins(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const ent of entries) {
    const p = join(root, ent.name);
    if (ent.isDirectory()) yield* walkBins(p);
    else if (ent.isFile() && ent.name.endsWith('.bin')) yield p;
  }
}

/** Read a file into a fresh Uint8Array view. */
export async function loadBytes(p: string): Promise<Uint8Array> {
  const buf = await readFile(p);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
