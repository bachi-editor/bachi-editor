// Load + decode per-song fumen .bin files from the project tree.
//
// CHN fumen layout: resources/TaikoCHN/Data/x64/fumen/<id>/<id>_<suffix>.bin
//   <suffix> ∈ { e, n, h, m, x, e_1, e_2, n_1, n_2, h_1, h_2, m_1, m_2, x_1, x_2 }
// Difficulty letters: e=easy, n=normal, h=hard, m=oni/master, x=ura(?).
// Suffixes ending in _1 / _2 are 2P variants.
//
// We don't assume which suffixes exist; we read the directory and surface
// everything that follows the pattern. Files that don't decode are surfaced
// with their error so the UI can show "broken" rather than crash.

import { decodeFumen, Fumen, openEnvelope } from '../codec';
import type { ProjectRoot } from './project';

/** The user-supplied fumen key for this project. */
export function fumenKeyOf(root: ProjectRoot): string {
  const key = root.keys?.fumen;
  if (!key) throw new Error('Fumen key is not set for this project.');
  return key;
}

export type FumenDifficulty = 'easy' | 'normal' | 'hard' | 'oni' | 'ura';

export type FumenPlayer = 'single' | 'p1' | 'p2';

/** Maps single-letter on-disk suffix → human difficulty. */
const DIFFICULTY_BY_LETTER: Record<string, FumenDifficulty> = {
  e: 'easy',
  n: 'normal',
  h: 'hard',
  m: 'oni',
  x: 'ura',
};

/** Single-letter on-disk suffix for each difficulty (inverse of DIFFICULTY_BY_LETTER). */
const LETTER_BY_DIFFICULTY: Record<FumenDifficulty, string> = {
  easy: 'e',
  normal: 'n',
  hard: 'h',
  oni: 'm',
  ura: 'x',
};

const PLAYER_FILENAME_SUFFIX: Record<FumenPlayer, string> = {
  single: '',
  p1: '_1',
  p2: '_2',
};

export const DIFFICULTY_ORDER: FumenDifficulty[] = ['easy', 'normal', 'hard', 'oni', 'ura'];
export const PLAYER_ORDER: FumenPlayer[] = ['single', 'p1', 'p2'];

/** Build the on-disk `.bin` filename for a song's difficulty/player slot. */
export function fumenFilename(songId: string, difficulty: FumenDifficulty, player: FumenPlayer): string {
  return `${songId}_${LETTER_BY_DIFFICULTY[difficulty]}${PLAYER_FILENAME_SUFFIX[player]}.bin`;
}

/** Sort slots into the stable display order (easy→ura, single→p1→p2). */
export function sortFumenSlots<T extends FumenSlot>(slots: T[]): T[] {
  return slots.slice().sort((a, b) => {
    const d = DIFFICULTY_ORDER.indexOf(a.difficulty) - DIFFICULTY_ORDER.indexOf(b.difficulty);
    if (d !== 0) return d;
    return PLAYER_ORDER.indexOf(a.player) - PLAYER_ORDER.indexOf(b.player);
  });
}

export interface FumenSlot {
  filename: string;
  difficulty: FumenDifficulty;
  player: FumenPlayer;
}

export interface LoadedFumen extends FumenSlot {
  songId: string;
  bytes: Uint8Array;
  fumen: Fumen;
}

export function parseFumenFilename(songId: string, filename: string): FumenSlot | undefined {
  if (!filename.endsWith('.bin')) return undefined;
  const stem = filename.slice(0, -'.bin'.length);
  // Allow "<songId>_<letter>" or "<songId>_<letter>_<1|2>"
  const prefix = `${songId}_`;
  if (!stem.startsWith(prefix)) return undefined;
  const rest = stem.slice(prefix.length);
  const parts = rest.split('_');
  if (parts.length === 0) return undefined;
  const letter = parts[0];
  const difficulty = DIFFICULTY_BY_LETTER[letter];
  if (!difficulty) return undefined;
  let player: FumenPlayer = 'single';
  if (parts.length === 1) player = 'single';
  else if (parts.length === 2 && (parts[1] === '1' || parts[1] === '2')) {
    player = parts[1] === '1' ? 'p1' : 'p2';
  } else return undefined;
  return { filename, difficulty, player };
}

/**
 * Discover the fumen slots present for a song, sorted into a stable display
 * order (easy→ura, single→p1→p2). Does not read or decode the files.
 */
export async function listSongFumenSlots(root: ProjectRoot, songId: string): Promise<FumenSlot[]> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await root.fumen.getDirectoryHandle(songId);
  } catch {
    return [];
  }
  const out: FumenSlot[] = [];
  // FileSystemDirectoryHandle is async-iterable in Chromium.
  for await (const [name, entry] of (dir as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
    if (entry.kind !== 'file') continue;
    const slot = parseFumenFilename(songId, name);
    if (slot) out.push(slot);
  }
  return sortFumenSlots(out);
}

export async function loadFumen(root: ProjectRoot, songId: string, slot: FumenSlot): Promise<LoadedFumen> {
  const dir = await root.fumen.getDirectoryHandle(songId);
  const handle = await dir.getFileHandle(slot.filename);
  const file = await handle.getFile();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { payload } = await openEnvelope(bytes, fumenKeyOf(root));
  const fumen = decodeFumen(payload);
  return { ...slot, songId, bytes, fumen };
}
