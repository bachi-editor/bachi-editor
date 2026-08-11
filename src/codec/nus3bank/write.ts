import { selectPlayableTone } from './extract';
import { parseNus3Bank } from './parse';
import type { Nus3Tone } from './types';

function align4(value: number): number {
  return (value + 3) & ~3;
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

function shiftedOffset(offset: number, replacedEnd: number, delta: number): number {
  return offset >= replacedEnd ? offset + delta : offset;
}

function requireToneFields(tone: Nus3Tone): asserts tone is Nus3Tone & {
  packOffset: number;
  packSize: number;
  packOffsetFieldOffset: number;
  packSizeFieldOffset: number;
} {
  if (
    tone.packOffset === undefined
    || tone.packSize === undefined
    || tone.packOffsetFieldOffset === undefined
    || tone.packSizeFieldOffset === undefined
  ) {
    throw new Error(`TONE ${tone.index} has no writable PACK descriptor.`);
  }
}

/** Replace one embedded song stream while preserving all other bank metadata. */
export function replaceNus3BankStream(
  bankBytes: Uint8Array,
  streamBytes: Uint8Array,
  preferredStem?: string,
): Uint8Array {
  if (streamBytes.length === 0) throw new Error('Cannot put an empty stream in a nus3bank.');
  const bank = parseNus3Bank(bankBytes);
  const pack = bank.sections.find((section) => section.id === 'PACK');
  if (!pack) throw new Error('The nus3bank has no PACK section.');
  const selection = selectPlayableTone(
    bank,
    preferredStem,
    ['bnsf', 'idsp', 'riff', 'ogg', 'opus', 'unknown'],
  );
  if (!selection) throw new Error('The nus3bank has no replaceable embedded stream.');
  const selected = selection.tone;
  requireToneFields(selected);

  const replacedStart = selection.stream.absoluteOffset;
  const replacedEnd = replacedStart + selection.stream.size;
  const delta = streamBytes.length - selection.stream.size;
  const nextPackSize = pack.size + delta;
  if (nextPackSize < 0 || nextPackSize > 0xffff_ffff) {
    throw new Error('The replacement would make the PACK section invalid.');
  }

  for (const tone of bank.tones) {
    if (!tone.stream || tone === selected) continue;
    requireToneFields(tone);
    const start = tone.packOffset;
    const end = start + tone.packSize;
    const selectedStart = selected.packOffset;
    const selectedEnd = selectedStart + selected.packSize;
    const sharesSelectedStream = start === selectedStart && end === selectedEnd;
    if (!sharesSelectedStream && start < selectedEnd && end > selectedStart) {
      throw new Error(`TONE ${tone.index} overlaps the selected PACK stream.`);
    }
  }

  const out = new Uint8Array(bankBytes.length + delta);
  out.set(bankBytes.subarray(0, replacedStart));
  out.set(streamBytes, replacedStart);
  out.set(bankBytes.subarray(replacedEnd), replacedStart + streamBytes.length);
  const view = dataView(out);

  view.setUint32(4, out.byteLength - 8, true);
  const packIndex = bank.sections.indexOf(pack);
  view.setUint32(24 + packIndex * 8 + 4, nextPackSize, true);
  view.setUint32(shiftedOffset(pack.offset + 4, replacedEnd, delta), nextPackSize, true);

  for (const tone of bank.tones) {
    if (!tone.stream) continue;
    requireToneFields(tone);
    const sameStream = tone.packOffset === selected.packOffset && tone.packSize === selected.packSize;
    const nextOffset = tone.packOffset > selected.packOffset ? tone.packOffset + delta : tone.packOffset;
    const nextSize = sameStream ? streamBytes.length : tone.packSize;
    view.setUint32(shiftedOffset(tone.packOffsetFieldOffset, replacedEnd, delta), nextOffset, true);
    view.setUint32(shiftedOffset(tone.packSizeFieldOffset, replacedEnd, delta), nextSize, true);
  }

  // Treat our own output as untrusted too: this catches stale offset/size logic
  // before the bytes ever reach the production folder.
  parseNus3Bank(out);
  return out;
}

interface TemplateSection {
  id: string;
  offset: number;
  size: number;
}

const TEMPLATE_HEADER_SIZE = 80;
const TEMPLATE_SECTIONS: readonly TemplateSection[] = [
  { id: 'PROP', offset: 80, size: 60 },
  { id: 'BINF', offset: 148, size: 28 },
  { id: 'GRP ', offset: 184, size: 1092 },
  { id: 'DTON', offset: 1284, size: 224 },
  { id: 'TONE', offset: 1516, size: 320 },
  { id: 'JUNK', offset: 1844, size: 12 },
  { id: 'PACK', offset: 1864, size: 0 },
];

export interface CreateNus3BankOptions {
  songId: string;
  uniqueId: number;
  demoStartMs: number;
  streamBytes: Uint8Array;
}

function assertTemplate(template: Uint8Array): void {
  if (template.length !== 1872 || readAscii(template, 0, 4) !== 'NUS3') {
    throw new Error('The bundled nus3bank template is invalid.');
  }
  for (const section of TEMPLATE_SECTIONS) {
    if (readAscii(template, section.offset, 4) !== section.id) {
      throw new Error(`The bundled nus3bank template is missing ${section.id}.`);
    }
  }
}

function makeBinfPayload(template: Uint8Array, toneName: string, uniqueId: number): Uint8Array {
  const nameLength = toneName.length;
  const nameArea = align4(1 + nameLength);
  const out = new Uint8Array(8 + nameArea + 4);
  out.set(template.subarray(156, 164), 0);
  out[8] = nameLength;
  ascii(out, 9, toneName);
  const view = dataView(out);
  view.setUint16(8 + nameArea, uniqueId, true);
  view.setUint16(8 + nameArea + 2, 0, true);
  return out;
}

function makeTonePayload(
  template: Uint8Array,
  toneName: string,
  streamSize: number,
  demoStartMs: number,
): Uint8Array {
  const oldPayloadOffset = 1524;
  const oldView = dataView(template);
  const oldRecordRelative = oldView.getUint32(oldPayloadOffset + 4, true);
  const oldRecordSize = oldView.getUint32(oldPayloadOffset + 8, true);
  const oldRecordOffset = oldPayloadOffset + oldRecordRelative;
  const oldNameLength = template[oldRecordOffset + 12];
  const oldDescriptorBase = 12 + align4(1 + oldNameLength);
  const oldSuffix = template.subarray(oldRecordOffset + oldDescriptorBase, oldRecordOffset + oldRecordSize);

  const descriptorBase = 12 + align4(1 + toneName.length);
  const record = new Uint8Array(descriptorBase + oldSuffix.length);
  record.set(template.subarray(oldRecordOffset, oldRecordOffset + 12), 0);
  record[12] = toneName.length;
  ascii(record, 13, toneName);
  record.set(oldSuffix, descriptorBase);
  const recordView = dataView(record);
  recordView.setUint32(descriptorBase + 8, 0, true);
  recordView.setUint32(descriptorBase + 12, streamSize, true);

  const oldDemoRelative = 1732 - oldRecordOffset;
  const demoFromDescriptor = oldDemoRelative - oldDescriptorBase;
  recordView.setUint32(descriptorBase + demoFromDescriptor, demoStartMs, true);

  const out = new Uint8Array(12 + record.length);
  const view = dataView(out);
  view.setUint32(0, 1, true);
  view.setUint32(4, 12, true);
  view.setUint32(8, record.length, true);
  out.set(record, 12);
  return out;
}

/** Build a one-tone song bank from the MIT-licensed TaikoSoundEditor template. */
export function createNus3BankFromTemplate(
  template: Uint8Array,
  options: CreateNus3BankOptions,
): Uint8Array {
  assertTemplate(template);
  if (!/^[a-z0-9_]+$/.test(options.songId)) throw new Error('The song id is not nus3bank-safe.');
  const toneName = `song_${options.songId}`;
  if (toneName.length > 255) throw new Error('The song id is too long for a nus3bank tone name.');
  if (!Number.isInteger(options.uniqueId) || options.uniqueId < 0 || options.uniqueId > 0xffff) {
    throw new Error('The Song No. does not fit the nus3bank BINF field.');
  }
  if (options.streamBytes.length === 0) throw new Error('Cannot create a bank with an empty stream.');
  const demoStartMs = Math.max(0, Math.min(60 * 60 * 1000, Math.round(options.demoStartMs)));

  const payloads = new Map<string, Uint8Array>();
  for (const section of TEMPLATE_SECTIONS.slice(0, -1)) {
    payloads.set(section.id, template.slice(section.offset + 8, section.offset + 8 + section.size));
  }
  payloads.set('BINF', makeBinfPayload(template, toneName, options.uniqueId));
  payloads.set('TONE', makeTonePayload(template, toneName, options.streamBytes.length, demoStartMs));
  payloads.set('PACK', options.streamBytes);

  let byteLength = TEMPLATE_HEADER_SIZE;
  for (const section of TEMPLATE_SECTIONS) byteLength += 8 + (payloads.get(section.id)?.length ?? 0);
  const out = new Uint8Array(byteLength);
  out.set(template.subarray(0, TEMPLATE_HEADER_SIZE));
  const view = dataView(out);
  view.setUint32(4, out.length - 8, true);

  let offset = TEMPLATE_HEADER_SIZE;
  TEMPLATE_SECTIONS.forEach((section, index) => {
    const payload = payloads.get(section.id);
    if (!payload) throw new Error(`The nus3bank template has no ${section.id} payload.`);
    ascii(out, offset, section.id);
    view.setUint32(offset + 4, payload.length, true);
    view.setUint32(24 + index * 8 + 4, payload.length, true);
    out.set(payload, offset + 8);
    offset += 8 + payload.length;
  });

  parseNus3Bank(out);
  return out;
}
