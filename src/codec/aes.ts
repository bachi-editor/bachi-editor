// AES-256-CBC + PKCS7 with 16-byte IV prepended to ciphertext.
//
// Matches the scheme used by:
//   - resources/TaikoArcadeLoader-Refactor/src/patches/layeredfs.cpp (encrypt path)
//   - resources/nijiiro-toolset-main/encryption.py (decrypt + encrypt path)
//
// File layout on disk:
//   [0..16)  IV  (16 bytes)
//   [16..N)  PKCS7-padded ciphertext, AES-256-CBC
//
// The deterministic IV used by the loader's encrypt path is [0, 1, ..., 15].
// We preserve whatever IV is present in source files when round-tripping.

import { hexToBytes } from './keys';

const IV_LENGTH = 16;

export const LOADER_DETERMINISTIC_IV = new Uint8Array(IV_LENGTH).map((_, i) => i);

export interface DecryptResult {
  plaintext: Uint8Array;
  iv: Uint8Array;
}

/** Coerce a Uint8Array into a BufferSource that WebCrypto accepts even when
 *  the source view is backed by ArrayBufferLike (vs strict ArrayBuffer). */
function asBufferSource(u: Uint8Array): BufferSource {
  return u as unknown as BufferSource;
}

async function importKey(keyHex: string): Promise<CryptoKey> {
  const raw = hexToBytes(keyHex);
  if (raw.length !== 32) throw new Error(`AES-256 key must be 32 bytes, got ${raw.length}`);
  return crypto.subtle.importKey('raw', asBufferSource(raw), { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
}

export async function aesDecrypt(ciphertextWithIv: Uint8Array, keyHex: string): Promise<DecryptResult> {
  if (ciphertextWithIv.length < IV_LENGTH + 16) {
    throw new Error(`ciphertext too short: ${ciphertextWithIv.length} bytes`);
  }
  const iv = ciphertextWithIv.slice(0, IV_LENGTH);
  const body = ciphertextWithIv.slice(IV_LENGTH);
  const key = await importKey(keyHex);
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: asBufferSource(iv) }, key, asBufferSource(body));
  return { plaintext: new Uint8Array(plain), iv };
}

export async function aesEncrypt(
  plaintext: Uint8Array,
  keyHex: string,
  iv: Uint8Array = LOADER_DETERMINISTIC_IV,
): Promise<Uint8Array> {
  if (iv.length !== IV_LENGTH) throw new Error(`IV must be ${IV_LENGTH} bytes, got ${iv.length}`);
  const key = await importKey(keyHex);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CBC', iv: asBufferSource(iv) }, key, asBufferSource(plaintext)),
  );
  const out = new Uint8Array(IV_LENGTH + ct.length);
  out.set(iv, 0);
  out.set(ct, IV_LENGTH);
  return out;
}
