import { describe, expect, test } from 'vitest';
import { validateG719Wasm } from '../../src/codec';
import { loadTestG719Wasm } from '../helpers/g719';

describe('user-supplied G.719 decoder validation', () => {
  test('accepts the compatible development module', async () => {
    await expect(validateG719Wasm(await loadTestG719Wasm())).resolves.toBeUndefined();
  });

  test('rejects corrupt bytes', async () => {
    await expect(validateG719Wasm(new Uint8Array([0x00, 0x61]))).rejects.toThrow();
  });

  test('rejects a valid wasm module without the decoder exports', async () => {
    const emptyModule = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    await expect(validateG719Wasm(emptyModule)).rejects.toThrow('required memory export');
  });
});
