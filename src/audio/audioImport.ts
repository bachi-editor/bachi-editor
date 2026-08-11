import { GAME_AUDIO_SAMPLE_RATE } from '../codec';

export interface DecodedAudioData {
  sampleRate: number;
  channelData: Float32Array<ArrayBuffer>[];
}

export interface GamePcmData {
  sampleRate: typeof GAME_AUDIO_SAMPLE_RATE;
  channelData: [Int16Array<ArrayBuffer>, Int16Array<ArrayBuffer>];
  sampleCount: number;
}

type AudioContextCtor = typeof AudioContext;

/** Decode OGG, WAV, MP3, or another browser-supported input container. */
export async function decodeAudioFile(file: File): Promise<DecodedAudioData> {
  const Ctor =
    (typeof window !== 'undefined'
      && (window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext))
    || undefined;
  if (!Ctor) throw new Error('Web Audio is not available in this browser.');
  // decodeAudioData resamples into its context rate. Asking for the game rate
  // uses the browser's native resampler; normalizeAudioForGame remains a
  // deterministic fallback for implementations that return another rate.
  const context = new Ctor({ sampleRate: GAME_AUDIO_SAMPLE_RATE });
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.numberOfChannels < 1 || decoded.length < 1) {
      throw new Error('The decoded audio stream is empty.');
    }
    const channels = Math.min(2, decoded.numberOfChannels);
    return {
      sampleRate: decoded.sampleRate,
      channelData: Array.from({ length: channels }, (_, channel) =>
        Float32Array.from(decoded.getChannelData(channel))),
    };
  } finally {
    await context.close();
  }
}

export function resampleLinear(
  input: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array<ArrayBuffer> {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0 || !Number.isFinite(targetRate) || targetRate <= 0) {
    throw new Error('Audio sample rates must be positive.');
  }
  if (input.length === 0) return new Float32Array(0);
  if (sourceRate === targetRate) return Float32Array.from(input);
  const outputLength = Math.max(1, Math.round(input.length * targetRate / sourceRate));
  const out = new Float32Array(outputLength);
  const scale = sourceRate / targetRate;
  for (let i = 0; i < outputLength; i++) {
    const position = Math.min(input.length - 1, i * scale);
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    out[i] = input[left] + (input[right] - input[left]) * fraction;
  }
  return out;
}

export function floatToPcm16(input: Float32Array): Int16Array<ArrayBuffer> {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const finite = Number.isFinite(input[i]) ? input[i] : 0;
    const clamped = Math.max(-1, Math.min(1, finite));
    out[i] = Math.round(clamped * (clamped < 0 ? 32768 : 32767));
  }
  return out;
}

/** Resample and normalize browser-decoded audio to the game's stereo PCM input. */
export function normalizeAudioForGame(decoded: DecodedAudioData): GamePcmData {
  if (decoded.channelData.length === 0 || decoded.channelData[0].length === 0) {
    throw new Error('The decoded audio stream is empty.');
  }
  const left = floatToPcm16(resampleLinear(
    decoded.channelData[0],
    decoded.sampleRate,
    GAME_AUDIO_SAMPLE_RATE,
  ));
  const right = decoded.channelData[1]
    ? floatToPcm16(resampleLinear(decoded.channelData[1], decoded.sampleRate, GAME_AUDIO_SAMPLE_RATE))
    : Int16Array.from(left);
  if (right.length !== left.length) throw new Error('Decoded audio channels have different lengths.');
  return {
    sampleRate: GAME_AUDIO_SAMPLE_RATE,
    channelData: [left, right],
    sampleCount: left.length,
  };
}
