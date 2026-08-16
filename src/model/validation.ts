// Invariants checked before a save is allowed. Errors block the write; warnings
// are surfaced but don't block. These guard against corrupting the game's
// catalogue — e.g. a music_order entry pointing at a song that no longer exists.

import { COMPANION_TABLES, COMPANION_TABLE_KEYS, type RawDatatables } from '../fs/datatables';

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

  const companionIdentity = (row: { id: string; uniqueId: number }) =>
    JSON.stringify([row.id, row.uniqueId]);
  const infoIdentities = new Set(d.musicinfo.items.map(companionIdentity));
  const baseInfoIdentities = new Set(baseline?.musicinfo.items.map(companionIdentity) ?? []);
  const counts = (rows: readonly { id: string; uniqueId: number }[] | undefined) => {
    const out = new Map<string, number>();
    for (const row of rows ?? []) {
      const key = companionIdentity(row);
      out.set(key, (out.get(key) ?? 0) + 1);
    }
    return out;
  };

  // 5. Every song has a row in every companion table the project has, and no
  //    companion table has rows for songs that are gone. Both shipped dumps
  //    hold this exactly — 1,034 of 1,034 in JPN 39.06, 1,042 of 1,042 in CHN —
  //    and a song missing here reaches the game with no enso background, AI
  //    section or USB setting, which it resolves when a chart starts.
  //
  //    Only songs the user is responsible for are reported: a project whose
  //    baseline already had the gap is not something this save introduced, so
  //    it warns instead of blocking a save that has nothing to do with it.
  for (const field of COMPANION_TABLE_KEYS) {
    const table = d[field];
    if (!table) {
      const unregistrable = baseline
        ? d.musicinfo.items.filter((song) => !baseInfoIdentities.has(companionIdentity(song)))
        : [];
      if (unregistrable.length > 0) {
        const names = unregistrable.slice(0, 3).map((song) => song.id).join(', ');
        issues.push({
          level: 'error',
          message: `${unregistrable.length} new song(s) cannot be registered because ${COMPANION_TABLES[field]} is missing (${names}${unregistrable.length > 3 ? '…' : ''}).`,
        });
      }
      issues.push({
        level: 'warn',
        message: `${COMPANION_TABLES[field]} is missing from the project; new songs cannot be registered in it.`,
      });
      continue;
    }
    const rowCounts = counts(table.items);
    const baseRowCounts = counts(baseline?.[field]?.items);
    const introduced: typeof d.musicinfo.items = [];
    let preexisting = 0;
    for (const song of d.musicinfo.items) {
      const key = companionIdentity(song);
      const count = rowCounts.get(key) ?? 0;
      if (count === 1) continue;
      const existedWithSameProblem =
        baseline !== undefined
        && baseInfoIdentities.has(key)
        && (baseRowCounts.get(key) ?? 0) !== 1;
      if (existedWithSameProblem) preexisting += 1;
      else introduced.push(song);
    }
    if (introduced.length > 0) {
      const names = introduced.slice(0, 3).map((i) => i.id).join(', ');
      issues.push({
        level: 'error',
        message: `${introduced.length} song(s) do not have exactly one matching ${COMPANION_TABLES[field]} row (${names}${introduced.length > 3 ? '…' : ''}).`,
      });
    }
    if (preexisting > 0) {
      issues.push({
        level: 'warn',
        message: `${preexisting} song(s) already lacked exactly one matching ${COMPANION_TABLES[field]} row before this session.`,
      });
    }
    const orphanRows = table.items.filter((row) => !infoIdentities.has(companionIdentity(row)));
    const baseOrphanCounts = counts(
      baseline?.[field]?.items.filter((row) => !baseInfoIdentities.has(companionIdentity(row))),
    );
    const introducedOrphans = orphanRows.filter((row) => {
      const key = companionIdentity(row);
      const remaining = baseOrphanCounts.get(key) ?? 0;
      if (remaining <= 0) return baseline !== undefined;
      baseOrphanCounts.set(key, remaining - 1);
      return false;
    });
    const preexistingOrphans = orphanRows.length - introducedOrphans.length;
    if (introducedOrphans.length > 0) {
      const names = introducedOrphans.slice(0, 3).map((row) => row.id).join(', ');
      issues.push({
        level: 'error',
        message: `${COMPANION_TABLES[field]} gained ${introducedOrphans.length} row(s) with no matching musicinfo identity (${names}${introducedOrphans.length > 3 ? '…' : ''}).`,
      });
    }
    if (preexistingOrphans > 0) {
      issues.push({
        level: 'warn',
        message: `${COMPANION_TABLES[field]} already had ${preexistingOrphans} row(s) with no matching musicinfo identity.`,
      });
    }
  }

  return { issues, ok: !issues.some((x) => x.level === 'error') };
}
