// Central resolver for the maintainer-held inputs the corpus tests need: the two
// AES-256 keys, the game dumps, and the G.719 wasm modules. None of these live in
// this repository and none are ever bundled — see `.env.example` and the README's
// "Development" section for how to supply them locally.
//
// Every lookup here is best-effort. When something is absent the matching
// AVAILABLE flag is false and the suites that need it skip with a reason, so a
// contributor working from a bare clone gets a green run over the ~260 tests that
// need no corpus, instead of a wall of ENOENT failures.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../..');

function fromEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Env-supplied paths may be absolute or relative to the repository root. */
function resolveDir(value: string): string {
  return isAbsolute(value) ? value : resolve(REPO_ROOT, value);
}

/** Root of the separately held corpus. Override with BACHI_RESOURCES_DIR. */
export const RESOURCES_DIR = resolveDir(fromEnv('BACHI_RESOURCES_DIR') ?? '../resources');

// ---------------------------------------------------------------- AES-256 keys

const LOADER_CPP = resolve(RESOURCES_DIR, 'TaikoArcadeLoader-Refactor/src/patches/layeredfs.cpp');

/** Scrape a key from its canonical home in the TaikoArcadeLoader source. */
function loaderKey(name: 'datatableKey' | 'fumenKey'): string | undefined {
  if (!existsSync(LOADER_CPP)) return undefined;
  const src = readFileSync(LOADER_CPP, 'utf8');
  return src.match(new RegExp(`${name}\\s*=\\s*"([0-9A-Fa-f]{64})"`))?.[1];
}

/** Prefer an explicit env/.env value, then fall back to the loader source. */
function resolveKey(envName: string, loaderName: 'datatableKey' | 'fumenKey'): string {
  const supplied = fromEnv(envName);
  if (supplied) {
    // A deliberately-set key with a typo should be loud, not silently skipped.
    if (!/^[0-9a-fA-F]{64}$/.test(supplied)) {
      throw new Error(`${envName} must be exactly 64 hex characters (32 bytes); got ${supplied.length}`);
    }
    return supplied;
  }
  return loaderKey(loaderName) ?? '';
}

// The two keys are region-shared: the same datatable/fumen keys decrypt both the
// CHN and JPN39.06 dumps (verified corpus-wide), so they carry no region prefix.
// Empty string means "unavailable" — guard with HAS_KEYS before use.
export const DATATABLE_KEY_HEX: string = resolveKey('BACHI_DATATABLE_KEY', 'datatableKey');
export const FUMEN_KEY_HEX: string = resolveKey('BACHI_FUMEN_KEY', 'fumenKey');

export const HAS_KEYS = DATATABLE_KEY_HEX !== '' && FUMEN_KEY_HEX !== '';

// ------------------------------------------------------------------ game dumps

export interface Dump {
  /** Short region label, surfaced in parametrized test names via `$region`. */
  region: string;
  /** Absolute path to the dump's `Data/x64` directory. */
  x64: string;
}

export const DUMPS: readonly Dump[] = [
  { region: 'CHN', x64: resolve(RESOURCES_DIR, 'TaikoCHN/Data/x64') },
  { region: 'JPN', x64: resolve(RESOURCES_DIR, 'JPN39.06/Data/x64') },
];

/** The primary reference dump; most single-dump fixtures point here. */
export const CHN_X64 = DUMPS[0].x64;

export const HAS_CHN_DUMP = existsSync(CHN_X64);
export const HAS_ALL_DUMPS = DUMPS.every((d) => existsSync(d.x64));

/** TaikoLocalServer dan/gaiden JSON. */
export const SERVER_DATA_DIR = resolve(RESOURCES_DIR, 'TaikoLocalServer-dev/Host/wwwroot/data');
export const HAS_SERVER_DATA = existsSync(SERVER_DATA_DIR);

/** The ESE .tja import corpus. */
export const TJA_CORPUS_DIR = resolve(RESOURCES_DIR, 'ese');
export const HAS_TJA_CORPUS = existsSync(TJA_CORPUS_DIR);

/** Shorthand for the common case: keys plus the primary CHN dump. */
export const HAS_CORPUS = HAS_KEYS && HAS_CHN_DUMP;

// ------------------------------------------------------------ G.719 wasm modules

// Prefer the repo-local gitignored drop point, then the corpus checkout.
const G719_DIR = (() => {
  const override = fromEnv('BACHI_G719_DIR');
  if (override) return resolveDir(override);
  const vendored = resolve(REPO_ROOT, 'vendor/g719');
  return existsSync(vendored) ? vendored : resolve(RESOURCES_DIR, 'g719');
})();

export const G719_DECODER_WASM = resolve(G719_DIR, 'g719.wasm');
export const G719_ENCODER_WASM = resolve(G719_DIR, 'g719-encoder.wasm');

export const HAS_G719_DECODER = existsSync(G719_DECODER_WASM);
export const HAS_G719_ENCODER = existsSync(G719_ENCODER_WASM);

// ------------------------------------------------------------------- reporting

/** Human-readable list of what is missing, for the one-time startup banner. */
export function missingResources(): string[] {
  const missing: string[] = [];
  if (!HAS_KEYS) missing.push('AES keys (BACHI_DATATABLE_KEY / BACHI_FUMEN_KEY)');
  if (!HAS_CHN_DUMP) missing.push(`CHN dump (${CHN_X64})`);
  if (!HAS_ALL_DUMPS && HAS_CHN_DUMP) missing.push(`JPN dump (${DUMPS[1].x64})`);
  if (!HAS_SERVER_DATA) missing.push(`server data (${SERVER_DATA_DIR})`);
  if (!HAS_TJA_CORPUS) missing.push(`TJA corpus (${TJA_CORPUS_DIR})`);
  if (!HAS_G719_DECODER) missing.push(`G.719 decoder (${G719_DECODER_WASM})`);
  if (!HAS_G719_ENCODER) missing.push(`G.719 encoder (${G719_ENCODER_WASM})`);
  return missing;
}
