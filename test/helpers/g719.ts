// The G.719 decoder/encoder wasm modules are user-supplied development artifacts:
// never committed, never bundled. Tests read them from `vendor/g719/` (gitignored)
// or the corpus checkout — see ./resources for resolution.
//
// Guard suites with `describe.skipIf(!HAS_G719_DECODER)` before calling these.

import { readFile } from 'node:fs/promises';
import { G719_DECODER_WASM, G719_ENCODER_WASM } from './resources';

export { HAS_G719_DECODER, HAS_G719_ENCODER } from './resources';

let cached: Uint8Array | undefined;
let cachedEncoder: Uint8Array | undefined;

/** Tests opt into the development decoder artifact; production never imports it. */
export async function loadTestG719Wasm(): Promise<Uint8Array> {
  if (!cached) {
    const file = await readFile(G719_DECODER_WASM);
    cached = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  }
  return cached;
}

/** Tests opt into the development encoder artifact; production never imports it. */
export async function loadTestG719EncoderWasm(): Promise<Uint8Array> {
  if (!cachedEncoder) {
    const file = await readFile(G719_ENCODER_WASM);
    cachedEncoder = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  }
  return cachedEncoder;
}
