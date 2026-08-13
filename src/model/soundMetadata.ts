import type { FieldChange } from './diff';

export interface SoundMetadataBaseline {
  key: string;
  songId: string;
  filename: string;
  displayPath: string;
  preferredStem?: string;
  demoStartMs: number;
}

export interface SoundMetadataDraft extends SoundMetadataBaseline {
  demoStartMs: number;
}

export interface SoundMetadataDiff {
  key: string;
  songId: string;
  filename: string;
  displayPath: string;
  preferredStem?: string;
  dirty: boolean;
  changes: FieldChange[];
  summary: string;
}

export function soundMetadataKey(filename: string): string {
  return filename.trim().toLowerCase();
}

/** Demo start as plain seconds — the unit TJA authors write it in. Shared with
 *  the TJA import preview so both places phrase the same edit identically. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '')} s`;
}

export function diffSoundMetadata(
  baseline: SoundMetadataBaseline,
  draft: SoundMetadataDraft,
): SoundMetadataDiff {
  const changes: FieldChange[] = [];
  if (baseline.demoStartMs !== draft.demoStartMs) {
    changes.push({
      label: 'demo start',
      from: formatSeconds(baseline.demoStartMs),
      to: formatSeconds(draft.demoStartMs),
    });
  }
  return {
    key: draft.key,
    songId: draft.songId,
    filename: draft.filename,
    displayPath: draft.displayPath,
    preferredStem: draft.preferredStem,
    dirty: changes.length > 0,
    changes,
    summary: changes.length > 0 ? 'demo start edited' : 'no change',
  };
}

export function collectSoundMetadataDiffs(
  baselines: Map<string, SoundMetadataBaseline>,
  drafts: Map<string, SoundMetadataDraft>,
): SoundMetadataDiff[] {
  const out: SoundMetadataDiff[] = [];
  for (const [key, draft] of drafts) {
    const baseline = baselines.get(key);
    if (!baseline) continue;
    const diff = diffSoundMetadata(baseline, draft);
    if (diff.dirty) out.push(diff);
  }
  out.sort((a, b) => (a.songId === b.songId ? a.filename.localeCompare(b.filename) : a.songId.localeCompare(b.songId)));
  return out;
}
