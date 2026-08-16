import { File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createNus3BankFromTemplate, type MusicInfoItem } from '../../src/codec';
import type { ProjectRoot } from '../../src/fs/project';
import {
  allocateNus3BankId,
  loadSoundFileInfo,
  nextAvailableNus3BankId,
  removeSoundFile,
  replaceSoundFile,
  resolveSoundFile,
} from '../../src/fs/sound';

const TEMPLATE_PATH = resolve(__dirname, '../../src/assets/song-template.nus3bank');

Object.defineProperties(globalThis, {
  crypto: { value: webcrypto },
  File: { value: NodeFile },
});

class MemFile {
  readonly kind = 'file' as const;

  constructor(
    readonly name: string,
    public bytes: Uint8Array,
    private readonly lastModified = 1_700_000_000_000,
  ) {}

  async getFile(): Promise<File> {
    const copy = this.bytes.slice();
    const buffer = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) as ArrayBuffer;
    return new File([buffer], this.name, { lastModified: this.lastModified });
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const self = this;
    const parts: Uint8Array[] = [];
    return {
      async write(chunk: FileSystemWriteChunkType) {
        if (chunk instanceof Uint8Array) parts.push(chunk);
        else if (chunk instanceof ArrayBuffer) parts.push(new Uint8Array(chunk));
        else if (ArrayBuffer.isView(chunk)) parts.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
        else if (typeof chunk === 'string') parts.push(new TextEncoder().encode(chunk));
        else if (chunk instanceof Blob) parts.push(new Uint8Array(await chunk.arrayBuffer()));
        else throw new TypeError('unsupported chunk');
      },
      async close() {
        const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
        const out = new Uint8Array(total);
        let offset = 0;
        for (const part of parts) {
          out.set(part, offset);
          offset += part.byteLength;
        }
        self.bytes = out;
      },
      async abort() {},
      async seek() {},
      async truncate() {},
    } as unknown as FileSystemWritableFileStream;
  }
}

class MemDir {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, MemFile>();

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MemFile> {
    const existing = this.children.get(name);
    if (existing) return existing;
    if (!opts?.create) throw new DOMException(`no file ${name}`, 'NotFoundError');
    const file = new MemFile(name, new Uint8Array());
    this.children.set(name, file);
    return file;
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.children.delete(name)) throw new DOMException(`no entry ${name}`, 'NotFoundError');
  }
}

class WriteOnlyDir {
  readonly kind = 'directory' as const;
  readonly children = new Map<string, MemFile>();

  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<MemFile> {
    const existing = this.children.get(name);
    if (existing) return existing;
    if (!opts?.create) throw new DOMException(`no file ${name}`, 'NotFoundError');
    const file = new MemFile(name, new Uint8Array());
    this.children.set(name, file);
    return file;
  }
}

function song(overrides: Partial<MusicInfoItem> = {}): MusicInfoItem {
  return { uniqueId: 1, id: 'abc', ...overrides };
}

