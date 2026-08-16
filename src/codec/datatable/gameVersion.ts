import type { MusicInfoFile, MusicInfoItem } from './types';

/** Game data family selected when opening a project. */
export type GameVersion = 'chn' | 'jpn';

export function isGameVersion(value: unknown): value is GameVersion {
  return value === 'chn' || value === 'jpn';
}

const SPIKE_FIELDS = [
  'spikeOnEasy',
  'spikeOnNormal',
  'spikeOnHard',
  'spikeOnOni',
  'spikeOnUra',
] as const satisfies readonly (keyof MusicInfoItem)[];

/**
 * Infer the game-data family from the runtime types used by musicinfo's spike
 * flags. CHN stores these values as booleans; JPN stores them as numbers.
 *
 * Every observed field is one vote. Mixed data uses the dominant type, while a
 * tie (or a file with no usable evidence) remains unknown so opening it is not
 * blocked by an ambiguous heuristic.
 */
export function detectGameVersion(musicinfo: Pick<MusicInfoFile, 'items'>): GameVersion | undefined {
  let chnVotes = 0;
  let jpnVotes = 0;

  for (const item of musicinfo.items) {
    for (const field of SPIKE_FIELDS) {
      const value = item[field];
      if (typeof value === 'boolean') {
        chnVotes += 1;
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        jpnVotes += 1;
      }
    }
  }

  if (chnVotes === jpnVotes) return undefined;
  return chnVotes > jpnVotes ? 'chn' : 'jpn';
}
