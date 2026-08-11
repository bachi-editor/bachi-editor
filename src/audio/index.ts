// Public surface of the v2 audio service (PLAN 6.6).
export { soundbankPlayer, soundCacheKey } from './soundbankPlayer';
export type { LoadedSound, PlayerState, PlayerStatus } from './soundbankPlayer';
export { decodeBankToPcm, BankDecodeError } from './decodeBank';
export type { DecodedBank, BankLoop, DecodeBankOptions } from './decodeBank';
export { computePeaks } from './waveform';
export type { WaveformPeaks } from './waveform';
export { computeCurrentTime, clamp } from './transport';
export type { TransportAnchor } from './transport';
export { runDecodeJob } from './decodeJob';
export type { DecodeJobResult, DecodeRequest } from './decodeJob';
export { decodeAudioFile, floatToPcm16, normalizeAudioForGame, resampleLinear } from './audioImport';
export type { DecodedAudioData, GamePcmData } from './audioImport';
export { encodeImportedSound } from './encodeService';
export type { EncodeJobInput, EncodeJobResult } from './encodeJob';
