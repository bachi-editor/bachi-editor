import {
  BnsfMetadata,
  IdspMetadata,
  Nus3Bank,
  Nus3ParseError,
  Nus3Section,
  Nus3Stream,
  Nus3StreamKind,
  Nus3Tone,
  RiffWaveMetadata,
} from './types';

function align4(n: number): number {
  return (n + 3) & ~3;
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

function trimNulls(s: string): string {
  return s.replace(/\0+$/g, '');
}

class Reader {
  constructor(private readonly bytes: Uint8Array) {}

  get length(): number {
    return this.bytes.byteLength;
  }

  require(offset: number, length: number, context: string): void {
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 0) {
      throw new Nus3ParseError(`${context}: invalid range ${offset}+${length}`);
    }
    if (offset + length > this.bytes.byteLength) {
      throw new Nus3ParseError(`${context}: range ${offset}+${length} exceeds ${this.bytes.byteLength} bytes`);
    }
  }

  u8(offset: number, context: string): number {
    this.require(offset, 1, context);
    return this.bytes[offset];
  }

  u16le(offset: number, context: string): number {
    this.require(offset, 2, context);
    return this.bytes[offset] | (this.bytes[offset + 1] << 8);
  }

  u16be(offset: number, context: string): number {
    this.require(offset, 2, context);
    return (this.bytes[offset] << 8) | this.bytes[offset + 1];
  }

  s16be(offset: number, context: string): number {
    const n = this.u16be(offset, context);
    return n & 0x8000 ? n - 0x10000 : n;
  }

  u32le(offset: number, context: string): number {
    this.require(offset, 4, context);
    return (
      this.bytes[offset]
      | (this.bytes[offset + 1] << 8)
      | (this.bytes[offset + 2] << 16)
      | (this.bytes[offset + 3] << 24)
    ) >>> 0;
  }

  i32le(offset: number, context: string): number {
    return this.u32le(offset, context) | 0;
  }

  s32be(offset: number, context: string): number {
    return this.u32be(offset, context) | 0;
  }

  u32be(offset: number, context: string): number {
    this.require(offset, 4, context);
    return (
      (this.bytes[offset] << 24)
      | (this.bytes[offset + 1] << 16)
      | (this.bytes[offset + 2] << 8)
      | this.bytes[offset + 3]
    ) >>> 0;
  }

  ascii(offset: number, length: number, context: string): string {
    this.require(offset, length, context);
    return ascii(this.bytes, offset, length);
  }
}

function streamKind(magic: string): Nus3StreamKind {
  switch (magic) {
    case 'BNSF':
      return 'bnsf';
    case 'IDSP':
      return 'idsp';
    case 'RIFF':
      return 'riff';
    case 'OggS':
      return 'ogg';
    case 'OPUS':
    case 'lopu':
    case 'lopus':
      return 'opus';
    default:
      return 'unknown';
  }
}

function parseBnsf(reader: Reader, offset: number, size: number): BnsfMetadata | undefined {
  if (size < 40) return undefined;
  if (reader.ascii(offset, 4, 'BNSF magic') !== 'BNSF') return undefined;

  const base = {
    format: 'BNSF' as const,
    declaredSize: reader.u32be(offset + 4, 'BNSF declared size'),
    codec: reader.ascii(offset + 8, 4, 'BNSF codec'),
  };
  let sfmt: Omit<BnsfMetadata, 'format' | 'declaredSize' | 'codec' | 'dataChunk' | 'dataOffset' | 'dataSize' | 'loopStart' | 'loopEnd'> | undefined;
  let dataChunk: string | undefined;
  let dataOffset: number | undefined;
  let dataSize: number | undefined;
  let loopStart: number | undefined;
  let loopEnd: number | undefined;

  let pos = offset + 0x0c;
  const end = offset + size;
  while (pos + 8 <= end) {
    const chunk = reader.ascii(pos, 4, 'BNSF chunk id');
    const chunkSize = reader.u32be(pos + 4, `BNSF ${chunk} size`);
    const payload = pos + 8;
    reader.require(payload, chunkSize, `BNSF ${chunk} payload`);
    if (chunk === 'sfmt' && chunkSize >= 0x14) {
      sfmt = {
        formatChunk: chunk,
        formatChunkSize: chunkSize,
        flags: reader.u16be(payload, 'BNSF flags'),
        channels: reader.u16be(payload + 2, 'BNSF channels'),
        sampleRate: reader.s32be(payload + 4, 'BNSF sample rate'),
        sampleCount: reader.s32be(payload + 8, 'BNSF sample count'),
        loopAdjust: reader.s32be(payload + 0x0c, 'BNSF loop adjust'),
        blockSize: reader.u16be(payload + 0x10, 'BNSF block size'),
        blockSamples: reader.u16be(payload + 0x12, 'BNSF block samples'),
      };
    } else if (chunk === 'sdat') {
      dataChunk = chunk;
      dataOffset = payload;
      dataSize = chunkSize;
    } else if (chunk === 'loop' && chunkSize >= 8) {
      loopStart = reader.s32be(payload, 'BNSF loop start');
      loopEnd = reader.s32be(payload + 4, 'BNSF loop end') + 1;
    }
    pos = payload + chunkSize;
  }

  if (!sfmt) return undefined;
  return { ...base, ...sfmt, dataChunk, dataOffset, dataSize, loopStart, loopEnd };
}

