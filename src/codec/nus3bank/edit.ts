import { parseNus3Bank } from './parse';
import { selectPlayableTone } from './extract';

function writeI32le(bytes: Uint8Array, offset: number, value: number): void {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setInt32(offset, value, true);
}

function normalizeDemoStartMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function readNus3BankDemoStartMs(bytes: Uint8Array, preferredStem?: string): number | undefined {
  const bank = parseNus3Bank(bytes);
  const selection = selectPlayableTone(bank, preferredStem);
  return selection?.tone.demoStartMs;
}

export function patchNus3BankDemoStartMs(
  bytes: Uint8Array,
  preferredStem: string | undefined,
  demoStartMs: number,
): Uint8Array {
  const bank = parseNus3Bank(bytes);
  const selection = selectPlayableTone(bank, preferredStem);
  const tone = selection?.tone;
  if (!tone) {
    throw new Error('No playable tone found in this nus3bank.');
  }
  if (tone.demoStartOffset === undefined) {
    throw new Error(`Tone ${tone.name ?? `#${tone.index}`} does not expose a writable demo-start field.`);
  }
  const out = bytes.slice();
  writeI32le(out, tone.demoStartOffset, normalizeDemoStartMs(demoStartMs));
  return out;
}
