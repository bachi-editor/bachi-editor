import { getBnsfFrameLayout, getBnsfFrameRange } from './bnsf';
import { G719Decoder, G719_SAMPLES_PER_FRAME } from './g719Decoder';
import { Nus3ParseError, Nus3Stream } from './types';

export interface BnsfDecodeOptions {
  /** Decode only the first N samples per channel. Omit for full stream decode. */
  maxSamples?: number;
  /** User-supplied compatible G.719 decoder module. Never bundled by Bachi. */
  g719Wasm?: Uint8Array;
}

export interface DecodedBnsfPcm {
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
  channelData: Float32Array[];
  durationSeconds: number;
}

/**
 * Decode a BNSF/IS22 (G.719/Siren22) stream to planar Float32 PCM via the
 * wasm G.719 decoder. The stream is laid out as interleaved per-channel frames
 * of `blockSize / channels` bytes, each decoding to 960 samples; channels are
 * decoded independently in block order because the codec carries overlap-add
 * state per channel. Mirrors `decodeIdspToPcm` for the IDSP minority.
 */
export async function decodeBnsfToPcm(
  bankBytes: Uint8Array,
  stream: Nus3Stream,
  opts: BnsfDecodeOptions = {},
): Promise<DecodedBnsfPcm> {
  if (!opts.g719Wasm) {
    throw new Error('G.719 decoder WASM is not configured. Add it in Settings to enable BNSF playback.');
  }
  const layout = getBnsfFrameLayout(stream);
  if (layout.blockSamples !== G719_SAMPLES_PER_FRAME) {
    throw new Nus3ParseError(
      `BNSF block declares ${layout.blockSamples} samples; the G.719 decoder emits ${G719_SAMPLES_PER_FRAME}`,
    );
  }

  const samplesPerChannel = Math.min(opts.maxSamples ?? layout.sampleCount, layout.sampleCount);
  const decoder = await G719Decoder.create(opts.g719Wasm, layout.channels, layout.frameSizePerChannel);
  try {
    const channelData: Float32Array[] = [];
    for (let channel = 0; channel < layout.channels; channel++) {
      const pcm = new Float32Array(samplesPerChannel);
      let written = 0;
      for (let block = 0; block < layout.blockCount && written < samplesPerChannel; block++) {
        const range = getBnsfFrameRange(layout, block, channel);
        const frame = bankBytes.subarray(range.offset, range.offset + range.size);
        const samples = decoder.decodeFrame(channel, frame);
        const count = Math.min(G719_SAMPLES_PER_FRAME, samplesPerChannel - written);
        for (let i = 0; i < count; i++) pcm[written + i] = samples[i] / 32768;
        written += count;
      }
      channelData.push(pcm);
    }
    return {
      sampleRate: layout.sampleRate,
      channels: layout.channels,
      samplesPerChannel,
      channelData,
      durationSeconds: samplesPerChannel / layout.sampleRate,
    };
  } finally {
    decoder.dispose();
  }
}
