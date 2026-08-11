import { describe, expect, test } from 'vitest';
import { aesDecrypt, aesEncrypt, LOADER_DETERMINISTIC_IV } from '../../src/codec/aes';
import { gunzip, gzip } from '../../src/codec/gzip';
import { hexToBytes } from '../../src/codec/keys';
import { DATATABLE_KEY_HEX, FUMEN_KEY_HEX } from '../helpers/keys';

describe('hexToBytes', () => {
  test('decodes the CHN datatable key to 32 bytes', () => {
    const k = hexToBytes(DATATABLE_KEY_HEX);
    expect(k.length).toBe(32);
  });

  test('decodes the CHN fumen key to 32 bytes', () => {
    const k = hexToBytes(FUMEN_KEY_HEX);
    expect(k.length).toBe(32);
  });

  test('rejects odd-length hex', () => {
    expect(() => hexToBytes('abc')).toThrow();
  });
});

describe('AES-256-CBC round-trip', () => {
  test('encrypt then decrypt recovers plaintext (deterministic IV)', async () => {
    const plaintext = new TextEncoder().encode('hello taiko');
    const sealed = await aesEncrypt(plaintext, DATATABLE_KEY_HEX, LOADER_DETERMINISTIC_IV);
    expect(sealed.slice(0, 16)).toEqual(LOADER_DETERMINISTIC_IV);
    const { plaintext: recovered, iv } = await aesDecrypt(sealed, DATATABLE_KEY_HEX);
    expect(iv).toEqual(LOADER_DETERMINISTIC_IV);
    expect(new TextDecoder().decode(recovered)).toBe('hello taiko');
  });

  test('encrypt is deterministic for the same key+iv+plaintext', async () => {
    const plaintext = new TextEncoder().encode('round-trip stability check');
    const a = await aesEncrypt(plaintext, FUMEN_KEY_HEX);
    const b = await aesEncrypt(plaintext, FUMEN_KEY_HEX);
    expect(a).toEqual(b);
  });

  test('preserves a non-deterministic IV when round-tripped', async () => {
    const plaintext = new TextEncoder().encode('arbitrary');
    const iv = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 15, 14, 13, 12, 11, 10]);
    const sealed = await aesEncrypt(plaintext, DATATABLE_KEY_HEX, iv);
    const { iv: readBack } = await aesDecrypt(sealed, DATATABLE_KEY_HEX);
    expect(readBack).toEqual(iv);
  });
});

describe('gzip round-trip', () => {
  test('gunzip(gzip(x)) === x', async () => {
    const original = new TextEncoder().encode(
      JSON.stringify({ items: Array.from({ length: 256 }, (_, i) => ({ id: i, name: `song_${i}` })) }),
    );
    const compressed = await gzip(original);
    expect(compressed[0]).toBe(0x1f); // gzip magic
    expect(compressed[1]).toBe(0x8b);
    const restored = await gunzip(compressed);
    expect(restored).toEqual(original);
  });

  test('handles empty input', async () => {
    const compressed = await gzip(new Uint8Array(0));
    const restored = await gunzip(compressed);
    expect(restored.length).toBe(0);
  });
});
