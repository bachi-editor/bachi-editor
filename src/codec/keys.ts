// AES-256 key helpers for Taiko no Tatsujin Nijiiro CHN.
//
// The actual key VALUES are deliberately NOT stored in this app. The editor
// receives them from the user at open time (see Settings' "Open Project"
// flow); their canonical source is the TaikoArcadeLoader
// (resources/TaikoArcadeLoader-Refactor/src/patches/layeredfs.cpp), outside app/.
// A 64-hex-char string decodes to 32 bytes => AES-256.

/** A well-formed AES-256 key: exactly 64 hexadecimal characters (32 bytes). */
export function isValidKeyHex(hex: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(hex.trim());
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`hex length must be even: got ${hex.length}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error(`invalid hex at offset ${i * 2}: ${hex.slice(i * 2, i * 2 + 2)}`);
    out[i] = byte;
  }
  return out;
}
