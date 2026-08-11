import { runEncodeJob } from './encodeJob';
import type { EncodeWorkerRequest, EncodeWorkerResponse } from './encodeWorkerProtocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<EncodeWorkerRequest>) => void) | null;
  postMessage(message: EncodeWorkerResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = async (event: MessageEvent<EncodeWorkerRequest>) => {
  const input = event.data;
  try {
    const result = await runEncodeJob({
      ...input,
      channelData: input.channelData.map((buffer) => new Float32Array(buffer)),
      g719Wasm: new Uint8Array(input.g719Wasm),
      existingBank: input.existingBank ? new Uint8Array(input.existingBank) : undefined,
      templateBank: input.templateBank ? new Uint8Array(input.templateBank) : undefined,
    });
    scope.postMessage({ ok: true, result }, [result.bankBytes.buffer]);
  } catch (err) {
    scope.postMessage({ ok: false, error: (err as Error).message }, []);
  }
};
