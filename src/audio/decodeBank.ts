// Bank → PCM pipeline for v2 audio (PLAN 6.6). Glues the read-only nus3bank
// codec layer (parse → tone selection → decoder decision → stream decode) into
// a single call that returns planar Float32 PCM plus the metadata the Sound tab
// needs. This module is pure and runs unchanged on the main thread, in the
// decode worker, and under the Node test runner.

import {
  decideNus3Decoder,
  decodeBnsfToPcm,
  decodeIdspToPcm,
  parseNus3Bank,
  selectPlayableTone,
  type Nus3Stream,
} from '../codec';

/** Thrown when a bank parses but carries no stream we can decode in-browser. */
export class BankDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BankDecodeError';
  }
}

/** Loop bounds in samples-per-channel, surfaced for display (PLAN 6.5). */
export interface BankLoop {
  startSample: number;
  endSample: number;
}

export interface DecodedBank {
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
  durationSeconds: number;
  /** Planar PCM, one Float32Array per channel, samples normalised to [-1, 1]. */
  channelData: Float32Array[];
  /** Human-readable codec label, e.g. "BNSF/IS22 (G.719/Siren22)". */
  codec: string;
  /** Selected tone name, when the bank named it. */
  toneName?: string;
  /** Best-effort loop region for display; absent when not declared. */
  loop?: BankLoop;
}

export interface DecodeBankOptions {
  /** Decode only the first N samples per channel. Omit for the full stream. */
  maxSamples?: number;
  /** User-provided G.719 decoder bytes for BNSF/IS22 streams. */
  g719Wasm?: Uint8Array;
}

function bnsfLoop(stream: Nus3Stream): BankLoop | undefined {
  const meta = stream.metadata?.format === 'BNSF' ? stream.metadata : undefined;
  if (!meta) return undefined;
  if (meta.loopStart != null && meta.loopEnd != null && meta.loopEnd > meta.loopStart) {
    return { startSample: meta.loopStart, endSample: meta.loopEnd };
  }
  return undefined;
}

/**
 * Decode a `.nus3bank`'s playable tone to planar Float32 PCM. Routes to the
 * wasm G.719 decoder for BNSF/IS22 (the 1,037-bank majority) and the TypeScript
 * DSP-ADPCM decoder for IDSP (the 7-bank minority); anything else throws a
 * typed {@link BankDecodeError} carrying the decoder-decision reason so the UI
 * can show why playback is unavailable without crashing replace/remove.
 */
export async function decodeBankToPcm(
  bankBytes: Uint8Array,
  preferredStem?: string,
  opts: DecodeBankOptions = {},
): Promise<DecodedBank> {
  const bank = parseNus3Bank(bankBytes);
  const selection = selectPlayableTone(bank, preferredStem);
  if (!selection) {
    throw new BankDecodeError('This sound bank has no playable audio tone.');
  }

  const { stream, tone } = selection;
  const decision = decideNus3Decoder(stream);

  if (decision.decoder === 'g719-wasm') {
    const pcm = await decodeBnsfToPcm(bankBytes, stream, {
      maxSamples: opts.maxSamples,
      g719Wasm: opts.g719Wasm,
    });
    return { ...pcm, codec: decision.codec, toneName: tone.name, loop: bnsfLoop(stream) };
  }

  if (decision.decoder === 'idsp-typescript') {
    const pcm = decodeIdspToPcm(bankBytes, stream, { maxSamples: opts.maxSamples });
    // IDSP loop bounds live in nibble units; we leave them unmapped for now
    // rather than risk an off-by-one in display metadata (PLAN 6.5).
    return { ...pcm, codec: decision.codec, toneName: tone.name };
  }

  throw new BankDecodeError(
    decision.reason || `Unsupported audio codec ${decision.codec}; playback is unavailable.`,
  );
}
