import { runEncodeJob, type EncodeJobInput, type EncodeJobResult } from './encodeJob';
import type { EncodeWorkerRequest, EncodeWorkerResponse } from './encodeWorkerProtocol';

function exactArrayBuffer(bytes: Uint8Array | Float32Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

/** Run full-song G.719 encoding in a disposable module worker when available. */
export async function encodeImportedSound(input: EncodeJobInput): Promise<EncodeJobResult> {
  if (typeof Worker === 'undefined') return runEncodeJob(input);

  let worker: Worker;
  try {
    worker = new Worker(new URL('./encodeWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    return runEncodeJob(input);
  }

  return new Promise<EncodeJobResult>((resolve, reject) => {
    const finish = () => worker.terminate();
    worker.onmessage = (event: MessageEvent<EncodeWorkerResponse>) => {
      finish();
      if (event.data.ok) resolve(event.data.result);
      else reject(new Error(event.data.error));
    };
    worker.onerror = () => {
      finish();
      reject(new Error('The audio encode worker crashed.'));
    };

    const request: EncodeWorkerRequest = {
      sampleRate: input.sampleRate,
      channelData: input.channelData.map(exactArrayBuffer),
      g719Wasm: exactArrayBuffer(input.g719Wasm),
      existingBank: input.existingBank ? exactArrayBuffer(input.existingBank) : undefined,
      templateBank: input.templateBank ? exactArrayBuffer(input.templateBank) : undefined,
      preferredStem: input.preferredStem,
      songId: input.songId,
      uniqueId: input.uniqueId,
      bankId: input.bankId,
      demoStartMs: input.demoStartMs,
    };
    const transfer: Transferable[] = [
      ...request.channelData,
      request.g719Wasm,
      ...(request.existingBank ? [request.existingBank] : []),
      ...(request.templateBank ? [request.templateBank] : []),
    ];
    worker.postMessage(request, transfer);
  });
}
