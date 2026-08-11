// The "envelope" used by Taiko CHN datatable and fumen files:
//   on disk:    [ AES-256-CBC( gzip( payload ) ) ]   with IV in first 16 bytes
//   round-trip: file -> aes decrypt -> gunzip -> payload bytes
//                payload -> gzip -> aes encrypt -> file
//
// `payload` is JSON-text for datatables, and a custom binary structure for fumens.

import { aesDecrypt, aesEncrypt, LOADER_DETERMINISTIC_IV } from './aes';
import { gunzip, gzip } from './gzip';

export interface EnvelopeOpenResult {
  payload: Uint8Array;
  iv: Uint8Array;
}

export async function openEnvelope(fileBytes: Uint8Array, keyHex: string): Promise<EnvelopeOpenResult> {
  const { plaintext, iv } = await aesDecrypt(fileBytes, keyHex);
  const payload = await gunzip(plaintext);
  return { payload, iv };
}

export async function sealEnvelope(
  payload: Uint8Array,
  keyHex: string,
  iv: Uint8Array = LOADER_DETERMINISTIC_IV,
): Promise<Uint8Array> {
  const compressed = await gzip(payload);
  return aesEncrypt(compressed, keyHex, iv);
}
