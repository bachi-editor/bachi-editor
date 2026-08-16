import { describe, expect, test } from 'vitest';
import { verifyEncoderSelfConsistent } from '../../src/codec';
import type { RawDatatables } from '../../src/fs/datatables';
import { summarizeFumenMetadata } from '../../src/model/fumenMetadata';
import {
  applyTjaImportMetadata,
  convertTjaForImport,
  decodeTjaBytes,
  importChartSlot,
  shinutiPatch,
} from '../../src/model/tjaImport';

const TJA = `
TITLE:Fallback title
TITLEJA:日本語タイトル
TITLEZH:中文標題
SUBTITLE:--Fallback subtitle
SUBTITLEJA:--日本語サブ
BPM:120
OFFSET:-1.25

COURSE:Easy
LEVEL:3
SCOREINIT:1000
SCOREDIFF:195.7
#START
10203040,
#END

COURSE:Oni
LEVEL:8
SCOREINIT:800
SCOREDIFF:200
BALLOON:7,8,9
#START
#BRANCHSTART p,50,80
#N
1000,
#E
2000,
#M
7008,
#BRANCHEND
#END
`;

function datatables(): RawDatatables {
  return {
    musicinfo: {
      items: [{
        uniqueId: 17,
        id: 'target',
        starEasy: 1,
        starNormal: 4,
        starHard: 5,
        starMania: 6,
        starUra: 10,
      }],
    },
    musicOrder: { items: [] },
    wordlist: {
      items: [
        {
          key: 'song_target',
          japaneseText: '', japaneseFontType: 0,
          englishUsText: 'Old title', englishUsFontType: 0,
          chineseTText: '', chineseTFontType: 0,
          chineseSText: '', chineseSFontType: 0,
          koreanText: '', koreanFontType: 0,
        },
        {
          key: 'song_sub_target',
          japaneseText: '', japaneseFontType: 0,
          englishUsText: 'Old subtitle', englishUsFontType: 0,
          chineseTText: '', chineseTFontType: 0,
          chineseSText: '', chineseSFontType: 0,
          koreanText: '', koreanFontType: 0,
        },
      ],
    },
  };
}

