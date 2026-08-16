import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  decodeJsonPayload,
  detectGameVersion,
  isGameVersion,
  openEnvelope,
  type MusicInfoFile,
} from '../../src/codec';
import {
  DATATABLE_KEY_HEX,
  DUMPS,
  HAS_ALL_DUMPS,
  HAS_KEYS,
} from '../helpers/resources';

describe('game-version detection', () => {
  test('recognizes only supported selections', () => {
    expect(isGameVersion('chn')).toBe(true);
    expect(isGameVersion('jpn')).toBe(true);
    expect(isGameVersion('CHN')).toBe(false);
    expect(isGameVersion(undefined)).toBe(false);
    expect(isGameVersion(1)).toBe(false);
  });

  test('boolean spike flags vote for CHN', () => {
    expect(detectGameVersion({
      items: [{ uniqueId: 1, id: 'a', spikeOnEasy: false, spikeOnOni: true }],
    })).toBe('chn');
  });

  test('finite numeric spike flags vote for JPN', () => {
    expect(detectGameVersion({
      items: [{ uniqueId: 1, id: 'a', spikeOnEasy: 0, spikeOnOni: 2 }],
    })).toBe('jpn');
  });

  test('mixed files use the dominant runtime type', () => {
    expect(detectGameVersion({
      items: [
        { uniqueId: 1, id: 'a', spikeOnEasy: false, spikeOnNormal: true },
        { uniqueId: 2, id: 'b', spikeOnEasy: 0 },
      ],
    })).toBe('chn');

    expect(detectGameVersion({
      items: [
        { uniqueId: 1, id: 'a', spikeOnEasy: false },
        { uniqueId: 2, id: 'b', spikeOnEasy: 0, spikeOnNormal: 1 },
      ],
    })).toBe('jpn');
  });

  test('ties and files without usable evidence stay unknown', () => {
    expect(detectGameVersion({
      items: [{ uniqueId: 1, id: 'a', spikeOnEasy: false, spikeOnNormal: 0 }],
    })).toBeUndefined();
    expect(detectGameVersion({
      items: [{
        uniqueId: 1,
        id: 'a',
        spikeOnEasy: Number.NaN,
        spikeOnNormal: Number.POSITIVE_INFINITY,
        spikeOnHard: '0' as unknown as number,
      }],
    })).toBeUndefined();
    expect(detectGameVersion({ items: [] })).toBeUndefined();
  });
});

describe.skipIf(!HAS_KEYS || !HAS_ALL_DUMPS)('game-version detection corpus', () => {
  test.each(DUMPS)('detects the $region musicinfo dump', async ({ region, x64 }) => {
    const bytes = await readFile(resolve(x64, 'datatable/musicinfo.bin'));
    const { payload } = await openEnvelope(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      DATATABLE_KEY_HEX,
    );
    const musicinfo = decodeJsonPayload<MusicInfoFile>(payload);

    expect(detectGameVersion(musicinfo)).toBe(region === 'CHN' ? 'chn' : 'jpn');
  });
});
