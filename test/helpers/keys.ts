// The game's decryption keys are NOT stored in app/ — the shipped editor takes
// them from the user at open time. Tests still need the real keys to decode the
// real fixture .bin files, so they read them from their canonical home: the
// TaikoArcadeLoader source (resources/, outside app/). This keeps the literals
// out of the app entirely while letting the suite decode the corpus.
//
// The two keys are region-shared: the same datatable/fumen keys decrypt both the
// CHN dump and the JPN39.06 dump (verified corpus-wide), so the exports carry no
// region prefix.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const LOADER_SRC = new URL(
  '../../../resources/TaikoArcadeLoader-Refactor/src/patches/layeredfs.cpp',
  import.meta.url,
);

function loaderKey(name: 'datatableKey' | 'fumenKey'): string {
  const src = readFileSync(fileURLToPath(LOADER_SRC), 'utf8');
  const m = src.match(new RegExp(`${name}\\s*=\\s*"([0-9A-Fa-f]{64})"`));
  if (!m) throw new Error(`could not find ${name} in TaikoArcadeLoader layeredfs.cpp`);
  return m[1];
}

export const DATATABLE_KEY_HEX = loaderKey('datatableKey');
export const FUMEN_KEY_HEX = loaderKey('fumenKey');
