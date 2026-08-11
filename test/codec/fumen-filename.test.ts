import { describe, expect, it } from 'vitest';
import { listSongFumenSlots, parseFumenFilename } from '../../src/fs/fumens';
import type { ProjectRoot } from '../../src/fs/project';

function dir(entries: [string, { kind: 'file' | 'directory' }][]): FileSystemDirectoryHandle {
  return {
    async *[Symbol.asyncIterator]() {
      for (const entry of entries) yield entry;
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe('parseFumenFilename', () => {
  it.each([
    ['10binz_e.bin', { difficulty: 'easy', player: 'single' }],
    ['10binz_n.bin', { difficulty: 'normal', player: 'single' }],
    ['10binz_h.bin', { difficulty: 'hard', player: 'single' }],
    ['10binz_m.bin', { difficulty: 'oni', player: 'single' }],
    ['10binz_x.bin', { difficulty: 'ura', player: 'single' }],
    ['10binz_e_1.bin', { difficulty: 'easy', player: 'p1' }],
    ['10binz_e_2.bin', { difficulty: 'easy', player: 'p2' }],
    ['10binz_m_2.bin', { difficulty: 'oni', player: 'p2' }],
  ])('parses %s', (name, expected) => {
    const slot = parseFumenFilename('10binz', name);
    expect(slot).toMatchObject(expected);
  });

  it.each([
    ['10binz.bin'],
    ['10binz_q.bin'],
    ['10binz_e_3.bin'],
    ['other_e.bin'], // mismatched prefix
    ['10binz_e.json'],
  ])('rejects %s', (name) => {
    expect(parseFumenFilename('10binz', name)).toBeUndefined();
  });

  it('lists valid slots in stable difficulty and player order', async () => {
    const songDir = dir([
      ['10binz_m_2.bin', { kind: 'file' }],
      ['10binz_e.bin', { kind: 'file' }],
      ['10binz_h_1.bin', { kind: 'file' }],
      ['10binz_n.bin', { kind: 'file' }],
      ['10binz_q.bin', { kind: 'file' }],
      ['10binz_x_1.bin', { kind: 'directory' }],
    ]);
    const root = {
      fumen: { getDirectoryHandle: async () => songDir },
    } as unknown as ProjectRoot;

    const slots = await listSongFumenSlots(root, '10binz');

    expect(slots.map((s) => `${s.filename}:${s.difficulty}:${s.player}`)).toEqual([
      '10binz_e.bin:easy:single',
      '10binz_n.bin:normal:single',
      '10binz_h_1.bin:hard:p1',
      '10binz_m_2.bin:oni:p2',
    ]);
  });

  it('returns no slots when the song fumen directory is absent', async () => {
    const root = {
      fumen: { getDirectoryHandle: async () => { throw new DOMException('missing', 'NotFoundError'); } },
    } as unknown as ProjectRoot;

    await expect(listSongFumenSlots(root, 'missing')).resolves.toEqual([]);
  });
});