function parseIdsp(reader: Reader, offset: number, size: number): IdspMetadata | undefined {
  if (size < 20) return undefined;
  if (reader.ascii(offset, 4, 'IDSP magic') !== 'IDSP') return undefined;
  const metadata: IdspMetadata = {
    format: 'IDSP',
    channels: reader.u32be(offset + 8, 'IDSP channels'),
    sampleRate: reader.u32be(offset + 12, 'IDSP sample rate'),
    sampleCount: reader.u32be(offset + 16, 'IDSP sample count'),
  };
  if (size < 0x30) return metadata;

  const channelHeaderRelative = reader.u32be(offset + 0x20, 'IDSP channel header offset');
  const channelHeaderSize = reader.u32be(offset + 0x24, 'IDSP channel header size');
  const dataRelative = reader.u32be(offset + 0x28, 'IDSP data offset');
  const channelDataSize = reader.u32be(offset + 0x2c, 'IDSP channel data size');
  const channelHeaderOffset = offset + channelHeaderRelative;
  const dataOffset = offset + dataRelative;
  reader.require(channelHeaderOffset, channelHeaderSize * metadata.channels, 'IDSP channel headers');
  reader.require(dataOffset, channelDataSize * metadata.channels, 'IDSP channel data');
  metadata.channelHeaderOffset = channelHeaderOffset;
  metadata.channelHeaderSize = channelHeaderSize;
  metadata.dataOffset = dataOffset;
  metadata.channelDataSize = channelDataSize;
  metadata.channelHeaders = Array.from({ length: metadata.channels }, (_, index) => {
    const headerOffset = channelHeaderOffset + index * channelHeaderSize;
    return {
      index,
      headerOffset,
      sampleCount: reader.u32be(headerOffset, `IDSP channel ${index} sample count`),
      nibbleCount: reader.u32be(headerOffset + 0x04, `IDSP channel ${index} nibble count`),
      sampleRate: reader.u32be(headerOffset + 0x08, `IDSP channel ${index} sample rate`),
      loopFlag: reader.u16be(headerOffset + 0x0c, `IDSP channel ${index} loop flag`),
      format: reader.u16be(headerOffset + 0x0e, `IDSP channel ${index} format`),
      loopStartNibble: reader.u32be(headerOffset + 0x10, `IDSP channel ${index} loop start`),
      loopEndNibble: reader.u32be(headerOffset + 0x14, `IDSP channel ${index} loop end`),
      currentAddress: reader.u32be(headerOffset + 0x18, `IDSP channel ${index} current address`),
      coefficients: Array.from({ length: 16 }, (_, coef) => (
        reader.s16be(headerOffset + 0x1c + coef * 2, `IDSP channel ${index} coefficient ${coef}`)
      )),
      gain: reader.u16be(headerOffset + 0x3c, `IDSP channel ${index} gain`),
      initialPredictorScale: reader.u16be(headerOffset + 0x3e, `IDSP channel ${index} initial predictor scale`),
      initialHistory1: reader.s16be(headerOffset + 0x40, `IDSP channel ${index} initial history 1`),
      initialHistory2: reader.s16be(headerOffset + 0x42, `IDSP channel ${index} initial history 2`),
      loopPredictorScale: reader.u16be(headerOffset + 0x44, `IDSP channel ${index} loop predictor scale`),
      loopHistory1: reader.s16be(headerOffset + 0x46, `IDSP channel ${index} loop history 1`),
      loopHistory2: reader.s16be(headerOffset + 0x48, `IDSP channel ${index} loop history 2`),
    };
  });
  return metadata;
}

