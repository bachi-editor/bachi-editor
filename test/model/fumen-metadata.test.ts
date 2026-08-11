import { describe, expect, test } from 'vitest';
import type { Fumen, FumenMeasure, FumenNote, MusicInfoItem } from '../../src/codec';
import { makeFumenHeader } from '../../src/codec';
import {
  chartMetadataPatchAfterEdit,
  clonedDifficultyMetadataPatch,
  summarizeFumenMetadata,
} from '../../src/model/fumenMetadata';

function note(type: number, duration = 0, scoreInit = 0): FumenNote {
  return { type, position: 0, item: 0, padding: 0, scoreInit, scoreDiff: 0, duration };
}

function chart(normal: FumenNote[], master: FumenNote[] = normal, branched = false): Fumen {
  const measure: FumenMeasure = {
    bpm: 120,
    offset: 0,
    gogo: 0,
    barline: 1,
    padding1: 0,
    branchInfo: [-1, -1, -1, -1, -1, -1],
    padding2: 0,
    branches: [
      { padding: 0, speed: 1, notes: normal },
      { padding: 0, speed: 1, notes: [] },
      { padding: 0, speed: 1, notes: master },
    ],
  };
  return {
    header: makeFumenHeader({ measureCount: 1, hasBranches: branched ? 1 : 0 }),
    measures: [measure],
    trailer: new Uint8Array(),
  };
}

describe('chart-derived musicinfo synchronization', () => {
  test('summarizes playable notes, roll seconds, and balloon hits from the canonical route', () => {
    // Roll seconds carry the corpus's per-roll 48th-note tail: at 120 BPM one
    // beat is 500 ms, so the 1500 ms roll counts as 1500 + 500/12 ms.
    const flat = chart([note(0x1), note(0x7), note(0x6, 1500), note(0xa, 900, 12)]);
    expect(summarizeFumenMetadata(flat)).toEqual({
      branch: false,
      notes: 2,
      renda: (1500 + 500 / 12) / 1000,
      fuusen: 12,
    });

    const branched = chart([note(0x1)], [note(0x1), note(0x4), note(0xc, 500, 8)], true);
    expect(summarizeFumenMetadata(branched)).toEqual({ branch: true, notes: 2, renda: 0, fuusen: 8 });
  });

  test('applies chart deltas without replacing legacy stored offsets', () => {
    const before = chart([note(0x1), note(0x6, 1000), note(0xa, 500, 10)]);
    const after = chart([note(0x1), note(0x4), note(0x6, 1500), note(0xa, 500, 12)]);
    const info: MusicInfoItem = {
      uniqueId: 1,
      id: 'aaa',
      maniaOnpuNum: 100,
      rendaTimeMania: 5.25,
      fuusenTotalMania: 50,
    };

    expect(chartMetadataPatchAfterEdit(info, 'oni', before, after)).toEqual({
      maniaOnpuNum: 101,
      rendaTimeMania: 5.75,
      fuusenTotalMania: 52,
    });
  });

  test('branch toggles and exact-clone metadata use the difficulty-specific fields', () => {
    const notes = [note(0x1)];
    const before = chart(notes, notes, false);
    const after = chart(notes, notes, true);
    const info: MusicInfoItem = {
      uniqueId: 1,
      id: 'aaa',
      branchMania: false,
      maniaOnpuNum: 9,
      rendaTimeMania: 1.25,
      fuusenTotalMania: 3,
    };

    expect(chartMetadataPatchAfterEdit(info, 'oni', before, after)).toEqual({ branchMania: true });
    expect(clonedDifficultyMetadataPatch(info, 'oni', 'ura')).toEqual({
      branchUra: false,
      uraOnpuNum: 9,
      rendaTimeUra: 1.25,
      fuusenTotalUra: 3,
    });
  });
});
