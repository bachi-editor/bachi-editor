import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { describe, expect, test } from 'vitest';
import { danStructureWarnings, validateDan, validateSection, sectionErrorCount, type DanSongResolver } from '../../src/model/danValidation';
import {
  DAN_CONDITION_TYPES,
  parseDanConfig,
  type DanConfig,
  type DanEntry,
  type OdaiBorder,
} from '../../src/codec/serverdata';
import { HAS_SERVER_DATA, SERVER_DATA_DIR as DATA } from '../helpers/resources';

function border(odaiType: number, borderType: number): OdaiBorder {
  return {
    odaiType, borderType,
    redBorderTotal: 90, goldBorderTotal: 95,
    redBorder_1: 1, redBorder_2: 1, redBorder_3: 1, goldBorder_1: 1, goldBorder_2: 1, goldBorder_3: 1,
  };
}

// Fake catalog: #420 = a plain Oni song, #999 = a song with Ura, others unknown.
const resolve: DanSongResolver = (songNo) => {
  if (songNo === 420) {
    return {
      id: 'song420', title: 'Song 420', hasUra: false,
      stars: { easy: 3, normal: 5, hard: 7, oni: 8, ura: 0 },
    };
  }
  if (songNo === 999) {
    return {
      id: 'song999', title: 'Ura Song', hasUra: true,
      stars: { easy: 4, normal: 6, hard: 8, oni: 10, ura: 10 },
    };
  }
  return undefined;
};

function dan(over: Partial<DanEntry> = {}): DanEntry {
  return {
    danId: 1, verupNo: 1, title: '5kyuu',
    aryOdaiSong: [
      { songNo: 420, level: 4, isHiddenSongName: false },
      { songNo: 420, level: 4, isHiddenSongName: false },
      { songNo: 420, level: 4, isHiddenSongName: false },
    ],
    aryOdaiBorder: [{ odaiType: 1, borderType: 1, redBorderTotal: 90, goldBorderTotal: 95, redBorder_1: 0, redBorder_2: 0, redBorder_3: 0, goldBorder_1: 0, goldBorder_2: 0, goldBorder_3: 0 }],
    ...over,
  };
}

describe('Dan condition comparisons', () => {
  test('uses strict upper limits only for OK and Bad', () => {
    expect(DAN_CONDITION_TYPES.map(({ name, comparison }) => [name, comparison])).toEqual([
      ['SoulGauge', '≥'],
      ['GoodCount', '≥'],
      ['OkCount', '<'],
      ['BadCount', '<'],
      ['ComboCount', '≥'],
      ['DrumrollCount', '≥'],
      ['Score', '≥'],
      ['TotalHitCount', '≥'],
    ]);
  });
});

describe('validateDan', () => {
  test('a well-formed dan has no errors', () => {
    expect(validateDan(dan(), resolve).filter((i) => i.level === 'error')).toHaveLength(0);
  });

  test('an empty dan is a single blocking error', () => {
    const issues = validateDan(dan({ aryOdaiSong: [zero(), zero(), zero()] }), resolve);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ level: 'error' });
    expect(issues[0].message).toMatch(/cleared/);
  });

  test('unset + unresolved songs error only when a resolver is present', () => {
    const withUnknown = dan({ aryOdaiSong: [{ songNo: 12345, level: 4, isHiddenSongName: false }, s(420), s(420)] });
    // With catalog: 12345 does not resolve → error.
    expect(validateDan(withUnknown, resolve).some((i) => /does not resolve/.test(i.message))).toBe(true);
    // Without catalog: no resolution error (only range checks apply).
    expect(validateDan(withUnknown, undefined).some((i) => /does not resolve/.test(i.message))).toBe(false);
  });

  test('out-of-range course is an error', () => {
    expect(validateDan(dan({ aryOdaiSong: [{ songNo: 420, level: 7, isHiddenSongName: false }, s(420), s(420)] }), resolve)
      .some((i) => /out of range/.test(i.message))).toBe(true);
  });

  test('Ura course on a song without Ura warns', () => {
    const issues = validateDan(dan({ aryOdaiSong: [{ songNo: 420, level: 5, isHiddenSongName: false }, s(420), s(420)] }), resolve);
    expect(issues.some((i) => i.level === 'warning' && /no Ura Oni chart/.test(i.message))).toBe(true);
    // #999 has Ura → no such warning.
    const ok = validateDan(dan({ aryOdaiSong: [{ songNo: 999, level: 5, isHiddenSongName: false }, s(420), s(420)] }), resolve);
    expect(ok.some((i) => /no Ura Oni chart/.test(i.message))).toBe(false);
  });

  test('no criteria warns; bad odaiType/borderType error', () => {
    expect(validateDan(dan({ aryOdaiBorder: [] }), resolve).some((i) => i.level === 'warning')).toBe(true);
    const bad = dan({ aryOdaiBorder: [{ ...dan().aryOdaiBorder[0], odaiType: 99, borderType: 3 }] });
    const msgs = validateDan(bad, resolve).map((i) => i.message).join(' ');
    expect(msgs).toMatch(/unknown odaiType/);
    expect(msgs).toMatch(/invalid borderType/);
  });
});

