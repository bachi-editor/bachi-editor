// Datatable rows are schema-by-example: CHN and JPN disagree about field types
// and locale columns, so new rows and edits must conform to the open file.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  decodeJsonPayload,
  MUSICINFO_SUPPORTED_FIELDS,
  openEnvelope,
  type CompanionSongFile,
  type MusicInfoFile,
  type MusicInfoItem,
  type MusicOrderFile,
  type WordListFile,
  type WordListItem,
} from '../../src/codec';
import {
  COMPANION_TABLES,
  type CompanionTableKey,
  type RawDatatables,
} from '../../src/fs/datatables';
import {
  conformPatchValue,
  dominantRowShape,
  scaffoldRow,
  shapeKeys,
} from '../../src/model/datatableShape';
import { diffDatatables } from '../../src/model/diff';
import {
  addSong,
  deleteSong,
  editMusicInfo,
  insertMusicOrderEntry,
  setSubtitle,
  setTitle,
} from '../../src/model/edits';
import { validate } from '../../src/model/validation';
import {
  DATATABLE_KEY_HEX,
  DUMPS,
  HAS_ALL_DUMPS,
} from '../helpers/resources';

type RegionShape = 'CHN' | 'JPN';

const COMPANIONS = Object.entries(COMPANION_TABLES) as [CompanionTableKey, (typeof COMPANION_TABLES)[CompanionTableKey]][];

function musicInfoRow(region: RegionShape, id = 'base', uniqueId = 10): MusicInfoItem {
  const row: Record<string, unknown> = { id, uniqueId, genreNo: 2 };
  for (const field of MUSICINFO_SUPPORTED_FIELDS) {
    if (field === 'songFileName') row[field] = `sound/song_${id}`;
    else if (field === 'papamama' || field.startsWith('branch')) row[field] = false;
    else if (field.startsWith('spikeOn')) row[field] = region === 'CHN' ? false : 0;
    else row[field] = 0;
  }
  // Unknown pass-through fields are part of the observed shape too.
  row.regionExtension = region === 'CHN' ? false : 0;
  return row as MusicInfoItem;
}

function wordlistRow(
  region: RegionShape,
  prefix: 'song_' | 'song_sub_' | 'song_detail_',
  id = 'base',
): WordListItem {
  const row: Record<string, unknown> = {
    key: `${prefix}${id}`,
    japaneseText: '日本語',
    japaneseFontType: 1,
    englishUsText: 'English',
    englishUsFontType: 2,
    chineseTText: '繁體',
    chineseTFontType: 3,
    koreanText: '한국어',
    koreanFontType: 4,
  };
  if (region === 'CHN') {
    row.chineseSText = '简体';
    row.chineseSFontType = 5;
  }
  // Give each wordlist population a visibly different shape. addSong must
  // sample title/subtitle/detail independently rather than using the first row.
  row[`${prefix.replace(/_+$/g, '')}ShapeMarker`] = prefix === 'song_' ? 7 : false;
  return row as WordListItem;
}

function syntheticDump(region: RegionShape): RawDatatables {
  const info = musicInfoRow(region);
  return {
    musicinfo: { items: [info], syntheticVersion: region },
    musicOrder: {
      items: [{ genreNo: 2, id: info.id, uniqueId: info.uniqueId, closeDispType: 1, hiddenFlag: false }],
    },
    wordlist: {
      items: [
        wordlistRow(region, 'song_'),
        wordlistRow(region, 'song_sub_'),
        wordlistRow(region, 'song_detail_'),
      ],
    },
    musicAttribute: {
      items: [{ id: info.id, uniqueId: info.uniqueId, ensoBg: 8, enabled: true }],
    },
    musicUsbSetting: {
      items: [{ uniqueId: info.uniqueId, id: info.id, usbSetting: 3 }],
    },
    musicAiSection: {
      items: [{ id: info.id, aiEnabled: false, uniqueId: info.uniqueId, sectionCount: 4 }],
    },
  };
}

function sameKeysAndTypes(actual: Record<string, unknown>, reference: Record<string, unknown>): void {
  expect(Object.keys(actual)).toEqual(Object.keys(reference));
  for (const key of Object.keys(reference)) {
    expect(typeof actual[key], key).toBe(typeof reference[key]);
  }
}

function familyOf(row: WordListItem, prefix: 'song_' | 'song_sub_' | 'song_detail_'): boolean {
  if (!row.key.startsWith(prefix)) return false;
  if (prefix === 'song_') {
    return !row.key.startsWith('song_sub_') && !row.key.startsWith('song_detail_');
  }
  return true;
}

