// The app's single audio service (PLAN 6.6). Owns one AudioContext, a
// session decode cache, and a Web Audio transport (play/pause/seek/stop/
// current-time/volume) over the decoded bank buffer. Decoding runs in
// decodeWorker.ts so a ~0.3-0.4s song decode never janks the UI; a
// main-thread fallback keeps it working where Worker is unavailable.
//
// This module touches Web Audio + Worker globals. Unit tests cover it with
// small fakes for those browser APIs; the pure helpers (transport.ts,
// waveform.ts, decodeJob.ts) carry the decode/math coverage.

import { runDecodeJob, type DecodeJobResult } from './decodeJob';
import { loadG719DecoderWasm } from '../fs/idb';
import { computeCurrentTime, clamp } from './transport';
import type { BankLoop } from './decodeBank';
import type { WaveformPeaks } from './waveform';
import type { DecodeWorkerRequest, DecodeWorkerResponse } from './workerProtocol';

const DEFAULT_PEAK_BUCKETS = 1200;
const DEFAULT_MAX_CACHED = 4;

export interface LoadedSound {
  cacheKey: string;
  audioBuffer: AudioBuffer;
  duration: number;
  sampleRate: number;
  channels: number;
  codec: string;
  toneName?: string;
  loop?: BankLoop;
  peaks: WaveformPeaks;
}

export type PlayerStatus = 'idle' | 'decoding' | 'ready' | 'error';

export interface PlayerState {
  status: PlayerStatus;
  /** cacheKey of the sound the transport is bound to, when ready. */
  cacheKey?: string;
  playing: boolean;
  duration: number;
  volume: number;
  error?: string;
}

type PlayerListener = (state: PlayerState) => void;

type AudioContextCtor = typeof AudioContext;

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // slice() copies into a fresh, exactly-sized ArrayBuffer so transferring it
  // to the worker never detaches the caller's bytes.
  return bytes.slice().buffer as ArrayBuffer;
}

/** Stable session cache key for a bank: content digest + size + mtime. */
export function soundCacheKey(parts: { sha256?: string; size: number; modified?: number }): string {
  return `${parts.sha256 ?? 'nohash'}:${parts.size}:${parts.modified ?? 0}`;
}

class SoundbankPlayer {
  private ctx: AudioContext | null = null;
  private gain: GainNode | null = null;
  private worker: Worker | null = null;
  private workerUnavailable = false;
  private workerSeq = 0;
  private readonly pending = new Map<number, { resolve: (r: DecodeJobResult) => void; reject: (e: Error) => void }>();

  private readonly cache = new Map<string, LoadedSound>();
  private maxCached = DEFAULT_MAX_CACHED;
  private peakBuckets = DEFAULT_PEAK_BUCKETS;

  private current: LoadedSound | null = null;
  private source: AudioBufferSourceNode | null = null;
  private anchorTime = 0;
  private anchorContextTime = 0;
  private playing = false;
  private volume = 1;
  private status: PlayerStatus = 'idle';
  private error: string | undefined;
  /** Monotonic token so a slow decode can't clobber a newer load. */
  private loadToken = 0;

  private readonly listeners = new Set<PlayerListener>();

  // ---- state / subscription ------------------------------------------------

  getState(): PlayerState {
    return {
      status: this.status,
      cacheKey: this.current?.cacheKey,
      playing: this.playing,
      duration: this.current?.duration ?? 0,
      volume: this.volume,
      error: this.error,
    };
  }

  subscribe(listener: PlayerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }

  // ---- AudioContext --------------------------------------------------------