describe('validateSection', () => {
  test('a contiguity gap (empty dan before a filled one) is an error', () => {
    const config: DanConfig = [dan({ danId: 1 }), dan({ danId: 2, aryOdaiSong: [zero(), zero(), zero()] }), dan({ danId: 3 })];
    const { errors } = validateSection(config, resolve, 'normal');
    expect(errors.some((e) => /Gap/.test(e.message))).toBe(true);
  });

  test('a duplicate danId is an error', () => {
    const config: DanConfig = [dan({ danId: 1 }), dan({ danId: 1 })];
    expect(validateSection(config, resolve, 'normal').errors.some((e) => /Duplicate danId/.test(e.message))).toBe(true);
  });

  test('warnings are only collected for edited dans', () => {
    const config: DanConfig = [dan({ aryOdaiBorder: [] })]; // triggers the "no criteria" warning
    expect(validateSection(config, resolve, 'normal', () => false).warnings).toHaveLength(0);
    expect(validateSection(config, resolve, 'normal', () => true).warnings.length).toBeGreaterThan(0);
  });

  test('sectionErrorCount aggregates blocking errors', () => {
    const clean: DanConfig = [dan()];
    expect(sectionErrorCount(clean, resolve, 'normal')).toBe(0);
    const broken: DanConfig = [dan({ aryOdaiSong: [zero(), zero(), zero()] })];
    expect(sectionErrorCount(broken, resolve, 'normal')).toBeGreaterThan(0);
  });
});

function s(songNo: number) {
  return { songNo, level: 4, isHiddenSongName: false };
}
function zero() {
  return { songNo: 0, level: 4, isHiddenSongName: false };
}

