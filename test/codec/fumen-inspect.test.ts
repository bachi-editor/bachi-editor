import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, test } from 'vitest';
import { openEnvelope } from '../../src/codec/envelope';
import { FUMEN_KEY_HEX } from '../helpers/keys';

const REPO = resolve(__dirname, '../../..');

async function loadAndDecrypt(rel: string): Promise<Uint8Array> {
  const buf = await readFile(resolve(REPO, rel));
  const { payload } = await openEnvelope(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), FUMEN_KEY_HEX);
  return payload;
}

function hex(bytes: Uint8Array, start: number, len: number): string {
  return [...bytes.slice(start, start + len)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

function f32(bytes: Uint8Array, off: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + off, 4).getFloat32(0, true);
}
function i32(bytes: Uint8Array, off: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + off, 4).getInt32(0, true);
}
function u32(bytes: Uint8Array, off: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + off, 4).getUint32(0, true);
}
function u16(bytes: Uint8Array, off: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + off, 2).getUint16(0, true);
}

describe.skip('fumen byte inspection (run with --include for one-off RE)', () => {
  test('dump header of multiple difficulties of 10binz', async () => {
    const samples = [
      'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_e.bin',
      'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_n.bin',
      'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_h.bin',
      'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_m.bin',
    ];
    for (const s of samples) {
      const p = await loadAndDecrypt(s);
      // eslint-disable-next-line no-console
      console.log(`\n=== ${s} (size=${p.length}) ===`);
      // eslint-disable-next-line no-console
      console.log('  bytes [0..96]   :', hex(p, 0, 96));
      // eslint-disable-next-line no-console
      console.log('  bytes [96..208] :', hex(p, 96, 112));
      // eslint-disable-next-line no-console
      console.log('  bytes [208..272]:', hex(p, 208, 64));
      // eslint-disable-next-line no-console
      console.log('  bytes [272..336]:', hex(p, 272, 64));
      // eslint-disable-next-line no-console
      console.log('  bytes [336..400]:', hex(p, 336, 64));
      // eslint-disable-next-line no-console
      console.log('  bytes [400..464]:', hex(p, 400, 64));
      // eslint-disable-next-line no-console
      console.log('  bytes [464..520]:', hex(p, 464, 56));
      // eslint-disable-next-line no-console
      console.log('  f32 0,4,8       :', f32(p, 0), f32(p, 4), f32(p, 8));
      // eslint-disable-next-line no-console
      console.log('  candidate fields @ 512..544:', hex(p, 512, 32));
      // eslint-disable-next-line no-console
      console.log('  ...near 200..220:', hex(p, 200, 20));
    }
  });

  test('dump first 1024 bytes of a failing file (1psovt_e)', async () => {
    const p = await loadAndDecrypt('resources/TaikoCHN/Data/x64/fumen/1psovt/1psovt_e.bin');
    // eslint-disable-next-line no-console
    console.log(`\n=== 1psovt_e (size ${p.length}) ===`);
    for (let off = 0; off < 1024; off += 16) {
      const row = hex(p, off, 16);
      // eslint-disable-next-line no-console
      console.log(`  ${off.toString(16).padStart(4, '0')}: ${row}`);
    }
    // eslint-disable-next-line no-console
    console.log(`  @520 bpm=${f32(p, 520)} offset=${f32(p, 524)} gogo=${p[528]} barline=${p[529]} pad=${p[530]},${p[531]}`);
  });

  test('dump bytes 520..720 for 10binz_e (start of first measures)', async () => {
    const p = await loadAndDecrypt('resources/TaikoCHN/Data/x64/fumen/10binz/10binz_e.bin');
    // eslint-disable-next-line no-console
    console.log(`\n=== first measures of 10binz_e (size ${p.length}) ===`);
    for (let off = 520; off < 920; off += 16) {
      const row = hex(p, off, 16);
      // eslint-disable-next-line no-console
      console.log(`  ${off.toString().padStart(5, ' ')}: ${row}`);
    }
    // Try interpreting at different offsets
    // eslint-disable-next-line no-console
    console.log(`  @520 bpm=${f32(p, 520)} offset=${f32(p, 524)} gogo=${p[528]} barline=${p[529]} pad=${p[530]},${p[531]}`);
    // eslint-disable-next-line no-console
    console.log(`  @532 branch_info i32 ×6:`, [0,1,2,3,4,5].map((i) => i32(p, 532 + i*4)));
    // eslint-disable-next-line no-console
    console.log(`  @556 i32:`, i32(p, 556), `next i32 @560:`, i32(p, 560), '@564:', i32(p, 564), '@568:', i32(p, 568));
  });

  test('write decrypted payloads to /tmp for manual inspection', async () => {
    const samples = [
      ['10binz_e', 'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_e.bin'],
      ['10binz_n', 'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_n.bin'],
      ['10binz_h', 'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_h.bin'],
      ['10binz_m', 'resources/TaikoCHN/Data/x64/fumen/10binz/10binz_m.bin'],
      ['1psovt_e', 'resources/TaikoCHN/Data/x64/fumen/1psovt/1psovt_e.bin'],
      ['20tbc_e', 'resources/TaikoCHN/Data/x64/fumen/20tbc/20tbc_e.bin'],
      ['20tftr_h', 'resources/TaikoCHN/Data/x64/fumen/20tftr/20tftr_h.bin'],
    ];
    for (const [name, path] of samples) {
      const p = await loadAndDecrypt(path);
      await writeFile(`/tmp/fumen-${name}.bin`, p);
    }
  });
});

// Helpers used by other tests
export { loadAndDecrypt, hex, f32, i32, u32, u16 };
