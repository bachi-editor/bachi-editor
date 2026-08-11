// Runtime adapter for a user-supplied wasm32 G.719 (ITU-T G.722.1 Annex X /
// Siren22) encoder. The application persists the selected bytes in IndexedDB
// but never bundles an encoder binary into the production build.

import { G719_SAMPLES_PER_FRAME } from './g719Decoder';

interface G719EncoderWasmExports {
  memory: WebAssembly.Memory;
  malloc(bytes: number): number;
  g719_encoder_init(frameSize: number): number;
  g719_encode_frame(handle: number, sampleBuffer: number, output: number): number;
  g719_encoder_free(handle: number): void;
  g719_encoder_reset(handle: number): void;
  g719_arena_reset(): void;
}

let modulePromise: Promise<WebAssembly.Module> | null = null;
let moduleBytes: Uint8Array<ArrayBuffer> | null = null;

const REQUIRED_EXPORTS = new Map<string, WebAssembly.ImportExportKind>([
  ['memory', 'memory'],
  ['malloc', 'function'],
  ['g719_encoder_init', 'function'],
  ['g719_encode_frame', 'function'],
  ['g719_encoder_free', 'function'],
  ['g719_encoder_reset', 'function'],
  ['g719_arena_reset', 'function'],
]);

function exactBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(bytes);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function assertEncoderModule(module: WebAssembly.Module): void {
  const imports = WebAssembly.Module.imports(module);
  const validImports = imports.length === 1
    && imports[0].module === 'env'
    && imports[0].name === 'log10'
    && imports[0].kind === 'function';
  if (imports.length > 0 && !validImports) {
    throw new Error('The G.719 encoder WASM may only import the function "env.log10".');
  }
  const exports = new Map(WebAssembly.Module.exports(module).map((entry) => [entry.name, entry.kind]));
  for (const [name, kind] of REQUIRED_EXPORTS) {
    if (exports.get(name) !== kind) {
      throw new Error(`The G.719 encoder WASM is missing the required ${kind} export "${name}".`);
    }
  }
}

function compileModule(bytes: Uint8Array): Promise<WebAssembly.Module> {
  if (!modulePromise || !moduleBytes || !sameBytes(moduleBytes, bytes)) {
    moduleBytes = exactBytes(bytes);
    modulePromise = WebAssembly.compile(moduleBytes).then((module) => {
      assertEncoderModule(module);
      return module;
    });
  }
  return modulePromise;
}

/** Reject corrupt or incompatible encoder files before they are persisted. */
export async function validateG719EncoderWasm(bytes: Uint8Array): Promise<void> {
  if (bytes.length === 0) throw new Error('The G.719 encoder WASM file is empty.');
  await compileModule(bytes);
}

/** Stateful G.719 encode session with one reference-code handle per channel. */
export class G719Encoder {
  private constructor(
    private readonly ex: G719EncoderWasmExports,
    private readonly inPtr: number,
    private readonly outPtr: number,
    private readonly frameSize: number,
    private readonly handles: number[],
  ) {}

  static async create(wasmBytes: Uint8Array, channels: number, frameSize: number): Promise<G719Encoder> {
    if (!Number.isInteger(channels) || channels <= 0) {
      throw new Error(`G.719 encoder needs a positive channel count, got ${channels}`);
    }
    if (!Number.isInteger(frameSize) || frameSize < 80 || frameSize > 320 || frameSize % 40 !== 0) {
      throw new Error(`G.719 encoder frame size ${frameSize} is not a supported codec rate.`);
    }
    const module = await compileModule(wasmBytes);
    const imports = WebAssembly.Module.imports(module);
    const importObject: WebAssembly.Imports = {};
    if (imports.length > 0) {
      importObject.env = { log10: (value: number) => Math.log10(value) };
    }
    const instance = await WebAssembly.instantiate(module, importObject);
    const ex = instance.exports as unknown as G719EncoderWasmExports;
    ex.g719_arena_reset();
    const inPtr = ex.malloc(G719_SAMPLES_PER_FRAME * 2);
    const outPtr = ex.malloc(frameSize);
    const handles: number[] = [];
    for (let c = 0; c < channels; c++) {
      const handle = ex.g719_encoder_init(frameSize);
      if (handle === 0) throw new Error('The G.719 encoder could not allocate a channel state.');
      handles.push(handle);
    }
    return new G719Encoder(ex, inPtr, outPtr, frameSize, handles);
  }

  /** Encode exactly 960 PCM16 samples; copy the returned wasm-backed view before the next call. */
  encodeFrame(channel: number, samples: Int16Array): Uint8Array {
    if (channel < 0 || channel >= this.handles.length) {
      throw new RangeError(`G.719 channel ${channel} is outside 0..${this.handles.length - 1}`);
    }
    if (samples.length !== G719_SAMPLES_PER_FRAME) {
      throw new RangeError(`G.719 input has ${samples.length} samples, expected ${G719_SAMPLES_PER_FRAME}`);
    }
    new Int16Array(this.ex.memory.buffer, this.inPtr, G719_SAMPLES_PER_FRAME).set(samples);
    const written = this.ex.g719_encode_frame(this.handles[channel], this.inPtr, this.outPtr);
    if (written !== this.frameSize) {
      throw new Error(`The G.719 encoder wrote ${written} bytes, expected ${this.frameSize}.`);
    }
    return new Uint8Array(this.ex.memory.buffer, this.outPtr, this.frameSize);
  }

  reset(): void {
    for (const handle of this.handles) this.ex.g719_encoder_reset(handle);
  }

  dispose(): void {
    for (const handle of this.handles) this.ex.g719_encoder_free(handle);
  }
}
