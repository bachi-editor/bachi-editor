// The game dumps the corpus tests exercise. CHN is the primary reference dump;
// JPN39.06 was added later and is byte-compatible (same codecs, same datatable
// schema) — the shared loader keys decrypt both. Running the corpus/round-trip
// assertions over every entry here is how we prove a newly-added dump doesn't
// break the codecs (AGENTS.md requirement #2: never break codec round-trips).
//
// Dump locations resolve through ./resources and are absent on a bare clone;
// guard suites with `describe.skipIf(!HAS_CORPUS)`.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type { Dump } from './resources';
export { DUMPS, HAS_ALL_DUMPS, HAS_CHN_DUMP, HAS_CORPUS } from './resources';

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
