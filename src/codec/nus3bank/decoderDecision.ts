import { BnsfMetadata, Nus3DecoderDecision, Nus3Stream } from './types';

function bnsfMetadata(stream: Nus3Stream): BnsfMetadata | undefined {
  return stream.metadata?.format === 'BNSF' ? stream.metadata : undefined;
}

export function decideNus3Decoder(stream: Nus3Stream): Nus3DecoderDecision {
  if (stream.kind === 'bnsf') {
    const metadata = bnsfMetadata(stream);
    if (metadata?.codec === 'IS22') {
      return {
        readiness: 'ready',
        decoder: 'g719-wasm',
        codec: 'BNSF/IS22 (G.719/Siren22)',
        reason: 'Supported when the user supplies a compatible G.719/Siren22 WASM module.',
      };
    }
    if (metadata?.codec === 'IS14') {
      return {
        readiness: 'unsupported',
        decoder: 'unsupported',
        codec: 'BNSF/IS14 (G.722.1/Siren14)',
        reason: 'IS14 is not present in the CHN song corpus and needs separate validation.',
      };
    }
    return {
      readiness: 'unsupported',
      decoder: 'unsupported',
      codec: `BNSF/${metadata?.codec ?? 'unknown'}`,
      reason: 'Unknown BNSF subcodec.',
    };
  }

  if (stream.kind === 'idsp') {
    return {
      readiness: 'ready',
      decoder: 'idsp-typescript',
      codec: 'IDSP (Nintendo DSP-ADPCM)',
      reason: 'Decoded by the TypeScript Nintendo DSP-ADPCM decoder (decodeIdspToPcm).',
    };
  }

  if (stream.kind === 'riff' || stream.kind === 'ogg' || stream.kind === 'opus') {
    return {
      readiness: 'browser-native',
      decoder: 'browser-native',
      codec: stream.kind.toUpperCase(),
      reason: 'This stream kind can be handed to browser audio decoding once the audio service exists.',
    };
  }

  return {
    readiness: 'unsupported',
    decoder: 'unsupported',
    codec: stream.magic,
    reason: 'No decoder path is known for this stream magic.',
  };
}
