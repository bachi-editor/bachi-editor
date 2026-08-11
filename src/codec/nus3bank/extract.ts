import { Nus3Bank, Nus3Stream, Nus3StreamKind, Nus3Tone, Nus3ToneSelection } from './types';

const DEFAULT_PLAYABLE_KINDS: readonly Nus3StreamKind[] = ['bnsf', 'idsp', 'riff', 'ogg', 'opus'];

function normalizeName(name: string | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

function playableTones(bank: Nus3Bank, playableKinds: readonly Nus3StreamKind[]): Nus3Tone[] {
  const allowed = new Set(playableKinds);
  return bank.tones.filter((tone) => tone.stream && allowed.has(tone.stream.kind));
}

function largest(a: Nus3Tone, b: Nus3Tone): Nus3Tone {
  return (b.stream?.size ?? 0) > (a.stream?.size ?? 0) ? b : a;
}

/**
 * Select the stream that should back playback for a bank.
 *
 * Policy mirrors PLAN 6.3: prefer an exact tone-name match for the resolved
 * sound filename stem, then the largest IDSP stream for ambiguous multi-tone
 * banks, then the largest known playable stream.
 */
export function selectPlayableTone(
  bank: Nus3Bank,
  preferredStem?: string,
  playableKinds: readonly Nus3StreamKind[] = DEFAULT_PLAYABLE_KINDS,
): Nus3ToneSelection | undefined {
  const candidates = playableTones(bank, playableKinds);
  if (candidates.length === 0) return undefined;

  const preferred = normalizeName(preferredStem);
  if (preferred) {
    const match = candidates.find((tone) => normalizeName(tone.name) === preferred);
    if (match?.stream) {
      return {
        tone: match,
        stream: match.stream,
        alternates: candidates.filter((tone) => tone !== match),
        reason: 'name-match',
        ambiguous: candidates.length > 1,
      };
    }
  }

  if (candidates.length === 1) {
    const tone = candidates[0];
    return {
      tone,
      stream: tone.stream as Nus3Stream,
      alternates: [],
      reason: 'single',
      ambiguous: false,
    };
  }

  const idsp = candidates.filter((tone) => tone.stream?.kind === 'idsp');
  if (idsp.length > 0) {
    const tone = idsp.reduce(largest);
    return {
      tone,
      stream: tone.stream as Nus3Stream,
      alternates: candidates.filter((candidate) => candidate !== tone),
      reason: 'largest-idsp',
      ambiguous: true,
    };
  }

  const tone = candidates.reduce(largest);
  return {
    tone,
    stream: tone.stream as Nus3Stream,
    alternates: candidates.filter((candidate) => candidate !== tone),
    reason: 'largest-stream',
    ambiguous: true,
  };
}

export function extractStreamBytes(bankBytes: Uint8Array, stream: Nus3Stream): Uint8Array {
  return bankBytes.subarray(stream.absoluteOffset, stream.absoluteOffset + stream.size);
}
