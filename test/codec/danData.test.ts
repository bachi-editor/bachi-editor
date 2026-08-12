import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseDanConfig, serializeDanConfig } from '../../src/codec/serverdata/danData';
import { BORDER_TYPE_ALL, BORDER_TYPE_PER_SONG, EXPECTED_ODAI_SONGS } from '../../src/codec/serverdata/types';
import { HAS_SERVER_DATA, SERVER_DATA_DIR } from '../helpers/resources';

const FILES = ['dan_data.json', 'gaiden_data.json'];

async function readText(name: string): Promise<string> {
  return readFile(resolve(SERVER_DATA_DIR, name), 'utf8');
}

describe.skipIf(!HAS_SERVER_DATA)('dani config codec', () => {
  // The core guarantee: an unchanged file re-saves byte-for-byte identically.
  for (const name of FILES) {
    test(`${name} round-trips byte-identically`, async () => {
      const text = await readText(name);
      const config = parseDanConfig(text);
      expect(serializeDanConfig(config)).toBe(text);
    });
  }

  test('dan_data.json parses to the expected corpus shape', async () => {
    const config = parseDanConfig(await readText('dan_data.json'));
    expect(config).toHaveLength(19);
    expect(config.map((d) => d.danId)).toEqual([...Array(19)].map((_, i) => i + 1));
    for (const dan of config) {
      expect(dan.aryOdaiSong).toHaveLength(EXPECTED_ODAI_SONGS);
      expect(dan.aryOdaiBorder.length).toBeGreaterThan(0);
      for (const b of dan.aryOdaiBorder) {
        expect([BORDER_TYPE_ALL, BORDER_TYPE_PER_SONG]).toContain(b.borderType);
      }
    }
    // Spot-check danId 1 = "5kyuu": first song #420 Normal, SoulGauge 92/95.
    expect(config[0].title).toBe('5kyuu');
    expect(config[0].aryOdaiSong[0]).toEqual({ songNo: 420, level: 2, isHiddenSongName: false });
    expect(config[0].aryOdaiBorder[0]).toMatchObject({
      odaiType: 1,
      borderType: BORDER_TYPE_ALL,
      redBorderTotal: 92,
      goldBorderTotal: 95,
    });
  });

  test('gaiden_data.json is a single bespoke-titled gaiden entry', async () => {
    const config = parseDanConfig(await readText('gaiden_data.json'));
    expect(config).toHaveLength(1);
    expect(config[0].danId).toBe(20);
    expect(config[0].title).toBe('gaiden_2022_odai_7');
  });

  test('serializer omits Total fields on PerSong borders and vice versa', () => {
    const text = serializeDanConfig([
      {
        danId: 1,
        verupNo: 1,
        title: '5kyuu',
        aryOdaiSong: [
          { songNo: 1, level: 4, isHiddenSongName: false },
          { songNo: 2, level: 4, isHiddenSongName: true },
          { songNo: 3, level: 5, isHiddenSongName: false },
        ],
        aryOdaiBorder: [
          {
            odaiType: 1, borderType: BORDER_TYPE_ALL,
            redBorderTotal: 92, goldBorderTotal: 95,
            redBorder_1: 0, redBorder_2: 0, redBorder_3: 0,
            goldBorder_1: 0, goldBorder_2: 0, goldBorder_3: 0,
          },
          {
            odaiType: 6, borderType: BORDER_TYPE_PER_SONG,
            redBorderTotal: 0, goldBorderTotal: 0,
            redBorder_1: 58, redBorder_2: 75, redBorder_3: 29,
            goldBorder_1: 65, goldBorder_2: 84, goldBorder_3: 33,
          },
        ],
      },
    ]);
    // No space after colons, 2-space indent, no trailing newline.
    expect(text.startsWith('[\n  {\n    "danId":1,\n')).toBe(true);
    expect(text.endsWith(']')).toBe(true);
    expect(text).not.toContain(': ');
    // All border: only *Total present.
    expect(text).toContain('"redBorderTotal":92');
    // PerSong border: only *_1/_2/_3 present, interleaved red/gold.
    expect(text).toContain('"redBorder_1":58,\n        "goldBorder_1":65,');
    // The PerSong border must not leak an (unused, zero) *Total field.
    const perSongBlock = text.slice(text.indexOf('"odaiType":6'));
    expect(perSongBlock).not.toContain('redBorderTotal');
    // The All border must not leak an (unused, zero) per-song field.
    const allBlock = text.slice(text.indexOf('"odaiType":1'), text.indexOf('"odaiType":6'));
    expect(allBlock).not.toContain('redBorder_1');
  });

  test('parseDanConfig rejects non-dani JSON', () => {
    expect(() => parseDanConfig('{"items":[]}')).toThrow();
    expect(() => parseDanConfig('[{"uniqueId":1,"id":"x"}]')).toThrow(/dani file/);
    expect(() => parseDanConfig('not json')).toThrow(/valid JSON/);
  });
});
