import { getIdspChannelDataRange, getIdspDataLayout } from './idsp';
import { IdspChannelHeader, Nus3ParseError, Nus3Stream } from './types';

const SAMPLES_PER_DSP_FRAME = 14;
const BYTES_PER_DSP_FRAME = 8;

export interface IdspDecodeOptions {
  /** Decode only the first N samples per channel. Omit for full stream decode. */
  maxSamples?: number;
}

export interface DecodedIdspPcm {
  sampleRate: number;
  channels: number;
  samplesPerChannel: number;
  channelData: Float32Array[];
  durationSeconds: number;
}

function clip16(n: number): number {
  if (n > 32767) return 32767;
  if (n < -32768) return -32768;
  return n;
}

function signedNibble(n: number): number {
  return n >= 8 ? n - 16 : n;
}

export function decodeDspAdpcmChannel(data: Uint8Array, header: IdspChannelHeader, sampleCount: number): Int16Array {
  const out = new Int16Array(sampleCount);
  let source = 0;
  let outPos = 0;
  let hist1 = header.initialHistory1;
  let hist2 = header.initialHistory2;

  while (outPos < sampleCount) {
    if (source + BYTES_PER_DSP_FRAME > data.byteLength) {
      throw new Nus3ParseError(`DSP ADPCM data ended at sample ${outPos}/${sampleCount}`);
    }
    const predictorScale = data[source++];
    const predictor = predictorScale >> 4;
    const scale = 1 << (predictorScale & 0x0f);
    if (predictor > 7) {
      throw new Nus3ParseError(`DSP ADPCM predictor ${predictor} is outside 0..7`);
    }
    const coef1 = header.coefficients[predictor * 2];
    const coef2 = header.coefficients[predictor * 2 + 1];
    for (let i = 0; i < SAMPLES_PER_DSP_FRAME && outPos < sampleCount; i++) {
      const b = data[source + (i >> 1)];
      const nibble = signedNibble((i & 1) === 0 ? (b >> 4) & 0x0f : b & 0x0f);
      const sample = (((scale * nibble) << 11) + 1024 + coef1 * hist1 + coef2 * hist2) >> 11;
      const finalSample = clip16(sample);
      hist2 = hist1;
      hist1 = finalSample;
      out[outPos++] = finalSample;
    }
    source += 7;
  }

  return out;
}

export function decodeIdspToPcm(bankBytes: Uint8Array, stream: Nus3Stream, opts: IdspDecodeOptions = {}): DecodedIdspPcm {
  const layout = getIdspDataLayout(stream);
  const metadata = stream.metadata?.format === 'IDSP' ? stream.metadata : undefined;
  if (!metadata?.channelHeaders) {
    throw new Nus3ParseError('IDSP stream is missing channel headers');
  }
  const samplesPerChannel = Math.min(opts.maxSamples ?? layout.sampleCount, layout.sampleCount);
  const channelData = metadata.channelHeaders.map((header) => {
    const range = getIdspChannelDataRange(layout, header.index);
    const encoded = bankBytes.subarray(range.offset, range.offset + range.size);
    const pcm16 = decodeDspAdpcmChannel(encoded, header, samplesPerChannel);
    const pcm = new Float32Array(samplesPerChannel);
    for (let i = 0; i < pcm16.length; i++) pcm[i] = pcm16[i] / 32768;
    return pcm;
  });
  return {
    sampleRate: layout.sampleRate,
    channels: layout.channels,
    samplesPerChannel,
    channelData,
    durationSeconds: samplesPerChannel / layout.sampleRate,
  };
}