function rootWithSound(sound: unknown): ProjectRoot {
  return { sound } as unknown as ProjectRoot;
}

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function buffer(...values: number[]): ArrayBuffer {
  const data = bytes(...values);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

function fileFromBytes(name: string, ...values: number[]): File {
  return new File([buffer(...values)], name);
}

async function templateBytes(): Promise<Uint8Array> {
  const file = await readFile(TEMPLATE_PATH);
  return new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
}

async function bankWithId(songId: string, bankId: number): Promise<Uint8Array> {
  return createNus3BankFromTemplate(await templateBytes(), {
    songId,
    uniqueId: 1,
    bankId,
    demoStartMs: 0,
    streamBytes: Uint8Array.of(1, 2, 3, 4),
  });
}

describe('sound file resolution', () => {
  test('uses a declared sound path when present', () => {
    expect(resolveSoundFile(song({ songFileName: ' sound\\nested\\custom.nus3bank ' }))).toEqual({
      filename: 'custom.nus3bank',
      displayPath: 'sound/custom.nus3bank',
      declaration: 'sound/nested/custom',
      declared: true,
    });
  });

  test('falls back to the song id convention without a declaration', () => {
    expect(resolveSoundFile(song())).toEqual({
      filename: 'song_abc.nus3bank',
      displayPath: 'sound/song_abc.nus3bank',
      declaration: 'sound/song_abc',
      declared: false,
    });
  });
});

describe('sound file inspection', () => {
  test('reports missing files without hashing', async () => {
    const sound = new MemDir();

    await expect(loadSoundFileInfo(rootWithSound(sound), song())).resolves.toEqual({
      resolved: resolveSoundFile(song()),
      exists: false,
      size: 0,
    });
  });

  test('reports size, modified time, and a short sha256 for present files', async () => {
    const sound = new MemDir();
    sound.children.set('song_abc.nus3bank', new MemFile('song_abc.nus3bank', bytes(1, 2, 3), 1234));

    await expect(loadSoundFileInfo(rootWithSound(sound), song())).resolves.toMatchObject({
      exists: true,
      size: 3,
      modified: 1234,
      sha256: '039058c6f2c0',
    });
  });
});

describe('nus3bank id allocation', () => {
  test('uses the fallback for an empty project and otherwise advances past the maximum', () => {
    expect(nextAvailableNus3BankId([], 77)).toBe(77);
    expect(nextAvailableNus3BankId([0, 3, 4_100, 12], 77)).toBe(4_101);
    expect(nextAvailableNus3BankId([0xffff_ffff, 2, 0], 77)).toBe(1);
  });

  test('reads only bank prefixes, ignores unreadable files, and allocates a collision-free u32 id', async () => {
    const sound = new MemDir();
    sound.children.set('song_a.nus3bank', new MemFile('song_a.nus3bank', await bankWithId('a', 12)));
    sound.children.set('song_b.nus3bank', new MemFile('song_b.nus3bank', await bankWithId('b', 0xfedc_ba98)));
    sound.children.set('broken.nus3bank', new MemFile('broken.nus3bank', bytes(1, 2, 3)));
    sound.children.set('readme.txt', new MemFile('readme.txt', bytes(9)));

    await expect(allocateNus3BankId(
      rootWithSound(sound),
      ['song_a.nus3bank', 'song_b.nus3bank', 'broken.nus3bank', 'readme.txt'],
      77,
    )).resolves.toBe(0xfedc_ba99);
  });
});

describe('sound file writes', () => {
  test('replaces an existing bank without creating sidecar files', async () => {
    const sound = new MemDir();
    sound.children.set('song_abc.nus3bank', new MemFile('song_abc.nus3bank', bytes(1, 2, 3)));

    const result = await replaceSoundFile(
      rootWithSound(sound),
      song(),
      fileFromBytes('replacement.nus3bank', 9, 8),
    );

    expect(result).toEqual({
      filename: 'song_abc.nus3bank',
      byteDelta: -1,
    });
    expect(sound.children.get('song_abc.nus3bank')?.bytes).toEqual(bytes(9, 8));
    expect([...sound.children.keys()]).toEqual(['song_abc.nus3bank']);
  });

  test('creates a new bank as the only file when none exists', async () => {
    const sound = new MemDir();

    const result = await replaceSoundFile(rootWithSound(sound), song(), fileFromBytes('new.nus3bank', 4, 5, 6, 7));

    expect(result).toEqual({
      filename: 'song_abc.nus3bank',
      byteDelta: 4,
    });
    expect(sound.children.get('song_abc.nus3bank')?.bytes).toEqual(bytes(4, 5, 6, 7));
    expect([...sound.children.keys()]).toEqual(['song_abc.nus3bank']);
  });

  test('removes an existing bank without leaving extra files', async () => {
    const sound = new MemDir();
    sound.children.set('song_abc.nus3bank', new MemFile('song_abc.nus3bank', bytes(7, 7, 7)));

    const result = await removeSoundFile(rootWithSound(sound), song());

    expect(result).toEqual({
      filename: 'song_abc.nus3bank',
      byteDelta: -3,
    });
    expect(sound.children.has('song_abc.nus3bank')).toBe(false);
    expect([...sound.children.keys()]).toEqual([]);
  });

  test('fails remove when the bank does not exist', async () => {
    await expect(removeSoundFile(rootWithSound(new MemDir()), song()))
      .rejects.toThrow('sound/song_abc.nus3bank does not exist on disk.');
  });

  test('leaves the target untouched when the directory cannot remove entries', async () => {
    const sound = new WriteOnlyDir();
    sound.children.set('song_abc.nus3bank', new MemFile('song_abc.nus3bank', bytes(5)));

    await expect(removeSoundFile(rootWithSound(sound), song()))
      .rejects.toThrow('This folder cannot remove song_abc.nus3bank.');
    expect([...sound.children.keys()]).toEqual(['song_abc.nus3bank']);
    expect(sound.children.get('song_abc.nus3bank')?.bytes).toEqual(bytes(5));
  });
});
