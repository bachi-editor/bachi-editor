// Message protocol shared by soundbankPlayer (main thread) and decodeWorker.
// Kept separate so the player imports only types, never the worker module.

import type { DecodeJobResult } from './decodeJob';

export interface DecodeWorkerRequest {
  id: number;
  /** Exact bank bytes as a transferable ArrayBuffer. */
  bankBytes: ArrayBuffer;
  /** Exact user-supplied G.719 WASM bytes, when configured. */
  g719Wasm?: ArrayBuffer;
  preferredStem?: string;
  peakBuckets: number;
  maxSamples?: number;
}

export type DecodeWorkerResponse =
  | { id: number; ok: true; result: DecodeJobResult }
  | { id: number; ok: false; error: string };