describe('datatable shape primitives', () => {
  test('scaffolds the dominant key order and JSON types', () => {
    const rows = [
      { id: 'odd', count: 9 },
      { id: 'a', count: 5, enabled: true, note: 'x' },
      { id: 'b', count: 6, enabled: false, note: 'y' },
    ];
    const row = scaffoldRow(rows, { id: 'new', foreignLocale: 'drop me' } as never);

    expect(dominantRowShape(rows)).toBe(rows[1]);
    expect(Object.keys(row)).toEqual(['id', 'count', 'enabled', 'note']);
    expect(row).toEqual({ id: 'new', count: 0, enabled: false, note: '' });
    expect('foreignLocale' in row).toBe(false);
  });

  test('ensure appends a missing required field without replacing observed fields', () => {
    const row = scaffoldRow(
      [{ id: 'a', count: 2 }],
      { id: 'new' },
      { ensure: { count: 99, closeDispType: 1 } as never },
    );
    expect(Object.keys(row)).toEqual(['id', 'count', 'closeDispType']);
    expect(row).toEqual({ id: 'new', count: 0, closeDispType: 0 });
  });

  test('shapeKeys uses only the requested row family', () => {
    const rows = [
      { key: 'song_a', titleOnly: 1 },
      { key: 'song_b', titleOnly: 2 },
      { key: 'song_sub_a', subtitleOnly: false },
    ];
    expect([...shapeKeys(rows, { shapeFrom: (row) => familyOf(row, 'song_sub_') })])
      .toEqual(['key', 'subtitleOnly']);
  });
});

describe('field type conformance', () => {
  test('maps boolean controls to the row type already on disk', () => {
    expect(conformPatchValue(0, true)).toBe(1);
    expect(conformPatchValue(2, false)).toBe(0);
    expect(conformPatchValue(false, 1)).toBe(true);
    expect(conformPatchValue(true, 0)).toBe(false);
    expect(conformPatchValue('old', 'new')).toBe('new');
  });

  test.each([
    ['CHN', true, 'boolean'],
    ['JPN', 1, 'number'],
  ] as const)('Metadata edits preserve the %s spikeOn type', (region, expected, expectedType) => {
    const base = syntheticDump(region);
    const next = editMusicInfo(base, 10, { spikeOnOni: true });
    const row = next.musicinfo.items[0];
    expect(row.spikeOnOni).toBe(expected);
    expect(typeof row.spikeOnOni).toBe(expectedType);
  });
});

describe.each(['CHN', 'JPN'] as const)('%s-shaped song scaffolding', (region) => {
  test('copies musicinfo, wordlist, and companion shapes without importing the other region', () => {
    const base = syntheticDump(region);
    const next = addSong(base, {
      uniqueId: 77,
      id: 'new_song',
      genreNo: 5,
      title: 'New Song',
    });

    const created = next.musicinfo.items.find((row) => row.id === 'new_song')!;
    sameKeysAndTypes(created, base.musicinfo.items[0]);
    expect(created.spikeOnOni).toBe(region === 'CHN' ? false : 0);

    for (const prefix of ['song_', 'song_sub_', 'song_detail_'] as const) {
      const reference = base.wordlist.items.find((row) => familyOf(row, prefix))!;
      const row = next.wordlist.items.find((item) => item.key === `${prefix}new_song`)!;
      sameKeysAndTypes(row, reference);
      expect(row).toBeDefined();
    }

    const title = next.wordlist.items.find((row) => row.key === 'song_new_song')!;
    expect(title.japaneseText).toBe('New Song');
    expect(title.englishUsText).toBe('New Song');
    expect('chineseSText' in title).toBe(region === 'CHN');
    expect('chineseSFontType' in title).toBe(region === 'CHN');

    for (const [field] of COMPANIONS) {
      const table = next[field]!;
      const row = table.items.find((item) => item.id === 'new_song')!;
      sameKeysAndTypes(row, base[field]!.items[0]);
      expect(row.uniqueId).toBe(77);
    }

    expect(validate(next, base).issues.filter((issue) => issue.level === 'error')).toEqual([]);
  });

  test('add then delete restores every per-song table', () => {
    const base = syntheticDump(region);
    const added = addSong(base, { uniqueId: 77, id: 'temporary', genreNo: 1, title: 'Temporary' });
    const removed = deleteSong(added, 77);
    expect(removed.musicinfo.items).toEqual(base.musicinfo.items);
    expect(removed.wordlist.items).toEqual(base.wordlist.items);
    for (const [field] of COMPANIONS) expect(removed[field]!.items).toEqual(base[field]!.items);
  });
});

