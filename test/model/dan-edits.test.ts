import { describe, expect, test } from 'vitest';
import {
  addBorder,
  addGaidenDan,
  addNormalDan,
  addOdaiSong,
  clearDan,
  isEmptyDan,
  removeBorder,
  removeOdaiSong,
  removeTrailingDan,
  sameDanContentIgnoringVerup,
  scaffoldGaidenConfig,
  scaffoldNormalConfig,
  setBorderType,
  setBorderValue,
  setOdaiSongHidden,
  setOdaiSongLevel,
  setOdaiSongNo,
} from '../../src/model/danEdits';
import { BORDER_TYPE_ALL, BORDER_TYPE_PER_SONG, NORMAL_MAX_DANS, parseDanConfig, serializeDanConfig, type DanConfig } from '../../src/codec/serverdata';

function normalConfig(n: number): DanConfig {
  let c = scaffoldNormalConfig();
  while (c.length < n) c = addNormalDan(c);
  return c;
}

describe('dan scaffolds', () => {
  test('normal scaffold is one empty first-rank dan', () => {
    const c = scaffoldNormalConfig();
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ danId: 1, verupNo: 1, title: '5kyuu' });
    expect(isEmptyDan(c[0])).toBe(true);
    expect(c[0].aryOdaiSong).toHaveLength(3);
    // A scaffold round-trips through the codec.
    expect(parseDanConfig(serializeDanConfig(c))).toEqual(c);
  });

  test('gaiden scaffold starts at danId 20', () => {
    const c = scaffoldGaidenConfig();
    expect(c[0]).toMatchObject({ danId: 20, verupNo: 1 });
    expect(c[0].title).toMatch(/gaiden/);
  });
});

describe('dan add / remove', () => {
  test('addNormalDan appends the next positional rank, caps at 19', () => {
    const c2 = addNormalDan(scaffoldNormalConfig());
    expect(c2).toHaveLength(2);
    expect(c2[1]).toMatchObject({ danId: 2, title: '4kyuu' });
    const full = normalConfig(NORMAL_MAX_DANS);
    expect(full).toHaveLength(NORMAL_MAX_DANS);
    expect(full[18]).toMatchObject({ danId: 19, title: '14dan' });
    // At the cap, adding is a no-op (same reference).
    expect(addNormalDan(full)).toBe(full);
  });

  test('addGaidenDan continues past the normal range', () => {
    const c = addGaidenDan(scaffoldGaidenConfig());
    expect(c).toHaveLength(2);
    expect(c[1].danId).toBe(21);
  });

  test('removeTrailingDan only removes the last entry', () => {
    const c = normalConfig(3);
    expect(removeTrailingDan(c, 2)).toBe(c); // not the trailing dan → no-op
    const removed = removeTrailingDan(c, 3);
    expect(removed).toHaveLength(2);
    expect(removed.map((d) => d.danId)).toEqual([1, 2]);
  });

  test('addOdaiSong / removeOdaiSong grow and shrink the slot list', () => {
    let c = scaffoldNormalConfig(); // 1 dan, 3 empty song slots
    c = addOdaiSong(c, 1);
    expect(c[0].aryOdaiSong).toHaveLength(4);
    c = removeOdaiSong(c, 1, 0);
    expect(c[0].aryOdaiSong).toHaveLength(3);
    expect(removeOdaiSong(c, 1, 9)).toBe(c); // out of range → no-op (same ref)
  });

  test('clearDan blanks songs + criteria', () => {
    let c = scaffoldNormalConfig();
    c = setOdaiSongNo(c, 1, 0, 420);
    c = addBorder(c, 1);
    expect(isEmptyDan(c[0])).toBe(false);
    const cleared = clearDan(c, 1);
    expect(isEmptyDan(cleared[0])).toBe(true);
    expect(cleared[0].aryOdaiBorder).toHaveLength(0);
  });
});

describe('song + border edits are immutable + structurally shared', () => {
  test('setOdaiSong* only rewrites the touched dan; no-ops share the ref', () => {
    const c = normalConfig(2);
    const edited = setOdaiSongLevel(c, 1, 0, 5);
    expect(edited).not.toBe(c);
    expect(edited[0].aryOdaiSong[0].level).toBe(5);
    expect(edited[1]).toBe(c[1]); // untouched dan is the same object
    // Setting the same value is a no-op.
    expect(setOdaiSongLevel(edited, 1, 0, 5)).toBe(edited);
  });

  test('setOdaiSongHidden + setOdaiSongNo write their fields', () => {
    let c = scaffoldNormalConfig();
    c = setOdaiSongHidden(c, 1, 2, true);
    c = setOdaiSongNo(c, 1, 2, 881);
    expect(c[0].aryOdaiSong[2]).toMatchObject({ songNo: 881, isHiddenSongName: true });
  });

  test('border type + value edits, and PerSong/All emit the right on-disk fields', () => {
    let c = scaffoldNormalConfig();
    c = addBorder(c, 1); // SoulGauge All, red 90 / gold 95
    c = setBorderValue(c, 1, 0, 'redBorderTotal', 88);
    expect(c[0].aryOdaiBorder[0].redBorderTotal).toBe(88);
    // Switch to PerSong; the serialized text now carries *_1/_2/_3, not *Total.
    c = setBorderType(c, 1, 0, BORDER_TYPE_PER_SONG);
    c = setBorderValue(c, 1, 0, 'redBorder_2', 42);
    const text = serializeDanConfig(c);
    expect(text).toContain('"redBorder_2":42');
    expect(text.slice(text.indexOf('"aryOdaiBorder"'))).not.toContain('redBorderTotal');
    // Back to All: *Total returns, *_1/_2/_3 drop out of the text.
    c = setBorderType(c, 1, 0, BORDER_TYPE_ALL);
    const text2 = serializeDanConfig(c);
    expect(text2).toContain('"redBorderTotal":88');
    expect(text2.slice(text2.indexOf('"aryOdaiBorder"'))).not.toContain('redBorder_1');
  });

  test('removeBorder drops the row', () => {
    let c = addBorder(addBorder(scaffoldNormalConfig(), 1), 1);
    expect(c[0].aryOdaiBorder).toHaveLength(2);
    c = removeBorder(c, 1, 0);
    expect(c[0].aryOdaiBorder).toHaveLength(1);
  });
});

describe('verupNo content comparison', () => {
  test('sameDanContentIgnoringVerup ignores only verupNo', () => {
    const a = scaffoldNormalConfig()[0];
    const b = { ...a, verupNo: a.verupNo + 5 };
    expect(sameDanContentIgnoringVerup(a, b)).toBe(true);
    const c = { ...a, title: 'changed' };
    expect(sameDanContentIgnoringVerup(a, c)).toBe(false);
  });
});
