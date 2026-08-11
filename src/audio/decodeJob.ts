// The decode unit of work shared by the main-thread fallback and the decode
// worker (PLAN 6.6). Kept free of `self`/`postMessage` so it is unit-testable
// in Node and reusable when Worker is unavailable.

import { decodeBankToPcm, type BankLoop, type DecodeBankOptions } from './decodeBank';
import { computePeaks, type WaveformPeaks } from './waveform';

export interface DecodeRequest {
  bankBytes: Uint8Array;
  /** User-provided decoder bytes; required only for BNSF/IS22 streams. */
  g719Wasm?: Uint8Array;
  /** Resolved sound-file stem (e.g. "song_kumatm") for tone selection. */
  preferredStem?: string;
  /** Buckets for the waveform envelope. */
  peakBuckets: number;
  /** Optional decode cap (samples per channel) for prefix decodes/tests. */
  maxSamples?: number;
}

export interface DecodeJobResult {
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
  durationSeconds: number;
  codec: string;
  toneName?: string;
  loop?: BankLoop;
  channelData: Float32Array[];
  peaks: WaveformPeaks;
}

/** Decode a bank to PCM and compute its waveform envelope in one pass. */
export async function runDecodeJob(req: DecodeRequest): Promise<DecodeJobResult> {
  const opts: DecodeBankOptions = { maxSamples: req.maxSamples, g719Wasm: req.g719Wasm };
  const decoded = await decodeBankToPcm(req.bankBytes, req.preferredStem, opts);
  const peaks = computePeaks(decoded.channelData, req.peakBuckets);
  return { ...decoded, peaks };
}
