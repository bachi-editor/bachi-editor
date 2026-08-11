// Runtime adapter for a user-supplied wasm32 G.719 (ITU-T G.722.1 Annex X /
// Siren22) decoder. No decoder binary is imported into the application bundle:
// the browser receives bytes from Settings, while tests explicitly supply the
// development artifact kept under resources/g719/.

/** The G.719 codec always emits FRAME_LENGTH (960) samples per decoded frame. */
export const G719_SAMPLES_PER_FRAME = 960;

interface G719WasmExports {
  memory: WebAssembly.Memory;
  malloc(bytes: number): number;
  g719_init(frameSize: number): number;
  g719_decode_frame(handle: number, codeWords: number, sampleBuffer: number): void;
  g719_free(handle: number): void;
  g719_arena_reset(): void;
}

let modulePromise: Promise<WebAssembly.Module> | null = null;
let moduleBytes: Uint8Array<ArrayBuffer> | null = null;

const REQUIRED_EXPORTS = new Map<string, WebAssembly.ImportExportKind>([
  ['memory', 'memory'],
  ['malloc', 'function'],
  ['g719_init', 'function'],
  ['g719_decode_frame', 'function'],
  ['g719_free', 'function'],
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

function assertDecoderModule(module: WebAssembly.Module): void {
  const imports = WebAssembly.Module.imports(module);
  if (imports.length > 0) {
    throw new Error('The G.719 decoder WASM must not require imported functions or memory.');
  }
  const exports = new Map(WebAssembly.Module.exports(module).map((entry) => [entry.name, entry.kind]));
  for (const [name, kind] of REQUIRED_EXPORTS) {
    if (exports.get(name) !== kind) {
      throw new Error(`The G.719 decoder WASM is missing the required ${kind} export "${name}".`);
    }
  }
}

/** Compile and validate one decoder binary, reusing it while the bytes match. */
function compileModule(bytes: Uint8Array): Promise<WebAssembly.Module> {
  if (!modulePromise || !moduleBytes || !sameBytes(moduleBytes, bytes)) {
    moduleBytes = exactBytes(bytes);
    modulePromise = WebAssembly.compile(moduleBytes).then((module) => {
      assertDecoderModule(module);
      return module;
    });
  }
  return modulePromise;
}

/** Reject corrupt or incompatible files before they are persisted. */
export async function validateG719Wasm(bytes: Uint8Array): Promise<void> {
  if (bytes.length === 0) throw new Error('The G.719 decoder WASM file is empty.');
  await compileModule(bytes);
}

/**
 * A G.719 decode session for one BNSF stream. The codec is stateful per
 * channel (windowed overlap-add), so each channel gets its own decoder handle
 * and must be fed its frames in block order. All handles share one wasm
 * instance and a single pair of scratch buffers; `decodeFrame` returns a view
 * over wasm memory that is overwritten on the next call, so copy it out before
 * decoding again.
 */
export class G719Decoder {
  private constructor(
    private readonly ex: G719WasmExports,
    private readonly inPtr: number,
    private readonly outPtr: number,
    private readonly frameSize: number,
    private readonly handles: number[],
  ) {}

  static async create(wasmBytes: Uint8Array, channels: number, frameSize: number): Promise<G719Decoder> {
    if (channels <= 0) throw new Error(`G.719 decoder needs a positive channel count, got ${channels}`);
    if (frameSize <= 0) throw new Error(`G.719 decoder needs a positive frame size, got ${frameSize}`);
    const module = await compileModule(wasmBytes);
    const instance = await WebAssembly.instantiate(module, {});
    const ex = instance.exports as unknown as G719WasmExports;
    ex.g719_arena_reset();
    const inPtr = ex.malloc(frameSize);
    const outPtr = ex.malloc(G719_SAMPLES_PER_FRAME * 2);
    const handles: number[] = [];
    for (let c = 0; c < channels; c++) handles.push(ex.g719_init(frameSize));
    return new G719Decoder(ex, inPtr, outPtr, frameSize, handles);
  }

  /**
   * Decode one `frameSize`-byte frame for `channel` into 960 int16 samples.
   * The returned view is backed by wasm memory and only valid until the next
   * `decodeFrame` call.
   */
  decodeFrame(channel: number, frame: Uint8Array): Int16Array {
    if (channel < 0 || channel >= this.handles.length) {
      throw new RangeError(`G.719 channel ${channel} is outside 0..${this.handles.length - 1}`);
    }
    if (frame.length !== this.frameSize) {
      throw new RangeError(`G.719 frame is ${frame.length} bytes, expected ${this.frameSize}`);
    }
    new Uint8Array(this.ex.memory.buffer).set(frame, this.inPtr);
    this.ex.g719_decode_frame(this.handles[channel], this.inPtr, this.outPtr);
    return new Int16Array(this.ex.memory.buffer, this.outPtr, G719_SAMPLES_PER_FRAME);
  }

  dispose(): void {
    for (const handle of this.handles) this.ex.g719_free(handle);
  }
}
