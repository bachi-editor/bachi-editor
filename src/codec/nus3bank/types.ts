export type Nus3StreamKind = 'bnsf' | 'idsp' | 'riff' | 'ogg' | 'opus' | 'unknown';

export interface Nus3Section {
  /** FourCC, preserving spaces such as "GRP ". */
  id: string;
  /** Absolute offset of the section FourCC. */
  offset: number;
  /** Absolute offset of the section payload, after FourCC + u32 size. */
  dataOffset: number;
  /** Payload byte length. */
  size: number;
}

export interface Nus3Bank {
  byteLength: number;
  /** Raw NUS3 size field; most CHN banks set this to `byteLength - 8`. */
  declaredSize: number;
  sections: Nus3Section[];
  tones: Nus3Tone[];
  warnings: string[];
}

export interface Nus3Tone {
  index: number;
  /** First u32le in the tone record. Usually matches a local cue/tone id. */
  toneId?: number;
  /** Absolute offset of this tone record payload. */
  recordOffset: number;
  recordSize: number;
  name?: string;
  /**
   * Taiko song-select demo start, in milliseconds from the audio start.
   * Stored in the TONE record immediately before the stream-info sentinel.
   */
  demoStartMs?: number;
  /** Raw signed little-endian value at `demoStartOffset`; corpus songs use >= 0. */
  demoStartRaw?: number;
  /** Absolute file offset of the writable demo-start field, when present. */
  demoStartOffset?: number;
  packOffset?: number;
  /** Absolute file offset of the writable PACK-relative offset field. */
  packOffsetFieldOffset?: number;
  packSize?: number;
  /** Absolute file offset of the writable embedded-stream size field. */
  packSizeFieldOffset?: number;
  stream?: Nus3Stream;
  noStreamReason?: string;
}

export interface Nus3ToneSelection {
  tone: Nus3Tone;
  stream: Nus3Stream;
  alternates: Nus3Tone[];
  reason: 'single' | 'name-match' | 'largest-idsp' | 'largest-stream';
  ambiguous: boolean;
}

export interface Nus3Stream {
  kind: Nus3StreamKind;
  /** FourCC at the referenced PACK offset. */
  magic: string;
  /** Offset relative to the PACK payload. */
  packOffset: number;
  /** Absolute file offset of the embedded stream. */
  absoluteOffset: number;
  size: number;
  metadata?: Nus3StreamMetadata;
}

export type Nus3StreamMetadata = BnsfMetadata | IdspMetadata | RiffWaveMetadata;

export interface BnsfMetadata {
  format: 'BNSF';
  declaredSize: number;
  codec: string;
  formatChunk: string;
  formatChunkSize: number;
  flags: number;
  channels: number;
  sampleRate: number;
  sampleCount: number;
  loopAdjust: number;
  blockSize: number;
  blockSamples: number;
  dataChunk?: string;
  /** Absolute file offset of the BNSF sample-data payload. */
  dataOffset?: number;
  dataSize?: number;
  loopStart?: number;
  loopEnd?: number;
}

export type DecoderReadiness = 'ready' | 'browser-native' | 'unsupported';

export interface Nus3DecoderDecision {
  readiness: DecoderReadiness;
  decoder: 'g719-wasm' | 'idsp-typescript' | 'browser-native' | 'unsupported';
  codec: string;
  reason: string;
}

export interface IdspMetadata {
  format: 'IDSP';
  channels: number;
  sampleRate: number;
  sampleCount: number;
  channelHeaderOffset?: number;
  channelHeaderSize?: number;
  dataOffset?: number;
  channelDataSize?: number;
  channelHeaders?: IdspChannelHeader[];
}

export interface IdspChannelHeader {
  index: number;
  headerOffset: number;
  sampleCount: number;
  nibbleCount: number;
  sampleRate: number;
  loopFlag: number;
  format: number;
  loopStartNibble: number;
  loopEndNibble: number;
  currentAddress: number;
  coefficients: number[];
  gain: number;
  initialPredictorScale: number;
  initialHistory1: number;
  initialHistory2: number;
  loopPredictorScale: number;
  loopHistory1: number;
  loopHistory2: number;
}

export interface RiffWaveMetadata {
  format: 'RIFF';
  waveFormat: number;
  channels: number;
  sampleRate: number;
  bitsPerSample?: number;
}

export class Nus3ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Nus3ParseError';
  }
}
