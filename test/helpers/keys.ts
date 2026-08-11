// The game's decryption keys are NOT stored in this repository — the shipped
// editor takes them from the user at open time, and the production bundle
// contains no key material at all.
//
// Tests need the real keys to decode the real fixture .bin files. They come from
// `.env` (BACHI_DATATABLE_KEY / BACHI_FUMEN_KEY) or, failing that, from their
// canonical home in the TaikoArcadeLoader source outside this repo. Resolution
// lives in ./resources; this module is the stable import path for the suites.
//
// When no keys are available both constants are the empty string. Guard the
// suite with `describe.skipIf(!HAS_KEYS)` rather than using them unchecked.

export { DATATABLE_KEY_HEX, FUMEN_KEY_HEX, HAS_KEYS } from './resources';
