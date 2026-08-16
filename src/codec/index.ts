// Public surface of the codec layer.
export { openEnvelope, sealEnvelope } from './envelope';
export { isValidKeyHex } from './keys';
export {
  decodeJsonPayload,
  detectJsonTextStyle,
  detectPayloadStyle,
  encodeJsonPayload,
  encodeStyledJsonPayload,
  formatJsonText,
  MINIFIED_JSON_STYLE,
  type JsonTextStyle,
} from './datatable/serde';
export { detectGameVersion, isGameVersion, type GameVersion } from './datatable/gameVersion';
export * from './datatable/types';
export * from './serverdata';
export * from './fumen/types';
export { decodeFumen } from './fumen/decode';
export { encodeFumen, verifyEncoderSelfConsistent } from './fumen/encode';
export { decodeHeader, encodeHeader, makeFumenHeader } from './fumen/header';
export {
  computeScoreCeiling,
  scoreBranchIndex,
  soulGaugeDefaults,
  timingWindowsForDifficulty,
} from './fumen/authoring';
export type { FumenChartDifficulty, SoulGaugeFields } from './fumen/authoring';
export * from './nus3bank/types';
export { isNus3BankBytes, parseNus3Bank, readNus3BankId } from './nus3bank/parse';
export { extractStreamBytes, selectPlayableTone } from './nus3bank/extract';
export { patchNus3BankDemoStartMs, readNus3BankDemoStartMs } from './nus3bank/edit';
export { createNus3BankFromTemplate, replaceNus3BankStream } from './nus3bank/write';
export type { CreateNus3BankOptions } from './nus3bank/write';
export { decideNus3Decoder } from './nus3bank/decoderDecision';
export { getBnsfFrameLayout, getBnsfFrameRange } from './nus3bank/bnsf';
export { getIdspChannelDataRange, getIdspDataLayout } from './nus3bank/idsp';
export { decodeDspAdpcmChannel, decodeIdspToPcm } from './nus3bank/idspDecode';
export { decodeBnsfToPcm } from './nus3bank/bnsfDecode';
export type { BnsfDecodeOptions, DecodedBnsfPcm } from './nus3bank/bnsfDecode';
export { G719Decoder, G719_SAMPLES_PER_FRAME, validateG719Wasm } from './nus3bank/g719Decoder';
export { G719Encoder, validateG719EncoderWasm } from './nus3bank/g719Encoder';
export {
  encodeG719Bnsf,
  GAME_AUDIO_SAMPLE_RATE,
  GAME_G719_BYTES_PER_CHANNEL_FRAME,
} from './nus3bank/bnsfEncode';
