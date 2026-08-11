import { G719Encoder } from './g719Encoder';
import { G719_SAMPLES_PER_FRAME } from './g719Decoder';

export const GAME_AUDIO_SAMPLE_RATE = 48_000;
export const GAME_G719_BYTES_PER_CHANNEL_FRAME = 320;

function ascii(out: Uint8Array, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) out[offset + i] = value.charCodeAt(i);
}

function u16be(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, false);
}

function u32be(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, false);
}

/**
 * Encode 48 kHz planar PCM16 as the IS22/G.719 BNSF layout used by JPN and CHN
 * song banks: 960 samples per block and 320 bytes per channel per block.
 */
export async function encodeG719Bnsf(
  channels: readonly Int16Array[],
  g719Wasm: Uint8Array,
): Promise<Uint8Array> {
  if (channels.length === 0) throw new Error('Cannot encode BNSF without PCM channels.');
  const sampleCount = channels[0].length;
  if (sampleCount === 0) throw new Error('Cannot encode an empty audio stream.');
  if (channels.some((channel) => channel.length !== sampleCount)) {
    throw new Error('Every PCM channel must have the same sample count.');
  }

  const frameCount = Math.ceil(sampleCount / G719_SAMPLES_PER_FRAME);
  const blockSize = GAME_G719_BYTES_PER_CHANNEL_FRAME * channels.length;
  const dataSize = frameCount * blockSize;
  const out = new Uint8Array(48 + dataSize);
  const view = new DataView(out.buffer);

  ascii(out, 0, 'BNSF');
  u32be(view, 4, out.byteLength);
  ascii(out, 8, 'IS22');
  ascii(out, 12, 'sfmt');
  u32be(view, 16, 0x14);
  u16be(view, 20, 0);
  u16be(view, 22, channels.length);
  u32be(view, 24, GAME_AUDIO_SAMPLE_RATE);
  u32be(view, 28, sampleCount);
  u32be(view, 32, 0);
  u16be(view, 36, blockSize);
  u16be(view, 38, G719_SAMPLES_PER_FRAME);
  ascii(out, 40, 'sdat');
  u32be(view, 44, dataSize);

  const encoder = await G719Encoder.create(
    g719Wasm,
    channels.length,
    GAME_G719_BYTES_PER_CHANNEL_FRAME,
  );
  const frame = new Int16Array(G719_SAMPLES_PER_FRAME);
  try {
    for (let block = 0; block < frameCount; block++) {
      const sampleOffset = block * G719_SAMPLES_PER_FRAME;
      const available = Math.min(G719_SAMPLES_PER_FRAME, sampleCount - sampleOffset);
      for (let channel = 0; channel < channels.length; channel++) {
        frame.fill(0);
        frame.set(channels[channel].subarray(sampleOffset, sampleOffset + available));
        const encoded = encoder.encodeFrame(channel, frame);
        const outputOffset = 48 + block * blockSize + channel * GAME_G719_BYTES_PER_CHANNEL_FRAME;
        out.set(encoded, outputOffset);
      }
    }
  } finally {
    encoder.dispose();
  }
  return out;
}
