import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const WASM_PATH = resolve(__dirname, '../../../resources/g719/g719.wasm');
const ENCODER_WASM_PATH = resolve(__dirname, '../../../resources/g719/g719-encoder.wasm');

let cached: Uint8Array | undefined;
let cachedEncoder: Uint8Array | undefined;

/** Tests opt into the development decoder artifact; production never imports it. */
export async function loadTestG719Wasm(): Promise<Uint8Array> {
  if (!cached) {
    const file = await readFile(WASM_PATH);
    cached = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  }
  return cached;
}

/** Tests opt into the development encoder artifact; production never imports it. */
export async function loadTestG719EncoderWasm(): Promise<Uint8Array> {
  if (!cachedEncoder) {
    const file = await readFile(ENCODER_WASM_PATH);
    cachedEncoder = new Uint8Array(file.buffer, file.byteOffset, file.byteLength);
  }
  return cachedEncoder;
}