function parseRiffWave(reader: Reader, offset: number, size: number): RiffWaveMetadata | undefined {
  if (size < 36) return undefined;
  if (reader.ascii(offset, 4, 'RIFF magic') !== 'RIFF') return undefined;
  if (reader.ascii(offset + 8, 4, 'RIFF type') !== 'WAVE') return undefined;

  let pos = offset + 12;
  const end = offset + size;
  while (pos + 8 <= end) {
    const id = reader.ascii(pos, 4, 'RIFF chunk id');
    const chunkSize = reader.u32le(pos + 4, 'RIFF chunk size');
    const data = pos + 8;
    if (data + chunkSize > end) return undefined;
    if (id === 'fmt ' && chunkSize >= 16) {
      return {
        format: 'RIFF',
        waveFormat: reader.u16le(data, 'RIFF wave format'),
        channels: reader.u16le(data + 2, 'RIFF channels'),
        sampleRate: reader.u32le(data + 4, 'RIFF sample rate'),
        bitsPerSample: reader.u16le(data + 14, 'RIFF bits per sample'),
      };
    }
    pos = data + align4(chunkSize);
  }
  return undefined;
}

function parseStream(reader: Reader, pack: Nus3Section, packOffset: number, size: number): Nus3Stream {
  if (size === 0) {
    throw new Nus3ParseError(`TONE stream at PACK+${packOffset}: zero byte stream`);
  }
  if (packOffset + size > pack.size) {
    throw new Nus3ParseError(
      `TONE stream at PACK+${packOffset}: ${size} bytes exceeds PACK size ${pack.size}`,
    );
  }
  const absoluteOffset = pack.dataOffset + packOffset;
  const magic = reader.ascii(absoluteOffset, Math.min(4, size), 'embedded stream magic');
  const kind = streamKind(magic);
  const stream: Nus3Stream = { kind, magic, packOffset, absoluteOffset, size };
  if (kind === 'bnsf') stream.metadata = parseBnsf(reader, absoluteOffset, size);
  if (kind === 'idsp') stream.metadata = parseIdsp(reader, absoluteOffset, size);
  if (kind === 'riff') stream.metadata = parseRiffWave(reader, absoluteOffset, size);
  return stream;
}

const TONE_STREAM_INFO_SAMPLE_RATES = new Set([32000, 44100, 48000]);
const MAX_DEMO_START_MS = 60 * 60 * 1000;

function parseToneDemoStart(
  reader: Reader,
  tone: Nus3Tone,
  descriptorBase: number,
): void {
  const scanStart = Math.max(descriptorBase + 16, 4);
  const relEnd = tone.recordSize - 8;
  for (let rel = scanStart; rel <= relEnd; rel += 4) {
    const sentinel = reader.i32le(tone.recordOffset + rel, `TONE ${tone.index} demo sentinel`);
    const sampleRate = reader.i32le(tone.recordOffset + rel + 4, `TONE ${tone.index} stream-info sample rate`);
    if (sentinel !== -1 || !TONE_STREAM_INFO_SAMPLE_RATES.has(sampleRate)) continue;

    const demoStartOffset = tone.recordOffset + rel - 4;
    const raw = reader.i32le(demoStartOffset, `TONE ${tone.index} demo start`);
    if (raw < -1 || raw > MAX_DEMO_START_MS) continue;

    tone.demoStartOffset = demoStartOffset;
    tone.demoStartRaw = raw;
    if (raw >= 0) tone.demoStartMs = raw;
    return;
  }
}