describe('wordlist regional columns', () => {
  test('does not invent Simplified Chinese columns in a JPN-shaped wordlist', () => {
    const base = syntheticDump('JPN');
    const added = addSong(base, { uniqueId: 77, id: 'new_song', genreNo: 2, title: 'Title' });
    for (const prefix of ['song_', 'song_sub_', 'song_detail_']) {
      const row = added.wordlist.items.find((item) => item.key === `${prefix}new_song`)!;
      expect('chineseSText' in row).toBe(false);
      expect('chineseSFontType' in row).toBe(false);
    }
  });

  test('localized edits are no-ops when the selected locale is absent', () => {
    const base = syntheticDump('JPN');
    expect(setTitle(base, 'base', 'chineseSText', 'Do not add')).toBe(base);
    expect(setSubtitle(base, 'missing', 'chineseSText', 'Do not add')).toBe(base);
    expect(base.wordlist.items.every((row) => !('chineseSText' in row))).toBe(true);
  });
});

describe('music_order shape', () => {
  test('insertMusicOrderEntry preserves closeDispType and other pass-through fields', () => {
    const base = syntheticDump('JPN');
    const withSong = addSong(base, { uniqueId: 77, id: 'new_song', genreNo: 5, title: 'New Song' });
    const next = insertMusicOrderEntry(withSong, 77, 2);
    const inserted = next.musicOrder.items.find((row) => row.uniqueId === 77)!;

    sameKeysAndTypes(inserted, base.musicOrder.items[0]);
    expect(inserted).toMatchObject({
      uniqueId: 77,
      id: 'new_song',
      genreNo: 2,
      closeDispType: 0,
      hiddenFlag: false,
    });
  });
});

describe.each(COMPANIONS)('%s companion identity', (field, filename) => {
  test('a duplicate exact identity blocks validation', () => {
    const base = syntheticDump('JPN');
    const row = base[field]!.items[0];
    const draft: RawDatatables = {
      ...base,
      [field]: { ...base[field]!, items: [row, { ...row }] },
    };
    const result = validate(draft, base);

    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      level: 'error',
      message: `1 song(s) do not have exactly one matching ${filename} row (base).`,
    });
  });

  test('same id with a mismatched Song No. is both missing and orphaned', () => {
    const base = syntheticDump('JPN');
    const draft: RawDatatables = {
      ...base,
      [field]: {
        ...base[field]!,
        items: base[field]!.items.map((row) => ({ ...row, uniqueId: 999 })),
      },
    };
    const result = validate(draft, base);

    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      { level: 'error', message: `1 song(s) do not have exactly one matching ${filename} row (base).` },
      { level: 'error', message: `${filename} gained 1 row(s) with no matching musicinfo identity (base).` },
    ]));
  });

  test('diff treats a changed half of the identity as a removal plus an addition', () => {
    const base = syntheticDump('JPN');
    const draft: RawDatatables = {
      ...base,
      [field]: {
        ...base[field]!,
        items: base[field]!.items.map((row) => ({ ...row, uniqueId: 999 })),
      },
    };
    const file = diffDatatables(base, draft).files.find((entry) => entry.file === filename)!;

    expect(file.dirty).toBe(true);
    expect(file.changedRecords).toBe(2);
    expect(file.changes).toEqual([
      { label: '+ base', from: '—', to: 'Song No. 999' },
      { label: '− base', from: 'Song No. 10', to: '—' },
    ]);
  });
});

describe('missing companion tables', () => {
  test('an existing missing table warns, but adding a song makes it save-blocking', () => {
    const complete = syntheticDump('JPN');
    const base: RawDatatables = { ...complete, musicAiSection: undefined };

    const before = validate(base, base);
    expect(before.ok).toBe(true);
    expect(before.issues).toContainEqual({
      level: 'warn',
      message: 'music_ai_section.bin is missing from the project; new songs cannot be registered in it.',
    });

    const added = addSong(base, { uniqueId: 77, id: 'new_song', genreNo: 2, title: 'New Song' });
    const after = validate(added, base);
    expect(after.ok).toBe(false);
    expect(after.issues).toContainEqual({
      level: 'error',
      message: '1 new song(s) cannot be registered because music_ai_section.bin is missing (new_song).',
    });
  });
});

