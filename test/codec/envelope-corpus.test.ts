import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { openEnvelope, sealEnvelope } from '../../src/codec/envelope';
import { DATATABLE_KEY_HEX, FUMEN_KEY_HEX } from '../helpers/keys';
import { DUMPS, loadBytes, walkBins } from '../helpers/dumps';

// Stable assertion that two Uint8Arrays match without inflating the failure log.
function expectByteEqual(a: Uint8Array, b: Uint8Array, where: string): void {
  if (a.length !== b.length) {
    throw new Error(`${where}: length mismatch ${a.length} vs ${b.length}`);
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      throw new Error(
        `${where}: byte mismatch at offset ${i} (0x${i.toString(16)}): ${a[i]} vs ${b[i]}`,
      );
    }
  }
}

// Every dump must round-trip through the AES+gzip envelope byte-for-byte, whatever
// IV scheme its files use (CHN has fixed IVs, JPN random IVs — sealEnvelope preserves
// each file's own IV, so both recover identical bytes).
describe.each(DUMPS)('envelope corpus [$region]: payload-level round-trip is byte-perfect', ({ x64 }) => {
  const DATATABLE_DIR = resolve(x64, 'datatable');
  const FUMEN_DIR = resolve(x64, 'fumen');

  test('every datatable .bin: gunzip -> gzip -> gunzip recovers identical bytes', async () => {
    const files: string[] = [];
    for await (const p of walkBins(DATATABLE_DIR)) files.push(p);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const original = await loadBytes(file);
      const { payload, iv } = await openEnvelope(original, DATATABLE_KEY_HEX);
      const reSealed = await sealEnvelope(payload, DATATABLE_KEY_HEX, iv);
      const { payload: payload2 } = await openEnvelope(reSealed, DATATABLE_KEY_HEX);
      expectByteEqual(payload2, payload, `datatable ${file}`);
    }
  });

  test('every fumen .bin: gunzip -> gzip -> gunzip recovers identical bytes', async () => {
    const sizes: { file: string; bytes: number }[] = [];
    const files: string[] = [];
    for await (const p of walkBins(FUMEN_DIR)) files.push(p);
    expect(files.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`fumen corpus: ${files.length} .bin files`);
    let i = 0;
    for (const file of files) {
      const original = await loadBytes(file);
      const { payload, iv } = await openEnvelope(original, FUMEN_KEY_HEX);
      const reSealed = await sealEnvelope(payload, FUMEN_KEY_HEX, iv);
      const { payload: payload2 } = await openEnvelope(reSealed, FUMEN_KEY_HEX);
      expectByteEqual(payload2, payload, `fumen ${file}`);
      if (sizes.length < 4) sizes.push({ file, bytes: payload.length });
      if (++i % 1000 === 0) {
        // eslint-disable-next-line no-console
        console.log(`  processed ${i}/${files.length}...`);
      }
    }
    // eslint-disable-next-line no-console
    console.log('first 4 file sizes:', sizes);
  }, 600_000);
});

// Sentinel: every dump's corpus directories must exist so the walks above aren't
// silently empty.
test.each(DUMPS)('corpus directories exist [$region]', async ({ x64 }) => {
  const d = await stat(resolve(x64, 'datatable'));
  const f = await stat(resolve(x64, 'fumen'));
  expect(d.isDirectory()).toBe(true);
  expect(f.isDirectory()).toBe(true);
});
