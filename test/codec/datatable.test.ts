import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { openEnvelope } from '../../src/codec/envelope';
import { DATATABLE_KEY_HEX } from '../helpers/keys';
import { DUMPS, loadBytes } from '../helpers/dumps';
import { decodeJsonPayload } from '../../src/codec/datatable/serde';
import {
  MUSICINFO_CHART_DERIVED_FIELDS,
  MUSICINFO_EDITABLE_FIELDS,
  MUSICINFO_SUPPORTED_FIELDS,
  type MusicInfoFile,
  type MusicOrderFile,
  type WordListFile,
} from '../../src/codec/datatable/types';
import { HAS_CORPUS } from '../helpers/resources';

// Pure field-model invariant — independent of any dump.
describe('musicinfo field model', () => {
  test('chart-derived musicinfo fields are supported but not directly editable', () => {
    const editable = new Set<string>(MUSICINFO_EDITABLE_FIELDS);
    expect(MUSICINFO_CHART_DERIVED_FIELDS).toEqual(expect.arrayContaining([
      'branchMania',
      'maniaOnpuNum',
      'rendaTimeMania',
      'fuusenTotalMania',
    ]));
    expect(MUSICINFO_CHART_DERIVED_FIELDS.some((field) => editable.has(field))).toBe(false);
  });
});

// The editor's field model is region-agnostic: every dump must decode through the
// same MusicInfo/MusicOrder/WordList shapes with no unmodelled musicinfo fields.
describe.skipIf(!HAS_CORPUS).each(DUMPS)('datatable JSON shapes [$region]', ({ x64 }) => {
  const DT = resolve(x64, 'datatable');

  async function openJson<T>(name: string): Promise<T> {
    const bytes = await loadBytes(resolve(DT, name));
    const { payload } = await openEnvelope(bytes, DATATABLE_KEY_HEX);
    return decodeJsonPayload<T>(payload);
  }

  test('musicinfo.bin decodes to MusicInfoFile with items array', async () => {
    const mi = await openJson<MusicInfoFile>('musicinfo.bin');
    expect(Array.isArray(mi.items)).toBe(true);
    expect(mi.items.length).toBeGreaterThan(0);
    const first = mi.items[0];
    expect(typeof first.uniqueId).toBe('number');
    expect(typeof first.id).toBe('string');
    // eslint-disable-next-line no-console
    console.log(`musicinfo: ${mi.items.length} songs; first id=${first.id} uniqueId=${first.uniqueId}`);
  });

  test('the editor covers every field in the musicinfo corpus', async () => {
    const mi = await openJson<MusicInfoFile>('musicinfo.bin');
    const supported = new Set<string>(['id', 'uniqueId', 'genreNo', ...MUSICINFO_SUPPORTED_FIELDS]);
    const actual = new Set(mi.items.flatMap((item) => Object.keys(item)));
    // Every field the dump uses must be modelled by the editor (no unknowns) and,
    // for the shipped corpora, every modelled field is exercised — so the sets match.
    expect(actual).toEqual(supported);
    expect(supported.size).toBe(55);
  });

  test('music_order.bin decodes to MusicOrderFile with items array', async () => {
    const mo = await openJson<MusicOrderFile>('music_order.bin');
    expect(Array.isArray(mo.items)).toBe(true);
    expect(mo.items.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`music_order: ${mo.items.length} entries`);
  });

  test.skipIf(!HAS_CORPUS)('wordlist.bin decodes to WordListFile with items array', async () => {
    const wl = await openJson<WordListFile>('wordlist.bin');
    expect(Array.isArray(wl.items)).toBe(true);
    expect(wl.items.length).toBeGreaterThan(0);
    const first = wl.items[0];
    expect(typeof first.key).toBe('string');
    // eslint-disable-next-line no-console
    console.log(`wordlist: ${wl.items.length} entries; first key=${first.key}`);
  });

  // A wordlist key identifies a row: everything in the editor — the save diff,
  // title/subtitle edits, the song-list join — looks rows up by key, so a
  // repeated key is unreachable data that reads as a phantom edit. JPN 39.06
  // shipped three `aoharu_*` keys twice (the second copy blank); those stray
  // rows were removed from the dump. Guard the invariant for future dumps.
  test('wordlist keys are unique', async () => {
    const wl = await openJson<WordListFile>('wordlist.bin');
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const item of wl.items) {
      if (seen.has(item.key)) dupes.push(item.key);
      seen.add(item.key);
    }
    expect(dupes).toEqual([]);
  });

  test('music_order references only uniqueIds that exist in musicinfo', async () => {
    const mi = await openJson<MusicInfoFile>('musicinfo.bin');
    const mo = await openJson<MusicOrderFile>('music_order.bin');
    const miIds = new Set(mi.items.map((i) => i.uniqueId));
    const moIds = new Set(mo.items.map((i) => i.uniqueId));
    const orphans = [...moIds].filter((id) => !miIds.has(id));
    expect(orphans).toEqual([]);
  });

  test('musicinfo: parse → stringify → parse gives equal structure', async () => {
    const mi = await openJson<MusicInfoFile>('musicinfo.bin');
    const round = JSON.parse(JSON.stringify(mi));
    expect(round.items.length).toBe(mi.items.length);
    expect(round.items[0]).toEqual(mi.items[0]);
  });
});