  private getContext(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        (typeof window !== 'undefined' &&
          (window.AudioContext ??
            (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext)) ||
        undefined;
      if (!Ctor) throw new Error('Web Audio is not available in this browser.');
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  private getGain(): GainNode {
    const ctx = this.getContext();
    if (!this.gain) {
      this.gain = ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(ctx.destination);
    }
    return this.gain;
  }

  /** Resume the context after a user gesture to satisfy autoplay rules. */
  async ensureContextResumed(): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') await ctx.resume();
  }

  // ---- decode + cache ------------------------------------------------------

  private getWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (this.workerUnavailable || typeof Worker === 'undefined') return null;
    try {
      const worker = new Worker(new URL('./decodeWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<DecodeWorkerResponse>) => this.onWorkerMessage(event.data);
      worker.onerror = () => this.failAllPending('The audio decode worker crashed.');
      this.worker = worker;
    } catch {
      this.workerUnavailable = true;
      this.worker = null;
    }
    return this.worker;
  }

  private onWorkerMessage(data: DecodeWorkerResponse): void {
    const entry = this.pending.get(data.id);
    if (!entry) return;
    this.pending.delete(data.id);
    if (data.ok) entry.resolve(data.result);
    else entry.reject(new Error(data.error));
  }

  private failAllPending(message: string): void {
    for (const entry of this.pending.values()) entry.reject(new Error(message));
    this.pending.clear();
  }

  private async decode(bytes: Uint8Array, preferredStem?: string): Promise<DecodeJobResult> {
    let storedDecoder: Awaited<ReturnType<typeof loadG719DecoderWasm>>;
    try {
      storedDecoder = await loadG719DecoderWasm();
    } catch {
      // Treat storage failure like a missing optional decoder. IDSP playback is
      // still available, while BNSF reports the normal decoder-missing error.
      storedDecoder = undefined;
    }
    const g719Wasm = storedDecoder?.bytes.slice(0);
    const worker = this.getWorker();
    if (!worker) {
      return runDecodeJob({
        bankBytes: bytes,
        g719Wasm: g719Wasm ? new Uint8Array(g719Wasm) : undefined,
        preferredStem,
        peakBuckets: this.peakBuckets,
      });
    }
    return new Promise<DecodeJobResult>((resolve, reject) => {
      const id = ++this.workerSeq;
      this.pending.set(id, { resolve, reject });
      const bankBytes = exactArrayBuffer(bytes);
      const message: DecodeWorkerRequest = {
        id,
        bankBytes,
        g719Wasm,
        preferredStem,
        peakBuckets: this.peakBuckets,
      };
      const transfer = g719Wasm ? [bankBytes, g719Wasm] : [bankBytes];
      worker.postMessage(message, transfer);
    });
  }

  private buildBuffer(job: DecodeJobResult): AudioBuffer {
    if (job.samplesPerChannel <= 0 || job.channels <= 0) {
      throw new Error('Decoded audio is empty.');
    }
    const ctx = this.getContext();
    const buffer = ctx.createBuffer(job.channels, job.samplesPerChannel, job.sampleRate);
    for (let c = 0; c < job.channels; c++) {
      // Decoded channels are always fresh ArrayBuffer-backed Float32Arrays;
      // the generic Float32Array type just doesn't narrow that for copyToChannel.
      buffer.copyToChannel(job.channelData[c] as Float32Array<ArrayBuffer>, c);
    }
    return buffer;
  }

  private putCache(sound: LoadedSound): void {
    this.cache.delete(sound.cacheKey);
    this.cache.set(sound.cacheKey, sound);
    this.trimCache();
  }

  private trimCache(): void {
    while (this.cache.size > this.maxCached) {
      let evicted = false;
      for (const key of this.cache.keys()) {
        if (key === this.current?.cacheKey) continue;
        this.cache.delete(key);
        evicted = true;
        break;
      }
      if (!evicted) break;
    }
  }

  /**
   * Bind the transport to a bank, decoding (or reusing the cache) as needed.
   * Returns the loaded sound; a newer load that starts before this resolves
   * still returns its own sound but does not clobber the active transport.
   */
  async load(cacheKey: string, bytes: Uint8Array, preferredStem?: string): Promise<LoadedSound> {
    const token = ++this.loadToken;

    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (token === this.loadToken) this.bind(cached);
      else this.putCache(cached); // refresh LRU recency without rebinding
      return cached;
    }

    if (token === this.loadToken) {
      this.status = 'decoding';
      this.error = undefined;
      this.notify();
    }

    let sound: LoadedSound;
    try {
      const job = await this.decode(bytes, preferredStem);
      const audioBuffer = this.buildBuffer(job);
      sound = {
        cacheKey,
        audioBuffer,
        duration: job.durationSeconds,
        sampleRate: job.sampleRate,
        channels: job.channels,
        codec: job.codec,
        toneName: job.toneName,
        loop: job.loop,
        peaks: job.peaks,
      };
    } catch (err) {
      if (token === this.loadToken) {
        this.status = 'error';
        this.error = (err as Error).message;
        this.notify();
      }
      throw err;
    }

    this.putCache(sound);
    if (token === this.loadToken) this.bind(sound);
    return sound;
  }

  private bind(sound: LoadedSound): void {
    this.stopSource();
    this.current = sound;
    this.anchorTime = 0;
    this.playing = false;
    this.status = 'ready';
    this.error = undefined;
    this.putCache(sound); // mark most-recently-used
    this.notify();
  }

  // ---- transport -----------------------------------------------------------

  private stopSource(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        // already stopped
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  private startSource(offset: number): void {
    this.stopSource();
    const ctx = this.getContext();
    const source = ctx.createBufferSource();
    source.buffer = this.current!.audioBuffer;
    source.connect(this.getGain());
    source.onended = () => this.handleEnded(source);
    this.anchorTime = offset;
    this.anchorContextTime = ctx.currentTime;
    source.start(0, offset);
    this.source = source;
  }

  private handleEnded(source: AudioBufferSourceNode): void {
    if (source !== this.source) return; // stale node we already replaced
    this.source = null;
    this.playing = false;
    this.anchorTime = this.current?.duration ?? 0;
    this.notify();
  }

  play(fromSeconds?: number): void {
    if (!this.current) return;
    const duration = this.current.duration;
    let start = fromSeconds != null ? clamp(fromSeconds, 0, duration) : this.anchorTime;
    if (start >= duration) start = 0;
    this.startSource(start);
    this.playing = true;
    this.notify();
  }

  pause(): void {
    if (!this.playing) return;
    this.anchorTime = this.getCurrentTime();
    this.stopSource();
    this.playing = false;
    this.notify();
  }

  stop(): void {
    this.stopSource();
    this.anchorTime = 0;
    this.playing = false;
    this.notify();
  }

  seek(seconds: number): void {
    if (!this.current) return;
    const target = clamp(seconds, 0, this.current.duration);
    if (this.playing) this.startSource(target);
    else this.anchorTime = target;
    this.notify();
  }

  getCurrentTime(): number {
    if (!this.current) return 0;
    const contextTime = this.ctx ? this.ctx.currentTime : 0;
    return computeCurrentTime(
      {
        playing: this.playing,
        anchorTime: this.anchorTime,
        anchorContextTime: this.anchorContextTime,
        duration: this.current.duration,
      },
      contextTime,
    );
  }

  setVolume(value: number): void {
    this.volume = clamp(value, 0, 1);
    if (this.gain) this.gain.gain.value = this.volume;
    this.notify();
  }

  getVolume(): number {
    return this.volume;
  }

  /** Drop the transport binding without discarding the decode cache. */
  unbind(): void {
    this.stopSource();
    this.current = null;
    this.anchorTime = 0;
    this.playing = false;
    this.status = 'idle';
    this.error = undefined;
    this.notify();
  }

  /** Tear everything down (worker, context, cache) for a full reset. */
  release(): void {
    this.loadToken++;
    this.stopSource();
    this.failAllPending('Audio player was released.');
    this.worker?.terminate();
    this.worker = null;
    this.cache.clear();
    this.current = null;
    this.gain = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    this.playing = false;
    this.status = 'idle';
    this.error = undefined;
    this.notify();
  }
}

/** The single app-wide audio service. */
export const soundbankPlayer = new SoundbankPlayer();