function parseToneRecord(
  reader: Reader,
  index: number,
  recordOffset: number,
  recordSize: number,
  pack?: Nus3Section,
): Nus3Tone {
  const tone: Nus3Tone = { index, recordOffset, recordSize };
  if (recordSize >= 4) tone.toneId = reader.u32le(recordOffset, `TONE ${index} id`);
  if (recordSize < 13) {
    tone.noStreamReason = `short record (${recordSize} bytes)`;
    return tone;
  }

  const nameLength = reader.u8(recordOffset + 12, `TONE ${index} name length`);
  const descriptorBase = 12 + align4(1 + nameLength);
  if (12 + 1 + nameLength <= recordSize) {
    tone.name = trimNulls(reader.ascii(recordOffset + 13, nameLength, `TONE ${index} name`));
  }
  if (descriptorBase + 16 > recordSize) {
    tone.noStreamReason = `no stream descriptor (name length ${nameLength}, record ${recordSize} bytes)`;
    return tone;
  }
  if (!pack) {
    tone.noStreamReason = 'no PACK section';
    return tone;
  }

  const packOffset = reader.u32le(recordOffset + descriptorBase + 8, `TONE ${index} PACK offset`);
  const packSize = reader.u32le(recordOffset + descriptorBase + 12, `TONE ${index} PACK size`);
  tone.packOffset = packOffset;
  tone.packOffsetFieldOffset = recordOffset + descriptorBase + 8;
  tone.packSize = packSize;
  tone.packSizeFieldOffset = recordOffset + descriptorBase + 12;
  tone.stream = parseStream(reader, pack, packOffset, packSize);
  parseToneDemoStart(reader, tone, descriptorBase);
  return tone;
}

function parseTones(reader: Reader, toneSection: Nus3Section | undefined, pack: Nus3Section | undefined) {
  if (!toneSection) return [];
  const dataStart = toneSection.dataOffset;
  const sectionEnd = toneSection.dataOffset + toneSection.size;
  const count = reader.u32le(dataStart, 'TONE count');
  reader.require(dataStart + 4, count * 8, 'TONE record table');
  if (dataStart + 4 + count * 8 > sectionEnd) {
    throw new Nus3ParseError(`TONE record table exceeds section (${count} records)`);
  }
  return Array.from({ length: count }, (_, index) => {
    const entryOffset = dataStart + 4 + index * 8;
    const relativeOffset = reader.u32le(entryOffset, `TONE ${index} relative offset`);
    const recordSize = reader.u32le(entryOffset + 4, `TONE ${index} record size`);
    const recordOffset = dataStart + relativeOffset;
    if (recordOffset + recordSize > sectionEnd) {
      throw new Nus3ParseError(
        `TONE ${index} record ${relativeOffset}+${recordSize} exceeds TONE size ${toneSection.size}`,
      );
    }
    return parseToneRecord(reader, index, recordOffset, recordSize, pack);
  });
}

/**
 * Magic-only sniff, cheap enough to run on a file's first four bytes. Says the
 * container is a nus3bank, not that it parses — callers that need structure use
 * parseNus3Bank.
 */
export function isNus3BankBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && ascii(bytes, 0, 4) === 'NUS3';
}

/**
 * Read the per-bank id stored after the BINF name.
 *
 * This deliberately needs only the file prefix through BINF, not the PACK
 * payload, so callers can census a sound directory without reading every
 * embedded audio stream.
 */
