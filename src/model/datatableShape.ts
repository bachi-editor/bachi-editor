// Build new datatable rows in the shape the open file already uses.
//
// The datatables are not one schema. The CHN v12r00_cn and JPN 39.06 dumps
// disagree on field sets, field types, and key order, and a row scaffolded from
// hardcoded literals is only ever correct for the dump those literals were
// copied from. Real divergences found across the two dumps:
//
//   musicinfo        spikeOn*        CHN: boolean (false/true)
//                                    JPN: number  (0 ×5164, 1 ×4, 2 ×2)
//   music_order      closeDispType   CHN + JPN both have it; a scaffold that omits it
//                                    leaves the game reading a missing key
//   wordlist         locales         CHN: 4 + chineseSText, each with a *FontType
//                                    JPN: 4, each with a *FontType, no chineseS
//   music_attribute  isNotCopyright  CHN: boolean field present
//                                    JPN: field absent entirely
//
// So instead of writing literals, copy the shape of the rows that are already
// in the file: same keys, same key order, same JSON types, with identity fields
// filled in and everything else zeroed. That is correct for both dumps by
// construction and stays correct for the next divergence.

/** JSON-ish row: an object whose values we can classify and default. */
export type DatatableRow = Record<string, unknown>;

function shapeSignature(row: DatatableRow): string {
  return Object.keys(row).join('\\0');
}

/**
 * The most common key signature among `rows`, as a representative row.
 *
 * Majority rather than "first row" because real dumps contain occasional odd
 * rows — a handful of JPN wordlist entries carry a different field set than
 * their 9,000 neighbours, and scaffolding from one of those would spread it.
 */
export function dominantRowShape<T extends DatatableRow>(rows: readonly T[]): T | undefined {
  if (rows.length === 0) return undefined;
  const counts = new Map<string, { count: number; row: T }>();
  for (const row of rows) {
    const signature = shapeSignature(row);
    const seen = counts.get(signature);
    if (seen) seen.count += 1;
    else counts.set(signature, { count: 1, row });
  }
  let best: { count: number; row: T } | undefined;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best?.row;
}

/**
 * The empty value for a field, inferred from what the file already stores in
 * it. Numbers zero, booleans go false, strings empty — which is exactly what
 * the shipped "no value here" rows use, and critically keeps each field's JSON
 * type unchanged (`spikeOnEasy` stays `0` in JPN and `false` in CHN).
 */
function emptyLike(value: unknown): unknown {
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  if (typeof value === 'string') return '';
  if (Array.isArray(value)) return [];
  if (value === null) return null;
  if (typeof value === 'object') return {};
  return value;
}

export interface ScaffoldRowOptions<T extends DatatableRow> {
  /**
   * Restrict the shape sample, for files whose rows are not homogeneous. The
   * wordlist is the case that needs it: `song_`, `song_sub_` and `song_detail_`
   * are three different row populations sharing one table.
   */
  shapeFrom?: (row: T) => boolean;
  /** Shape to use when the file has no usable rows to copy (a new/empty file). */
  fallback?: T;
  /**
   * Fields that must exist on the result even if the observed rows lack them,
   * with the type to use when they are missing. Appended after the observed
   * keys, so a file whose rows are already complete keeps its exact key order
   * and nothing is added.
   *
   * This covers fields the editor itself writes later: a row missing them would
   * make a subsequent edit introduce the key, in editor order, into a file that
   * has it somewhere else. Only use it for fields both dumps genuinely have —
   * never for ones whose presence is the regional difference (`chineseSText`).
   */
  ensure?: Partial<T>;
}

/**
 * A new row with the file's own field set, key order and JSON types, carrying
 * `seed` for the fields it names.
 *
 * Seed entries whose key is absent from the observed shape are dropped: they
 * are fields from another region's schema (`chineseSText` against a JPN
 * wordlist), and inventing them would put the exact kind of foreign key into
 * the file that this function exists to prevent.
 */
export function scaffoldRow<T extends DatatableRow>(
  rows: readonly T[],
  seed: Partial<T>,
  options: ScaffoldRowOptions<T> = {},
): T {
  const sample = options.shapeFrom ? rows.filter(options.shapeFrom) : rows;
  const shape = dominantRowShape(sample) ?? dominantRowShape(rows) ?? options.fallback;
  if (!shape) {
    throw new Error('Cannot scaffold a datatable row: the file has no rows to copy the shape from.');
  }
  const out: DatatableRow = {};
  for (const [key, value] of Object.entries(shape)) {
    out[key] = key in seed ? seed[key as keyof T] : emptyLike(value);
  }
  for (const [key, value] of Object.entries(options.ensure ?? {})) {
    if (key in out) continue;
    out[key] = key in seed ? seed[key as keyof T] : emptyLike(value);
  }
  return out as T;
}

/** Keys the observed shape actually has — for callers filling optional locales. */
export function shapeKeys<T extends DatatableRow>(
  rows: readonly T[],
  options: ScaffoldRowOptions<T> = {},
): Set<string> {
  const sample = options.shapeFrom ? rows.filter(options.shapeFrom) : rows;
  const shape = dominantRowShape(sample) ?? dominantRowShape(rows) ?? options.fallback;
  return new Set(shape ? Object.keys(shape) : []);
}

/**
 * Re-type a patch value to match what the row already stores.
 *
 * The Metadata UI edits `spikeOn*` through a boolean switch, but JPN stores
 * those fields as integers. Without this, toggling a JPN flag would write
 * `true` into a file whose other 1,034 rows use `1`. Booleans map to 0/1; the
 * rare JPN `2` is not reachable through a two-state control and is preserved
 * only by not touching the field.
 */
export function conformPatchValue(existing: unknown, next: unknown): unknown {
  if (typeof existing === 'number' && typeof next === 'boolean') return next ? 1 : 0;
  if (typeof existing === 'boolean' && typeof next === 'number') return next !== 0;
  return next;
}
