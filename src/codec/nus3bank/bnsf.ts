import { BnsfMetadata, Nus3ParseError, Nus3Stream } from './types';

export interface BnsfFrameLayout {
  codec: string;
  channels: number;
  sampleRate: number;
  sampleCount: number;
  blockSize: number;
  blockSamples: number;
  frameSizePerChannel: number;
  dataOffset: number;
  dataSize: number;
  blockCount: number;
  durationSeconds: number;
}

export interface BnsfFrameRange {
  offset: number;
  size: number;
}

function metadataFor(stream: Nus3Stream): BnsfMetadata {
  if (stream.metadata?.format !== 'BNSF') {
    throw new Nus3ParseError(`Expected BNSF stream, found ${stream.magic}`);
  }
  return stream.metadata;
}

export function getBnsfFrameLayout(stream: Nus3Stream): BnsfFrameLayout {
  const metadata = metadataFor(stream);
  if (metadata.codec !== 'IS22') {
    throw new Nus3ParseError(`Unsupported BNSF codec ${metadata.codec}`);
  }
  if (metadata.flags !== 0) {
    throw new Nus3ParseError(`Encrypted/flagged BNSF streams are not supported (flags=${metadata.flags})`);
  }
  if (!metadata.dataOffset || !metadata.dataSize) {
    throw new Nus3ParseError('BNSF stream is missing an sdat chunk');
  }
  if (metadata.channels <= 0 || metadata.blockSize <= 0 || metadata.blockSamples <= 0) {
    throw new Nus3ParseError('BNSF stream has invalid channel or block metadata');
  }
  if (metadata.blockSize % metadata.channels !== 0) {
    throw new Nus3ParseError(`BNSF block size ${metadata.blockSize} is not divisible by ${metadata.channels} channel(s)`);
  }
  if (metadata.dataSize % metadata.blockSize !== 0) {
    throw new Nus3ParseError(`BNSF data size ${metadata.dataSize} is not aligned to block size ${metadata.blockSize}`);
  }

  const blockCount = metadata.dataSize / metadata.blockSize;
  return {
    codec: metadata.codec,
    channels: metadata.channels,
    sampleRate: metadata.sampleRate,
    sampleCount: metadata.sampleCount,
    blockSize: metadata.blockSize,
    blockSamples: metadata.blockSamples,
    frameSizePerChannel: metadata.blockSize / metadata.channels,
    dataOffset: metadata.dataOffset,
    dataSize: metadata.dataSize,
    blockCount,
    durationSeconds: metadata.sampleCount / metadata.sampleRate,
  };
}

export function getBnsfFrameRange(layout: BnsfFrameLayout, blockIndex: number, channel: number): BnsfFrameRange {
  if (!Number.isInteger(blockIndex) || blockIndex < 0 || blockIndex >= layout.blockCount) {
    throw new RangeError(`BNSF block index ${blockIndex} is outside 0..${layout.blockCount - 1}`);
  }
  if (!Number.isInteger(channel) || channel < 0 || channel >= layout.channels) {
    throw new RangeError(`BNSF channel ${channel} is outside 0..${layout.channels - 1}`);
  }
  return {
    offset: layout.dataOffset + blockIndex * layout.blockSize + channel * layout.frameSizePerChannel,
    size: layout.frameSizePerChannel,
  };
}
