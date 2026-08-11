// Off-main-thread bank decode (PLAN 6.6). A full song decodes in ~0.3-0.4s;
// short, but enough to jank rendering/input if run synchronously, so the player
// hands the work here and shows a lightweight `decoding…` state. Vite bundles
// this as a module worker via the `new URL(..., import.meta.url)` import in
// soundbankPlayer.ts. All real logic lives in runDecodeJob (decodeJob.ts) so it
// stays unit-testable; this file only marshals messages + transfers buffers.

import { runDecodeJob } from './decodeJob';
import type { DecodeWorkerRequest, DecodeWorkerResponse } from './workerProtocol';

// Minimal worker-scope typing so we don't have to pull in the "webworker" lib
// (which conflicts with the DOM lib used everywhere else).
interface WorkerScope {
  onmessage: ((event: MessageEvent<DecodeWorkerRequest>) => void) | null;
  postMessage(message: DecodeWorkerResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = async (event: MessageEvent<DecodeWorkerRequest>) => {
  const { id, bankBytes, g719Wasm, preferredStem, peakBuckets, maxSamples } = event.data;
  try {
    const result = await runDecodeJob({
      bankBytes: new Uint8Array(bankBytes),
      g719Wasm: g719Wasm ? new Uint8Array(g719Wasm) : undefined,
      preferredStem,
      peakBuckets,
      maxSamples,
    });
    const transfer: Transferable[] = [
      ...result.channelData.map((channel) => channel.buffer),
      result.peaks.min.buffer,
      result.peaks.max.buffer,
    ];
    scope.postMessage({ id, ok: true, result }, transfer);
  } catch (err) {
    scope.postMessage({ id, ok: false, error: (err as Error).message }, []);
  }
};
