import type { MusicOrderItem } from '../../codec';
import type { SongRow } from '../../model/songlist';

export type PlacementKey = number;

export interface OrderPlacement {
  key: PlacementKey;
  entry: MusicOrderItem;
  row: SongRow;
  genreNo: number;
  index: number;
}

export interface DuplicateSongOrderIssue {
  kind: 'duplicate-song';
  songId: string;
  row: SongRow;
  /** 1-based folder-local positions, matching the indices printed on cards. */
  indices: number[];
  placementKeys: PlacementKey[];
}

export type OrderFolderIssue = DuplicateSongOrderIssue;

export interface OrderFolderValidation {
  issues: OrderFolderIssue[];
  affectedPlacementKeys: ReadonlySet<PlacementKey>;
}

export interface OrderFolder {
  genreNo: number;
  placements: OrderPlacement[];
  validation: OrderFolderValidation;
}

export type PlacementKeyFor = (entry: MusicOrderItem) => PlacementKey;

/** Stable client-only identity; nothing is added to the encoded datatable row. */
export function createPlacementKeyFor(): PlacementKeyFor {
  const keys = new WeakMap<MusicOrderItem, PlacementKey>();
  let next = 1;
  return (entry) => {
    const existing = keys.get(entry);
    if (existing !== undefined) return existing;
    const key = next++;
    keys.set(entry, key);
    return key;
  };
}

const VALID_ORDER_FOLDER: OrderFolderValidation = {
  issues: [],
  affectedPlacementKeys: new Set(),
};

/** Run the Music Order sanity checks that are scoped to one genre folder. */
export function validateOrderFolder(
  placements: readonly OrderPlacement[],
): OrderFolderValidation {
  const bySongId = new Map<string, OrderPlacement[]>();
  for (const placement of placements) {
    const matching = bySongId.get(placement.row.id);
    if (matching) matching.push(placement);
    else bySongId.set(placement.row.id, [placement]);
  }

  const issues: OrderFolderIssue[] = [];
  const affectedPlacementKeys = new Set<PlacementKey>();
  for (const [songId, matching] of bySongId) {
    if (matching.length < 2) continue;
    const placementKeys = matching.map((placement) => placement.key);
    placementKeys.forEach((key) => affectedPlacementKeys.add(key));
    issues.push({
      kind: 'duplicate-song',
      songId,
      row: matching[0].row,
      indices: matching.map((placement) => placement.index + 1),
      placementKeys,
    });
  }
  return issues.length === 0 ? VALID_ORDER_FOLDER : { issues, affectedPlacementKeys };
}

/**
 * Project raw placements into genre folders while retaining unchanged folder
 * and placement objects. React can then skip every unaffected column/card after
 * a move instead of treating the whole board as new work.
 */
export function buildOrderFolders(
  entries: readonly MusicOrderItem[],
  byId: ReadonlyMap<string, SongRow>,
  genreNos: readonly number[],
  keyFor: PlacementKeyFor,
  previous: readonly OrderFolder[] = [],
): OrderFolder[] {
  const buckets = new Map<number, { entry: MusicOrderItem; row: SongRow }[]>();
  for (const genreNo of genreNos) buckets.set(genreNo, []);
  for (const entry of entries) {
    const row = typeof entry.id === 'string' ? byId.get(entry.id) : undefined;
    if (!row) continue;
    const genreNo = typeof entry.genreNo === 'number' ? entry.genreNo : row.genreNo ?? -1;
    if (!buckets.has(genreNo)) buckets.set(genreNo, []);
    buckets.get(genreNo)!.push({ entry, row });
  }

  const previousByGenre = new Map(previous.map((folder) => [folder.genreNo, folder]));
  const folders: OrderFolder[] = [];
  for (const [genreNo, bucket] of buckets) {
    if (bucket.length === 0) continue;
    const prior = previousByGenre.get(genreNo);
    const placements = bucket.map(({ entry, row }, index) => {
      const old = prior?.placements[index];
      if (old?.entry === entry && old.row === row) return old;
      return { key: keyFor(entry), entry, row, genreNo, index };
    });
    if (
      prior
      && prior.placements.length === placements.length
      && placements.every((placement, index) => placement === prior.placements[index])
    ) {
      folders.push(prior);
    } else {
      folders.push({ genreNo, placements, validation: validateOrderFolder(placements) });
    }
  }
  return folders;
}
