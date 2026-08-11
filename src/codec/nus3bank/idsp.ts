import { IdspMetadata, Nus3ParseError, Nus3Stream } from './types';

export interface IdspDataLayout {
  channels: number;
  sampleRate: number;
  sampleCount: number;
  channelHeaderOffset: number;
  channelHeaderSize: number;
  dataOffset: number;
  channelDataSize: number;
  durationSeconds: number;
}

export interface IdspChannelDataRange {
  offset: number;
  size: number;
}

function metadataFor(stream: Nus3Stream): IdspMetadata {
  if (stream.metadata?.format !== 'IDSP') {
    throw new Nus3ParseError(`Expected IDSP stream, found ${stream.magic}`);
  }
  return stream.metadata;
}

export function getIdspDataLayout(stream: Nus3Stream): IdspDataLayout {
  const metadata = metadataFor(stream);
  if (!metadata.channelHeaderOffset || !metadata.channelHeaderSize || !metadata.dataOffset || !metadata.channelDataSize) {
    throw new Nus3ParseError('IDSP stream is missing channel header or data offsets');
  }
  if (metadata.channels <= 0 || metadata.channelDataSize <= 0) {
    throw new Nus3ParseError('IDSP stream has invalid channel metadata');
  }
  if (!metadata.channelHeaders || metadata.channelHeaders.length !== metadata.channels) {
    throw new Nus3ParseError('IDSP stream is missing channel DSP headers');
  }
  for (const header of metadata.channelHeaders) {
    if (header.sampleCount !== metadata.sampleCount) {
      throw new Nus3ParseError(`IDSP channel ${header.index} sample count mismatch`);
    }
    if (header.sampleRate !== metadata.sampleRate) {
      throw new Nus3ParseError(`IDSP channel ${header.index} sample rate mismatch`);
    }
    if (header.coefficients.length !== 16) {
      throw new Nus3ParseError(`IDSP channel ${header.index} coefficient table is incomplete`);
    }
  }

  return {
    channels: metadata.channels,
    sampleRate: metadata.sampleRate,
    sampleCount: metadata.sampleCount,
    channelHeaderOffset: metadata.channelHeaderOffset,
    channelHeaderSize: metadata.channelHeaderSize,
    dataOffset: metadata.dataOffset,
    channelDataSize: metadata.channelDataSize,
    durationSeconds: metadata.sampleCount / metadata.sampleRate,
  };
}

export function getIdspChannelDataRange(layout: IdspDataLayout, channel: number): IdspChannelDataRange {
  if (!Number.isInteger(channel) || channel < 0 || channel >= layout.channels) {
    throw new RangeError(`IDSP channel ${channel} is outside 0..${layout.channels - 1}`);
  }
  return {
    offset: layout.dataOffset + channel * layout.channelDataSize,
    size: layout.channelDataSize,
  };
}
