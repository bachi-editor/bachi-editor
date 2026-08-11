// Peak downsampling for the Sound tab waveform (PLAN 6.6/6.7). Reduces full
// planar PCM to a fixed number of min/max buckets so the UI keeps only a small
// envelope in React state, never a duplicate of the decoded PCM (which lives in
// the Web Audio buffer cache). Pure and side-effect free.

export interface WaveformPeaks {
  /** Number of buckets in `min`/`max`. */
  length: number;
  /** Per-bucket minimum of the mono-mixed signal, in [-1, 1]. */
  min: Float32Array;
  /** Per-bucket maximum of the mono-mixed signal, in [-1, 1]. */
  max: Float32Array;
}

/**
 * Downsample planar PCM into `buckets` min/max pairs over a mono mix of the
 * channels. Buckets with no samples (when frames < buckets) collapse to 0/0.
 */
export function computePeaks(channelData: Float32Array[], buckets: number): WaveformPeaks {
  const length = Math.max(1, Math.floor(buckets));
  const min = new Float32Array(length);
  const max = new Float32Array(length);

  const channels = channelData.length;
  const frames = channels > 0 ? channelData[0].length : 0;
  if (channels === 0 || frames === 0) {
    return { length, min, max };
  }

  const samplesPerBucket = frames / length;
  for (let b = 0; b < length; b++) {
    const start = Math.floor(b * samplesPerBucket);
    const end = b === length - 1 ? frames : Math.floor((b + 1) * samplesPerBucket);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = start; i < end; i++) {
      let sum = 0;
      for (let c = 0; c < channels; c++) sum += channelData[c][i];
      const v = sum / channels;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (lo === Infinity) {
      lo = 0;
      hi = 0;
    }
    min[b] = lo;
    max[b] = hi;
  }

  return { length, min, max };
}
