import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import {
  G719Decoder,
  G719Encoder,
  G719_SAMPLES_PER_FRAME,
  validateG719EncoderWasm,
} from '../../src/codec';
import { loadTestG719EncoderWasm, loadTestG719Wasm } from '../helpers/g719';

function sineFrame(): Int16Array {
  return Int16Array.from({ length: G719_SAMPLES_PER_FRAME }, (_, i) =>
    Math.round(12_000 * Math.sin(2 * Math.PI * 440 * i / 48_000)));
}

describe('user-supplied G.719 encoder', () => {
  test('accepts the compatible development module', async () => {
    await expect(validateG719EncoderWasm(await loadTestG719EncoderWasm())).resolves.toBeUndefined();
  });

  test('rejects corrupt bytes and modules without the encoder ABI', async () => {
    await expect(validateG719EncoderWasm(new Uint8Array([0x00, 0x61]))).rejects.toThrow();
    const emptyModule = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
    await expect(validateG719EncoderWasm(emptyModule)).rejects.toThrow('required memory export');
  });

  test('rejects encoder modules with an unexpected host import', async () => {
    const bytes = (await loadTestG719EncoderWasm()).slice();
    const name = [0x6c, 0x6f, 0x67, 0x31, 0x30]; // log10
    const offset = bytes.findIndex((_, index) => name.every((byte, i) => bytes[index + i] === byte));
    expect(offset).toBeGreaterThan(0);
    bytes[offset + 4] = 0x31; // log11, same byte length so the module remains valid
    await expect(validateG719EncoderWasm(bytes)).rejects.toThrow('env.log10');
  });

  test('matches the reference-wrapper golden frame and decodes successfully', async () => {
    const encoder = await G719Encoder.create(await loadTestG719EncoderWasm(), 1, 320);
    const encoded = Uint8Array.from(encoder.encodeFrame(0, sineFrame()));
    encoder.dispose();

    expect(encoded).toHaveLength(320);
    // Packed output was independently generated with the official native
    // floating-point encoder from the same 960 PCM16 samples.
    expect(createHash('sha256').update(encoded).digest('hex'))
      .toBe('7c9e7ef0a0a1a16e30aaace0035832803b2ea47368e2df8b3e66e8a235652f06');

    const decoder = await G719Decoder.create(await loadTestG719Wasm(), 1, 320);
    const decoded = Int16Array.from(decoder.decodeFrame(0, encoded));
    decoder.dispose();
    expect(decoded.some((sample) => sample !== 0)).toBe(true);
    expect(Math.max(...decoded.map(Math.abs))).toBeLessThanOrEqual(32_768);
  });

  test('reset restores deterministic channel state', async () => {
    const encoder = await G719Encoder.create(await loadTestG719EncoderWasm(), 1, 320);
    const input = sineFrame();
    const first = Uint8Array.from(encoder.encodeFrame(0, input));
    encoder.encodeFrame(0, input);
    encoder.reset();
    const reset = Uint8Array.from(encoder.encodeFrame(0, input));
    encoder.dispose();
    expect(reset).toEqual(first);
  });
});
