// Gzip helpers using the platform's CompressionStream/DecompressionStream.
//
// Note on determinism: CompressionStream output is not guaranteed to be
// byte-identical across implementations or versions. We rely on it for
// producing valid gzip streams that decompress to the original plaintext;
// we do NOT depend on byte-equality with arbitrary upstream gzip outputs.

async function streamConvert(input: Uint8Array, transform: ReadableWritablePair<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const source = new Blob([input as BlobPart]).stream();
  const piped = source.pipeThrough(transform);
  const reader = piped.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  return streamConvert(data, new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
}

export async function gzip(data: Uint8Array): Promise<Uint8Array> {
  return streamConvert(data, new CompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
}
