import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { decodeFumen } from '../../src/codec/fumen/decode';
import { encodeFumen, verifyEncoderSelfConsistent } from '../../src/codec/fumen/encode';
import { openEnvelope } from '../../src/codec/envelope';
import { FUMEN_KEY_HEX } from '../helpers/keys';
import { FumenNote } from '../../src/codec/fumen/types';
import {
  setBranchSpeedOverride,
  setMeasureBranchInfo,
  updateMeasureProperties,
} from '../../src/model/fumenEdits';
import { HAS_CORPUS } from '../helpers/resources';

const REPO = resolve(__dirname, '../../..');
const FUMEN_DIR = resolve(REPO, 'resources/TaikoCHN/Data/x64/fumen');

async function decryptedPayload(p: string): Promise<Uint8Array> {
  const buf = await readFile(p);
  const { payload } = await openEnvelope(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), FUMEN_KEY_HEX);
  return payload;
}

describe.skipIf(!HAS_CORPUS)('fumen edits round-trip cleanly', () => {
  test('adding a Don note to measure 0 branch 0 survives encode→decode', async () => {
    const payload = await decryptedPayload(resolve(FUMEN_DIR, '10binz/10binz_n.bin'));
    const fumen = decodeFumen(payload);
    const originalNoteCount = fumen.measures[0].branches[0].notes.length;
    const newNote: FumenNote = {
      type: 0x1, // Don
      position: 250.0,
      item: 0,
      padding: 0,
      scoreInit: 0,
      scoreDiff: 0,
      duration: 0,
    };
    fumen.measures[0].branches[0].notes.push(newNote);

    const encoded = encodeFumen(fumen);
    const reDecoded = decodeFumen(encoded);

    expect(reDecoded.measures[0].branches[0].notes.length).toBe(originalNoteCount + 1);
    const added = reDecoded.measures[0].branches[0].notes[originalNoteCount];
    expect(added.type).toBe(0x1);
    expect(added.position).toBe(250.0);
  });

  test('changing BPM on measure 0 survives encode→decode', async () => {
    const payload = await decryptedPayload(resolve(FUMEN_DIR, '10binz/10binz_e.bin'));
    const fumen = decodeFumen(payload);
    const originalBpm = fumen.measures[0].bpm;
    fumen.measures[0].bpm = 200.0;
    const encoded = encodeFumen(fumen);
    const reDecoded = decodeFumen(encoded);
    expect(reDecoded.measures[0].bpm).toBe(200.0);
    expect(reDecoded.measures[0].bpm).not.toBe(originalBpm);
  });

  test('toggling gogo on measure 0 survives encode→decode', async () => {
    const payload = await decryptedPayload(resolve(FUMEN_DIR, '10binz/10binz_e.bin'));
    const fumen = decodeFumen(payload);
    fumen.measures[0].gogo = fumen.measures[0].gogo ? 0 : 1;
    const newGogo = fumen.measures[0].gogo;
    const encoded = encodeFumen(fumen);
    const reDecoded = decodeFumen(encoded);
    expect(reDecoded.measures[0].gogo).toBe(newGogo);
  });

  test('measure transforms edit header fields and branch speed', async () => {
    const payload = await decryptedPayload(resolve(FUMEN_DIR, '10binz/10binz_e.bin'));
    const fumen = decodeFumen(payload);
    const withProps = updateMeasureProperties(fumen, 0, { bpm: 201.5, offset: 12, gogo: 1, barline: 0 });
    const result = setBranchSpeedOverride(withProps.fumen, 0, 0, true, 1.25);

    const encoded = encodeFumen(result.fumen);
    const reDecoded = decodeFumen(encoded);

    expect(reDecoded.measures[0].bpm).toBe(201.5);
    expect(reDecoded.measures[0].offset).toBe(12);
    expect(reDecoded.measures[0].gogo).toBe(1);
    expect(reDecoded.measures[0].barline).toBe(0);
    expect(reDecoded.measures[0].branches[0].speed).toBe(1.25);
  });

  test('removing the last note from a measure survives encode→decode', async () => {
    const payload = await decryptedPayload(resolve(FUMEN_DIR, '10binz/10binz_m.bin'));
    const fumen = decodeFumen(payload);
    // find a measure with at least 1 note in branch 0
    const idx = fumen.measures.findIndex((m) => m.branches[0].notes.length > 0);
    expect(idx).toBeGreaterThanOrEqual(0);
    const before = fumen.measures[idx].branches[0].notes.length;
    fumen.measures[idx].branches[0].notes.pop();
    const encoded = encodeFumen(fumen);
    const reDecoded = decodeFumen(encoded);
    expect(reDecoded.measures[idx].branches[0].notes.length).toBe(before - 1);
  });

  test('encoder self-consistency check passes on edited fumen', async () => {
    const payload = await decryptedPayload(resolve(FUMEN_DIR, '10binz/10binz_m.bin'));
    const fumen = decodeFumen(payload);
    // mutate a few things
    fumen.measures[0].bpm = 200;
    fumen.measures[0].gogo = 1;
    if (fumen.measures[0].branches[0].notes.length > 0) {
      fumen.measures[0].branches[0].notes[0].position += 50;
    }
    const result = verifyEncoderSelfConsistent(fumen);
    expect(result.ok).toBe(true);
  });

  test('branch condition edit round-trips on a branched chart (Phase 3.5)', async () => {
    const payload = await decryptedPayload(resolve(FUMEN_DIR, 'akbhvy/akbhvy_h.bin'));
    const fumen = decodeFumen(payload);
    const idx = fumen.measures.findIndex((m) => m.branchInfo.some((v) => v >= 0));
    expect(idx).toBeGreaterThanOrEqual(0);

    const next = setMeasureBranchInfo(fumen, idx, [320, 480, 320, 480, 360, 520]);
    expect(next.fumen.measures[idx].branchInfo).toEqual([320, 480, 320, 480, 360, 520]);

    const reDecoded = decodeFumen(encodeFumen(next.fumen));
    expect(reDecoded.measures[idx].branchInfo).toEqual([320, 480, 320, 480, 360, 520]);
    expect(verifyEncoderSelfConsistent(next.fumen).ok).toBe(true);
  });

  test('clearing a branch point writes the [-1×6] sentinel', async () => {
    const payload = await decryptedPayload(resolve(FUMEN_DIR, 'akbhvy/akbhvy_h.bin'));
    const fumen = decodeFumen(payload);
    const idx = fumen.measures.findIndex((m) => m.branchInfo.some((v) => v >= 0));
    const next = setMeasureBranchInfo(fumen, idx, [-1, -1, -1, -1, -1, -1]);
    expect(next.fumen.measures[idx].branchInfo).toEqual([-1, -1, -1, -1, -1, -1]);
    expect(decodeFumen(encodeFumen(next.fumen)).measures[idx].branchInfo).toEqual([-1, -1, -1, -1, -1, -1]);
  });
});
