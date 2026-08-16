import type { EncodeJobResult } from './encodeJob';

export interface EncodeWorkerRequest {
  sampleRate: number;
  channelData: ArrayBuffer[];
  g719Wasm: ArrayBuffer;
  existingBank?: ArrayBuffer;
  templateBank?: ArrayBuffer;
  preferredStem: string;
  songId: string;
  uniqueId: number;
  bankId?: number;
  demoStartMs: number;
}

export type EncodeWorkerResponse =
  | { ok: true; result: EncodeJobResult }
  | { ok: false; error: string };