describe('empty catalogue regional fallbacks', () => {
  const empty = (): RawDatatables => ({
    musicinfo: { items: [] },
    musicOrder: { items: [] },
    wordlist: { items: [] },
    musicAttribute: { items: [] },
    musicUsbSetting: { items: [] },
    musicAiSection: { items: [] },
  });

  test('the first JPN song uses numeric flags, JPN locales, and complete companion shapes', () => {
    const base = empty();
    const next = addSong(base, { uniqueId: 1, id: 'first_jpn', genreNo: 0, title: 'First' }, 'jpn');
    const info = next.musicinfo.items[0];
    const title = next.wordlist.items.find((row) => row.key === 'song_first_jpn')!;

    expect(typeof info.spikeOnEasy).toBe('number');
    expect(info.spikeOnEasy).toBe(0);
    expect(title).not.toHaveProperty('chineseSText');
    expect(title).not.toHaveProperty('chineseSFontType');
    expect(Object.keys(next.musicAttribute!.items[0])).toEqual([
      'id', 'uniqueId', 'new', 'doublePlay',
      'tag1', 'tag2', 'tag3', 'tag4', 'tag5', 'tag6', 'tag7', 'tag8', 'tag9', 'tag10',
      'ensoPartsID1', 'ensoPartsID2',
      'donBg1p', 'donBg2p', 'dancerDai', 'dancer', 'danceNormalBg', 'danceFeverBg',
      'rendaEffect', 'fever',
      'donBg1p1', 'donBg2p1', 'dancerDai1', 'dancer1', 'danceNormalBg1', 'danceFeverBg1',
      'rendaEffect1', 'fever1',
    ]);
    expect(next.musicUsbSetting!.items[0]).toEqual({ id: 'first_jpn', uniqueId: 1, usbVer: '' });
    expect(next.musicAiSection!.items[0]).toEqual({
      id: 'first_jpn', uniqueId: 1,
      easy: 0, normal: 0, hard: 0, oni: 0, ura: 0,
      oniLevel11: '', uraLevel11: '',
    });
    expect(validate(next, base).issues.filter((issue) => issue.level === 'error')).toEqual([]);
  });

  test('the first CHN song keeps boolean flags and CHN-only columns', () => {
    const next = addSong(empty(), { uniqueId: 1, id: 'first_chn', genreNo: 0, title: 'First' }, 'chn');
    const info = next.musicinfo.items[0];
    const title = next.wordlist.items.find((row) => row.key === 'song_first_chn')!;

    expect(typeof info.spikeOnEasy).toBe('boolean');
    expect(info.spikeOnEasy).toBe(false);
    expect(title).toHaveProperty('chineseSText', 'First');
    expect(title).toHaveProperty('chineseSFontType', 0);
    expect(Object.keys(next.musicAttribute!.items[0]).slice(0, 5)).toEqual([
      'id', 'uniqueId', 'new', 'doublePlay', 'isNotCopyright',
    ]);
  });
});

async function loadCorpusTable<T>(x64: string, filename: string): Promise<T> {
  const file = await readFile(resolve(x64, 'datatable', filename));
  const { payload } = await openEnvelope(
    new Uint8Array(file.buffer, file.byteOffset, file.byteLength),
    DATATABLE_KEY_HEX,
  );
  return decodeJsonPayload<T>(payload);
}

async function loadCorpusDump(x64: string): Promise<RawDatatables> {
  const [musicinfo, musicOrder, wordlist, musicAttribute, musicUsbSetting, musicAiSection] =
    await Promise.all([
      loadCorpusTable<MusicInfoFile>(x64, 'musicinfo.bin'),
      loadCorpusTable<MusicOrderFile>(x64, 'music_order.bin'),
      loadCorpusTable<WordListFile>(x64, 'wordlist.bin'),
      loadCorpusTable<CompanionSongFile>(x64, 'music_attribute.bin'),
      loadCorpusTable<CompanionSongFile>(x64, 'music_usbsetting.bin'),
      loadCorpusTable<CompanionSongFile>(x64, 'music_ai_section.bin'),
    ]);
  return { musicinfo, musicOrder, wordlist, musicAttribute, musicUsbSetting, musicAiSection };
}

describe.skipIf(!HAS_ALL_DUMPS || DATATABLE_KEY_HEX === '')('real dump datatable shapes', () => {
  test.each(DUMPS)('$region accepts a scaffolded song without changing its row schemas', async ({ x64 }) => {
    const base = await loadCorpusDump(x64);
    const uniqueId = Math.max(...base.musicinfo.items.map((row) => row.uniqueId)) + 1;
    const next = addSong(base, { uniqueId, id: 'zzz_shape_test', genreNo: 0, title: 'Shape Test' });

    const reference = dominantRowShape(base.musicinfo.items)!;
    const created = next.musicinfo.items.find((row) => row.id === 'zzz_shape_test')!;
    sameKeysAndTypes(created, reference);
    for (const [field] of COMPANIONS) {
      sameKeysAndTypes(
        next[field]!.items.find((row) => row.id === 'zzz_shape_test')!,
        dominantRowShape(base[field]!.items)!,
      );
    }
    expect(validate(next, base).issues.filter((issue) => issue.level === 'error')).toEqual([]);
  });
});
