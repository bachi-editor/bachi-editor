import type { MusicOrderItem } from '../codec';

function sameJsonValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, i) => sameJsonValue(value, b[i]));
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const keys = Object.keys(aRecord);
  if (keys.length !== Object.keys(bRecord).length) return false;
  return keys.every(
    (key) => Object.prototype.hasOwnProperty.call(bRecord, key)
      && sameJsonValue(aRecord[key], bRecord[key]),
  );
}

/** Semantic equality for the complete JSON music_order sequence. */
export function sameMusicOrderItems(
  a: readonly MusicOrderItem[],
  b: readonly MusicOrderItem[],
): boolean {
  return a.length === b.length && a.every((item, i) => sameJsonValue(item, b[i]));
}