export function readNus3BankId(bytes: Uint8Array): number {
  const reader = new Reader(bytes);
  reader.require(0, 24, 'NUS3 header');
  if (reader.ascii(0, 4, 'NUS3 magic') !== 'NUS3') {
    throw new Nus3ParseError('Expected NUS3 magic');
  }
  if (reader.ascii(8, 8, 'BANKTOC magic') !== 'BANKTOC ') {
    throw new Nus3ParseError('Expected BANKTOC section');
  }
  const tocSize = reader.u32le(16, 'BANKTOC size');
  const sectionCount = reader.u32le(20, 'BANKTOC section count');
  reader.require(20, tocSize, 'BANKTOC payload');
  if (4 + sectionCount * 8 > tocSize) {
    throw new Nus3ParseError(`BANKTOC table too small for ${sectionCount} section(s)`);
  }

  let sectionOffset = 20 + tocSize;
  for (let index = 0; index < sectionCount; index++) {
    const entryOffset = 24 + index * 8;
    const id = reader.ascii(entryOffset, 4, `BANKTOC entry ${index} id`);
    const size = reader.u32le(entryOffset + 4, `BANKTOC entry ${index} size`);
    if (id !== 'BINF') {
      sectionOffset += 8 + size;
      continue;
    }

    reader.require(sectionOffset, 8, 'BINF section header');
    if (reader.ascii(sectionOffset, 4, 'BINF section id') !== 'BINF') {
      throw new Nus3ParseError('BANKTOC BINF entry does not match its section');
    }
    const actualSize = reader.u32le(sectionOffset + 4, 'BINF section size');
    if (actualSize !== size) {
      throw new Nus3ParseError(`BANKTOC BINF size ${size}, section has ${actualSize}`);
    }
    const dataOffset = sectionOffset + 8;
    const nameOffset = dataOffset + 8;
    const declaredLength = reader.u8(nameOffset, 'BINF name length');
    const bankIdOffset = nameOffset + align4(1 + declaredLength);
    if (bankIdOffset + 4 > dataOffset + size) {
      throw new Nus3ParseError('BINF name leaves no room for its bank id');
    }
    return reader.u32le(bankIdOffset, 'BINF bank id');
  }
  throw new Nus3ParseError('The nus3bank has no BINF section');
}

export function parseNus3Bank(bytes: Uint8Array): Nus3Bank {
  const reader = new Reader(bytes);
  reader.require(0, 24, 'NUS3 header');
  if (reader.ascii(0, 4, 'NUS3 magic') !== 'NUS3') {
    throw new Nus3ParseError('Expected NUS3 magic');
  }
  const warnings: string[] = [];
  const declaredSize = reader.u32le(4, 'NUS3 declared size');
  if (declaredSize + 8 !== reader.length) {
    warnings.push(`NUS3 size field is ${declaredSize}, file payload is ${reader.length - 8}`);
  }
  if (reader.ascii(8, 8, 'BANKTOC magic') !== 'BANKTOC ') {
    throw new Nus3ParseError('Expected BANKTOC section');
  }
  const tocSize = reader.u32le(16, 'BANKTOC size');
  const sectionCount = reader.u32le(20, 'BANKTOC section count');
  const tocDataOffset = 20;
  const tocEnd = tocDataOffset + tocSize;
  reader.require(tocDataOffset, tocSize, 'BANKTOC payload');
  if (4 + sectionCount * 8 > tocSize) {
    throw new Nus3ParseError(`BANKTOC table too small for ${sectionCount} section(s)`);
  }

  const entries = Array.from({ length: sectionCount }, (_, index) => {
    const offset = 24 + index * 8;
    return {
      id: reader.ascii(offset, 4, `BANKTOC entry ${index} id`),
      size: reader.u32le(offset + 4, `BANKTOC entry ${index} size`),
    };
  });

  let sectionOffset = tocEnd;
  const sections: Nus3Section[] = entries.map((entry, index) => {
    reader.require(sectionOffset, 8 + entry.size, `section ${entry.id}`);
    const actualId = reader.ascii(sectionOffset, 4, `section ${index} id`);
    const actualSize = reader.u32le(sectionOffset + 4, `section ${index} size`);
    if (actualId !== entry.id) {
      throw new Nus3ParseError(`BANKTOC entry ${index} expected ${entry.id}, found ${actualId}`);
    }
    if (actualSize !== entry.size) {
      throw new Nus3ParseError(`BANKTOC entry ${entry.id} size ${entry.size}, section has ${actualSize}`);
    }
    const section = {
      id: actualId,
      offset: sectionOffset,
      dataOffset: sectionOffset + 8,
      size: actualSize,
    };
    sectionOffset += 8 + actualSize;
    return section;
  });
  if (sectionOffset !== reader.length) {
    warnings.push(`section data ends at ${sectionOffset}, file length is ${reader.length}`);
  }

  const toneSection = sections.find((s) => s.id === 'TONE');
  const pack = sections.find((s) => s.id === 'PACK');
  return {
    byteLength: reader.length,
    declaredSize,
    sections,
    tones: parseTones(reader, toneSection, pack),
    warnings,
  };
}
