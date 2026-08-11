import { beforeEach, describe, expect, test } from 'vitest';
import { useAppStore } from '../../src/model/store';
import type { DanEntry } from '../../src/codec/serverdata';

const s = () => useAppStore.getState();

function song(songNo: number) {
  return { songNo, level: 4, isHiddenSongName: false };
}
function emptySlot(fileName: string) {
  return { loaded: false, fileName, baseline: [], draft: [], undo: [], redo: [] };
}
function resetDani() {
  useAppStore.setState({ dani: { normal: emptySlot('dan_data.json'), gaiden: emptySlot('gaiden_data.json'), saving: false } });
}

beforeEach(resetDani);

describe('dani store slice', () => {
  test('New scaffolds a dan and selects it', () => {
    s().daniNew('normal');
    expect(s().dani.normal.loaded).toBe(true);
    expect(s().dani.normal.draft).toHaveLength(1);
    expect(s().dani.sel).toEqual({ section: 'normal', danId: 1 });
  });

  test('edits push undo; undo/redo walk the section history', () => {
    s().daniNew('normal');
    s().daniSetCourse('normal', 1, 0, 5);
    expect(s().dani.normal.draft[0].aryOdaiSong[0].level).toBe(5);
    expect(s().dani.normal.undo).toHaveLength(1);
    s().daniUndo();
    expect(s().dani.normal.draft[0].aryOdaiSong[0].level).toBe(4);
    s().daniRedo();
    expect(s().dani.normal.draft[0].aryOdaiSong[0].level).toBe(5);
  });

  test('a no-op edit does not grow the undo stack', () => {
    s().daniNew('normal');
    s().daniSetCourse('normal', 1, 0, 4); // already 4
    expect(s().dani.normal.undo).toHaveLength(0);
  });

  test('add then remove-trailing dan adjusts the selection', () => {
    s().daniNew('normal');
    s().daniAddDan('normal');
    expect(s().dani.normal.draft).toHaveLength(2);
    expect(s().dani.sel).toEqual({ section: 'normal', danId: 2 });
    s().daniRemoveDan('normal'); // removes trailing danId 2
    expect(s().dani.normal.draft).toHaveLength(1);
    expect(s().dani.sel).toEqual({ section: 'normal', danId: 1 });
  });

  test('verupNo auto-bumps on a content change vs baseline, and reverts', () => {
    const base: DanEntry = {
      danId: 1, verupNo: 1, title: '5kyuu',
      aryOdaiSong: [song(420), song(420), song(420)],
      aryOdaiBorder: [],
    };
    useAppStore.setState({
      dani: {
        normal: { loaded: true, fileName: 'dan_data.json', baseline: [base], draft: [base], undo: [], redo: [] },
        gaiden: emptySlot('gaiden_data.json'),
        sel: { section: 'normal', danId: 1 },
        saving: false,
      },
    });
    s().daniSetCourse('normal', 1, 0, 5);
    expect(s().dani.normal.draft[0].verupNo).toBe(2); // bumped: content differs from baseline
    s().daniSetCourse('normal', 1, 0, 4);
    expect(s().dani.normal.draft[0].verupNo).toBe(1); // reverted: content matches baseline again
  });

  test('closing a file resets its slot and selection', () => {
    s().daniNew('normal');
    s().daniClose('normal');
    expect(s().dani.normal.loaded).toBe(false);
    expect(s().dani.normal.draft).toEqual([]);
    expect(s().dani.sel).toBeUndefined();
  });
});