describe('danStructureWarnings (constraints distilled from 6 seasons + corpus)', () => {
  test.skipIf(!HAS_SERVER_DATA)('the real corpus raises ZERO structural warnings', async () => {
    for (const f of ['dan_data.json', 'gaiden_data.json']) {
      const config = parseDanConfig(await readFile(resolvePath(DATA, f), 'utf8'));
      for (const d of config) {
        expect(danStructureWarnings(d), `${f} dan ${d.danId}`).toEqual([]);
      }
    }
  });

  test('canonical shapes are clean', () => {
    // [Gauge, TotalHit] · [Gauge, TotalHit, Bad] · [Gauge, Good, Bad, Drum(per-song)] · Combo variant
    for (const borders of [
      [border(1, 1), border(8, 1)],
      [border(1, 1), border(8, 1), border(4, 1)],
      [border(1, 1), border(2, 1), border(4, 1), border(6, 2)],
      [border(1, 1), border(3, 1), border(4, 1), border(6, 2)],
      [border(1, 1), border(5, 1), border(4, 1), border(6, 2)],
    ]) {
      expect(danStructureWarnings(dan({ aryOdaiBorder: borders }))).toEqual([]);
    }
  });

  test('flags a non-Soul-Gauge first condition', () => {
    expect(danStructureWarnings(dan({ aryOdaiBorder: [border(8, 1), border(1, 1)] }))
      .some((i) => /first criterion/.test(i.message))).toBe(true);
  });

  test('flags a missing Soul Gauge', () => {
    expect(danStructureWarnings(dan({ aryOdaiBorder: [border(8, 1)] }))
      .some((i) => /No Soul Gauge/.test(i.message))).toBe(true);
  });

  test('flags a per-song Soul Gauge', () => {
    expect(danStructureWarnings(dan({ aryOdaiBorder: [border(1, 2)] }))
      .some((i) => /whole set/.test(i.message))).toBe(true);
  });

  test('flags a whole-set Drumroll', () => {
    expect(danStructureWarnings(dan({ aryOdaiBorder: [border(1, 1), border(6, 1)] }))
      .some((i) => /per song/.test(i.message))).toBe(true);
  });

  test('flags Drumroll that is not the last criterion', () => {
    expect(danStructureWarnings(dan({ aryOdaiBorder: [border(1, 1), border(6, 2), border(4, 1)] }))
      .some((i) => /last criterion/.test(i.message))).toBe(true);
  });

  test('flags Score usage', () => {
    expect(danStructureWarnings(dan({ aryOdaiBorder: [border(1, 1), border(7, 1)] }))
      .some((i) => /Score/.test(i.message))).toBe(true);
  });

  test('flags more than four criteria', () => {
    expect(danStructureWarnings(dan({ aryOdaiBorder: [border(1, 1), border(2, 1), border(4, 1), border(6, 2), border(3, 1)] }))
      .some((i) => /at most 4/.test(i.message))).toBe(true);
  });

  test('flags a duplicate condition type', () => {
    expect(danStructureWarnings(dan({ aryOdaiBorder: [border(1, 1), border(4, 1), border(4, 1)] }))
      .some((i) => /at most once/.test(i.message))).toBe(true);
  });
});

describe('red/gold ordering (validateDan)', () => {
  const goldMsg = (d: DanEntry) => validateDan(d, resolve).some((i) => /gold is/.test(i.message));

  test.skipIf(!HAS_SERVER_DATA)('validateDan is fully clean on the real corpus (no catalog)', async () => {
    for (const f of ['dan_data.json', 'gaiden_data.json']) {
      const config = parseDanConfig(await readFile(resolvePath(DATA, f), 'utf8'));
      for (const d of config) {
        expect(validateDan(d, undefined), `${f} dan ${d.danId}`).toEqual([]);
      }
    }
  });

  test('normal type warns when gold < red, clean when gold ≥ red', () => {
    expect(goldMsg(dan({ aryOdaiBorder: [{ ...border(1, 1), redBorderTotal: 95, goldBorderTotal: 90 }] }))).toBe(true);
    expect(goldMsg(dan({ aryOdaiBorder: [{ ...border(1, 1), redBorderTotal: 90, goldBorderTotal: 95 }] }))).toBe(false);
  });

  test('upper-limit type (Bad) warns when gold > red, clean when gold ≤ red', () => {
    expect(goldMsg(dan({ aryOdaiBorder: [border(1, 1), { ...border(4, 1), redBorderTotal: 30, goldBorderTotal: 40 }] }))).toBe(true);
    expect(goldMsg(dan({ aryOdaiBorder: [border(1, 1), { ...border(4, 1), redBorderTotal: 40, goldBorderTotal: 30 }] }))).toBe(false);
  });

  test('per-song warns on an inverted pair but not on 0/0 pairs', () => {
    // Drumroll (normal), song 2 inverted (gold < red).
    expect(goldMsg(dan({ aryOdaiBorder: [border(1, 1), { ...border(6, 2), redBorder_2: 50, goldBorder_2: 40 }] }))).toBe(true);
    // All three songs "no requirement" (0/0) — never a violation.
    expect(goldMsg(dan({ aryOdaiBorder: [border(1, 1), {
      ...border(6, 2), redBorder_1: 0, goldBorder_1: 0, redBorder_2: 0, goldBorder_2: 0, redBorder_3: 0, goldBorder_3: 0,
    }] }))).toBe(false);
  });
});
