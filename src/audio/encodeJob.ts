import {
  createNus3BankFromTemplate,
  encodeG719Bnsf,
  replaceNus3BankStream,
} from '../codec';
import { normalizeAudioForGame, type DecodedAudioData } from './audioImport';

export interface EncodeJobInput extends DecodedAudioData {
  g719Wasm: Uint8Array;
  existingBank?: Uint8Array;
  templateBank?: Uint8Array;
  preferredStem: string;
  songId: string;
  uniqueId: number;
  bankId?: number;
  demoStartMs: number;
}

export interface EncodeJobResult {
  bankBytes: Uint8Array<ArrayBuffer>;
  sampleCount: number;
  durationSeconds: number;
}

export async function runEncodeJob(input: EncodeJobInput): Promise<EncodeJobResult> {
  const pcm = normalizeAudioForGame(input);
  const stream = await encodeG719Bnsf(pcm.channelData, input.g719Wasm);
  let bankBytes: Uint8Array;
  if (input.existingBank) {
    bankBytes = replaceNus3BankStream(input.existingBank, stream, input.preferredStem);
  } else if (input.templateBank) {
    bankBytes = createNus3BankFromTemplate(input.templateBank, {
      songId: input.songId,
      uniqueId: input.uniqueId,
      bankId: input.bankId,
      demoStartMs: input.demoStartMs,
      streamBytes: stream,
    });
  } else {
    throw new Error('A nus3bank template is required for a song without audio.');
  }
  return {
    bankBytes: Uint8Array.from(bankBytes),
    sampleCount: pcm.sampleCount,
    durationSeconds: pcm.sampleCount / pcm.sampleRate,
  };
}
