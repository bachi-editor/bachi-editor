import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decodeFumen } from '../../src/codec/fumen/decode';
import { encodeFumen } from '../../src/codec/fumen/encode';
import { openEnvelope } from '../../src/codec/envelope';
import { FUMEN_KEY_HEX } from '../helpers/keys';
import { DUMPS, walkBins } from '../helpers/dumps';
import { HAS_CORPUS } from '../helpers/resources';

const REPO = resolve(__dirname, '../../..');
const FUMEN_DIR = resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen');

async function decryptedPayload(p: string): Promise<Uint8Array> {
  const buf = await readFile(p);
  const { payload } = await openEnvelope(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), FUMEN_KEY_HEX);
  return payload;
}

function byteDiffOffset(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

function hex(bytes: Uint8Array, start: number, len: number): string {
  return [...bytes.slice(start, start + len)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

describe.skipIf(!HAS_CORPUS)('fumen structural decode/encode', () => {
  test('decodes 10binz_e.bin into a plausible structure', async () => {
    const payload = await decryptedPayload(resolve(FUMEN_DIR, '10binz/10binz_e.bin'));
    const fumen = decodeFumen(payload);
    expect(fumen.header.timingWindows.length).toBe(108);
    expect(fumen.header.measureCount).toBe(fumen.measures.length);
    expect(fumen.measures.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `10binz_e: ${fumen.measures.length} measures, trailer=${fumen.trailer.length}, ` +
        `first measure bpm=${fumen.measures[0].bpm} offset=${fumen.measures[0].offset} ` +
        `gogo=${fumen.measures[0].gogo} barline=${fumen.measures[0].barline} ` +
        `notes_b0=${fumen.measures[0].branches[0].notes.length}`,
    );
    // Count total notes across branch 0
    const totalNotesB0 = fumen.measures.reduce((sum, m) => sum + m.branches[0].notes.length, 0);
    // eslint-disable-next-line no-console
    console.log(`10binz_e branch-0 total notes: ${totalNotesB0}`);
    expect(totalNotesB0).toBeGreaterThan(0);
  });

  test('round-trip on 10binz_e.bin is byte-perfect', async () => {
    const payload = await decryptedPayload(resolve(FUMEN_DIR, '10binz/10binz_e.bin'));
    const fumen = decodeFumen(payload);
    const reEncoded = encodeFumen(fumen);
    expect(reEncoded.length).toBe(payload.length);
    const diff = byteDiffOffset(reEncoded, payload);
    if (diff >= 0) {
      // eslint-disable-next-line no-console
      console.log(`diff at ${diff}: original=${hex(payload, Math.max(0, diff - 8), 32)} got=${hex(reEncoded, Math.max(0, diff - 8), 32)}`);
    }
    expect(diff).toBe(-1);
  });

  test('round-trip on all 4 difficulties of 10binz is byte-perfect', async () => {
    for (const f of ['10binz_e', '10binz_n', '10binz_h', '10binz_m']) {
      const payload = await decryptedPayload(resolve(FUMEN_DIR, `10binz/${f}.bin`));
      const fumen = decodeFumen(payload);
      const reEncoded = encodeFumen(fumen);
      const diff = byteDiffOffset(reEncoded, payload);
      if (diff >= 0) {
        // eslint-disable-next-line no-console
        console.log(`${f} diff at ${diff}: orig=${hex(payload, diff, 24)} got=${hex(reEncoded, diff, 24)}`);
      }
      expect(diff, `${f} structural round-trip`).toBe(-1);
    }
  });

  test.each(DUMPS)('round-trip over the full $region fumen corpus is byte-perfect', async ({ x64 }) => {
    const fumenDir = resolve(x64, 'fumen');
    const all: string[] = [];
    for await (const p of walkBins(fumenDir)) all.push(p);
    all.sort();
    const sample = all;
    // eslint-disable-next-line no-console
    console.log(`scanning ${sample.length} fumen files...`);

    const failures: { file: string; diff: number; trailer: number; measures: number; reason?: string }[] = [];
    let i = 0;
    for (const file of sample) {
      if (++i % 2000 === 0) {
        // eslint-disable-next-line no-console
        console.log(`  ${i}/${sample.length} processed (${failures.length} failures)`);
      }
      const payload = await decryptedPayload(file);
      let fumen;
      try {
        fumen = decodeFumen(payload);
      } catch (e) {
        failures.push({ file, diff: -1, trailer: 0, measures: 0, reason: (e as Error).message });
        if (failures.length <= 5) {
          // eslint-disable-next-line no-console
          console.log(`DECODE FAIL ${file}: ${(e as Error).message}`);
        }
        continue;
      }
      const reEncoded = encodeFumen(fumen);
      const diff = byteDiffOffset(reEncoded, payload);
      if (diff !== -1) {
        failures.push({ file, diff, trailer: fumen.trailer.length, measures: fumen.measures.length });
        if (failures.length <= 3) {
          // eslint-disable-next-line no-console
          console.log(
            `FAIL ${file} @${diff}: payloadLen=${payload.length} encLen=${reEncoded.length} ` +
              `measures=${fumen.measures.length} trailer=${fumen.trailer.length}`,
          );
          // eslint-disable-next-line no-console
          console.log(`  orig: ${hex(payload, Math.max(0, diff - 8), 32)}`);
          // eslint-disable-next-line no-console
          console.log(`  got : ${hex(reEncoded, Math.max(0, diff - 8), 32)}`);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`sample ${sample.length} files: ${failures.length} failures`);
    expect(failures).toEqual([]);
  }, 120_000);
});