describe('TJA import conversion', () => {
  test('decodes Shift-JIS input when UTF-8 decoding fails', () => {
    expect(decodeTjaBytes(new Uint8Array([0x83, 0x65, 0x83, 0x58, 0x83, 0x67]))).toBe('テスト');
  });

  test('carries DEMOSTART out as milliseconds, and only when it is usable', () => {
    const withDemo = (value: string) => convertTjaForImport(TJA.replace('BPM:120', `DEMOSTART:${value}\nBPM:120`));

    expect(withDemo('12.34').demoStartMs).toBe(12340);
    expect(withDemo('0').demoStartMs).toBe(0);
    // Authoring tools emit hair-negative values (ESE has -0.038); like the bank
    // field itself, they mean "from the start".
    expect(withDemo('-0.038').demoStartMs).toBe(0);
    // Absent, blank, and non-numeric all leave the bank's own value alone rather
    // than defaulting to a preview position the TJA never asked for.
    expect(convertTjaForImport(TJA).demoStartMs).toBeUndefined();
    expect(withDemo('').demoStartMs).toBeUndefined();
    expect(withDemo('later').demoStartMs).toBeUndefined();
    expect(withDemo('later').warnings).toContainEqual({ code: 'invalid-value', detail: 'DEMOSTART', count: 1 });
    expect(convertTjaForImport(TJA).warnings.some((w) => w.detail === 'DEMOSTART')).toBe(false);
  });

  test('converts localized metadata, decimal scoring, branches, and full player triples', () => {
    const imported = convertTjaForImport(TJA);

    expect(imported.title).toEqual({
      japaneseText: '日本語タイトル',
      englishUsText: 'Fallback title',
      chineseTText: '中文標題',
      chineseSText: '中文標題',
      koreanText: 'Fallback title',
    });
    expect(imported.subtitle.japaneseText).toBe('日本語サブ');
    expect(imported.subtitle.englishUsText).toBe('Fallback subtitle');
    expect(imported.charts).toHaveLength(6);
    expect(imported.charts.map((chart) => `${chart.slot.difficulty}:${chart.slot.player}`)).toEqual([
      'easy:single', 'easy:p1', 'easy:p2', 'oni:single', 'oni:p1', 'oni:p2',
    ]);

    const easy = imported.charts.find((chart) => chart.slot.difficulty === 'easy' && chart.slot.player === 'single');
    const oni = imported.charts.find((chart) => chart.slot.difficulty === 'oni' && chart.slot.player === 'single');
    expect(easy).toBeDefined();
    expect(oni).toBeDefined();
    // Decimal SCOREDIFF is accepted, scaled ×4, then snapped to the multiple of
    // ten the corpus stores: 195.7 × 4 = 782.8 → 780.
    expect(easy?.scoreStep).toBe(780);
    expect(easy?.fumen.measures.every((measure) =>
      measure.branches[1].notes.length === 0 && measure.branches[2].notes.length === 0)).toBe(true);
    expect(oni?.fumen.header.hasBranches).toBe(1);
    expect(oni && summarizeFumenMetadata(oni.fumen).notes).toBe(0); // Master route contains only a balloon

    for (const chart of imported.charts) {
      expect(verifyEncoderSelfConsistent(chart.fumen).ok).toBe(true);
      expect(importChartSlot('target', chart).filename).toMatch(/^target_[enhm](?:_[12])?\.bin$/);
    }
  });

  test('applies all TJA-owned metadata and clears absent difficulties', () => {
    const imported = convertTjaForImport(TJA);
    const next = applyTjaImportMetadata(datatables(), 17, 'target', imported);
    const row = next.musicinfo.items[0];

    expect(row).toMatchObject({ starEasy: 3, starNormal: 0, starHard: 0, starMania: 8, starUra: 0 });
    expect(row.branchEasy).toBe(false);
    expect(row.branchMania).toBe(true);
    expect(row.normalOnpuNum).toBe(0);
    expect(row.hardOnpuNum).toBe(0);
    expect(next.wordlist.items.find((item) => item.key === 'song_target')).toMatchObject({
      japaneseText: '日本語タイトル',
      englishUsText: 'Fallback title',
      chineseTText: '中文標題',
      chineseSText: '中文標題',
      koreanText: 'Fallback title',
    });
  });

  test('JPN metadata import leaves Simplified Chinese untouched while applying supported locales', () => {
    const imported = convertTjaForImport(TJA);
    const seeded = datatables();
    const title = seeded.wordlist.items.find((item) => item.key === 'song_target')!;
    const subtitle = seeded.wordlist.items.find((item) => item.key === 'song_sub_target')!;
    title.chineseSText = 'keep JPN title sentinel';
    subtitle.chineseSText = 'keep JPN subtitle sentinel';

    const next = applyTjaImportMetadata(seeded, 17, 'target', imported, 'jpn');
    expect(next.wordlist.items.find((item) => item.key === 'song_target')).toMatchObject({
      japaneseText: '日本語タイトル',
      chineseTText: '中文標題',
      chineseSText: 'keep JPN title sentinel',
    });
    expect(next.wordlist.items.find((item) => item.key === 'song_sub_target')).toMatchObject({
      japaneseText: '日本語サブ',
      chineseSText: 'keep JPN subtitle sentinel',
    });
  });

  test('splits two-valued SCOREINIT into the fumen base and the Shin-uchi score', () => {
    const imported = convertTjaForImport(`
TITLE:Two-valued
BPM:180

COURSE:Oni
LEVEL:8
SCOREINIT:550,1780
SCOREDIFF:140
#START
1,
#END

COURSE:Hard
LEVEL:6
SCOREINIT:620
SCOREDIFF:170
#START
1,
#END
`);
    const oni = imported.charts.find((c) => c.slot.difficulty === 'oni' && c.slot.player === 'single');
    const hard = imported.charts.find((c) => c.slot.difficulty === 'hard' && c.slot.player === 'single');
    // The legacy base stays in the notes; only the second value is Shin-uchi.
    expect(oni?.scoreBase).toBe(550);
    expect(oni?.shinutiBase).toBe(1780);
    expect(hard?.scoreBase).toBe(620);
    expect(hard?.shinutiBase).toBe(0);

    // Every course keeps its Duet twin in step. The two-valued course takes its
    // base from the TJA; the single-valued one derives its own (one note, no
    // bonus ⇒ the whole 1,000,000 target rests on it). Difficulties the TJA does
    // not carry get the corpus's absent-chart sentinel.
    const patch = shinutiPatch(imported);
    expect(patch).toEqual({
      shinutiMania: 1780, shinutiManiaDuet: 1780,
      shinutiScoreMania: 1780, shinutiScoreManiaDuet: 1780,
      shinutiHard: 1_000_000, shinutiHardDuet: 1_000_000,
      shinutiScoreHard: 1_000_000, shinutiScoreHardDuet: 1_000_000,
      shinutiEasy: 1000, shinutiEasyDuet: 1000, shinutiScoreEasy: 1000, shinutiScoreEasyDuet: 1000,
      shinutiNormal: 1000, shinutiNormalDuet: 1000, shinutiScoreNormal: 1000, shinutiScoreNormalDuet: 1000,
      shinutiUra: 1000, shinutiUraDuet: 1000, shinutiScoreUra: 1000, shinutiScoreUraDuet: 1000,
    });

    const seeded = datatables();
    seeded.musicinfo.items[0] = { ...seeded.musicinfo.items[0], shinutiHard: 4242 };
    const row = applyTjaImportMetadata(seeded, 17, 'target', imported).musicinfo.items[0];
    expect(row.shinutiMania).toBe(1780);
    expect(row.shinutiManiaDuet).toBe(1780);
    expect(row.shinutiScoreMania).toBe(1780);
    // The stale value for a course the TJA now describes is replaced, not kept.
    expect(row.shinutiHard).toBe(1_000_000);
  });

  test('recovers corpus edge cases instead of rejecting the file', () => {
    const imported = convertTjaForImport(`
TITLE:Special
BPM:180
COURSE:Tower
LEVEL:10
BALLOON:
#START
7,
7,
8,
8,
#END
`);
    const oni = imported.charts.find((chart) => chart.slot.difficulty === 'oni' && chart.slot.player === 'single');
    expect(oni?.sourceCourse).toBe('tower');
    expect(imported.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'missing-offset',
      'special-course',
      'balloon-defaulted',
      'overlapping-long-note',
      'orphan-roll-end',
    ]));
    expect(oni && verifyEncoderSelfConsistent(oni.fumen).ok).toBe(true);
  });

  test('preserves explicit P1/P2 charts and keeps NEXTSONG sections on one timeline', () => {
    const imported = convertTjaForImport(`
TITLE:Double medley
BPM:120
OFFSET:0
COURSE:Oni
LEVEL:8
STYLE:Double
#START P1
1000,
#NEXTSONG Next,Subtitle,Genre,next.ogg,600,150
#BPMCHANGE 180
1000,
#END
#START P2
2000,
#NEXTSONG Next,Subtitle,Genre,next.ogg,600,150
#BPMCHANGE 180
2000,
#END
`);

    const chart = (player: 'single' | 'p1' | 'p2') => imported.charts.find((candidate) =>
      candidate.slot.difficulty === 'oni' && candidate.slot.player === player);
    const firstType = (player: 'single' | 'p1' | 'p2') => chart(player)?.fumen.measures[0].branches[0].notes[0].type;

    expect(firstType('single')).toBe(firstType('p1'));
    expect([1, 2, 3]).toContain(firstType('p1'));
    expect([4, 5]).toContain(firstType('p2'));
    expect(chart('p1')?.fumen.measures.map((measure) => measure.bpm)).toEqual([120, 180]);
    expect(imported.warnings.some((warning) => warning.code === 'ignored-command')).toBe(false);
  });
});
