// Invariants checked before a save is allowed. Errors block the write; warnings
// are surfaced but don't block. These guard against corrupting the game's
// catalogue — e.g. a music_order entry pointing at a song that no longer exists.

import type { RawDatatables } from '../fs/datatables';

export interface ValidationIssue {
  level: 'error' | 'warn';
  message: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
  ok: boolean;
}

export function validate(d: RawDatatables, baseline?: RawDatatables): ValidationResult {
  const issues: ValidationIssue[] = [];

  // 1. Song Nos. (`uniqueId` on disk) are unique within musicinfo.
  const seen = new Set<number>();
  const dupes = new Set<number>();
  for (const i of d.musicinfo.items) {
    if (seen.has(i.uniqueId)) dupes.add(i.uniqueId);
    seen.add(i.uniqueId);
  }
  for (const id of dupes) {
    issues.push({ level: 'error', message: `Duplicate Song No. ${id} (musicinfo.uniqueId).` });
  }

  // 2. Every music_order entry references a song that exists in musicinfo.
  const infoIds = new Set(d.musicinfo.items.map((i) => i.uniqueId));
  const orphans = d.musicOrder.items.filter((o) => !infoIds.has(o.uniqueId));
  for (const o of orphans) {
    const label = typeof o.id === 'string' ? o.id : `Song No. ${o.uniqueId}`;
    issues.push({ level: 'error', message: `music_order references unknown song "${label}".` });
  }

  // 3. Stars are within 0..10.
  for (const i of d.musicinfo.items) {
    for (const f of ['starEasy', 'starNormal', 'starHard', 'starMania', 'starUra'] as const) {
      const v = i[f];
      if (typeof v === 'number' && (v < 0 || v > 10)) {
        issues.push({ level: 'error', message: `${i.id}: ${f}=${v} out of range 0..10.` });
      }
    }
  }

  // 4. Warn only about *newly* slot-less songs (the corpus already ships dozens
  //    of musicinfo entries with no order slot, so flagging all of them would be
  //    pure noise — we compare against the baseline the user started from).
  const orderIds = new Set(d.musicOrder.items.map((o) => o.uniqueId));
  const baseOrderIds = baseline ? new Set(baseline.musicOrder.items.map((o) => o.uniqueId)) : undefined;
  const newlyMissing = d.musicinfo.items.filter(
    (i) => !orderIds.has(i.uniqueId) && (!baseOrderIds || baseOrderIds.has(i.uniqueId)),
  );
  if (newlyMissing.length > 0) {
    const names = newlyMissing.slice(0, 3).map((i) => i.id).join(', ');
    issues.push({
      level: 'warn',
      message: `${newlyMissing.length} song(s) lost their music_order slot (${names}${newlyMissing.length > 3 ? '…' : ''}).`,
    });
  }

  return { issues, ok: !issues.some((x) => x.level === 'error') };
}
