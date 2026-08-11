import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { soundbankPlayer } from '../../src/audio/soundbankPlayer';
import type { DecodeJobResult } from '../../src/audio/decodeJob';
import type { DecodeWorkerRequest, DecodeWorkerResponse } from '../../src/audio/workerProtocol';

class FakeAudioBuffer {
  readonly duration: number;
  readonly data: Float32Array[];

  constructor(readonly numberOfChannels: number, readonly length: number, readonly sampleRate: number) {
    this.duration = length / sampleRate;
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  copyToChannel(source: Float32Array, channelNumber: number): void {
    this.data[channelNumber].set(source.subarray(0, this.length));
  }
}

class FakeBufferSource {
  buffer: AudioBuffer | null = null;
  onended: (() => void) | null = null;
  readonly starts: Array<{ when: number; offset?: number }> = [];
  stopped = false;
  disconnected = false;

  connect(): void {
    // no-op
  }

  start(when: number, offset?: number): void {
    this.starts.push({ when, offset });
  }

  stop(): void {
    this.stopped = true;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

class FakeGain {
  readonly gain = { value: 1 };

  connect(): void {
    // no-op
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  currentTime = 0;
  state: AudioContextState = 'suspended';
  readonly destination = {};
  readonly sources: FakeBufferSource[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
    return new FakeAudioBuffer(numberOfChannels, length, sampleRate) as unknown as AudioBuffer;
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  createGain(): GainNode {
    return new FakeGain() as unknown as GainNode;
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent<DecodeWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly requests: DecodeWorkerRequest[] = [];
  terminated = false;

  constructor(_url: string | URL, _options?: WorkerOptions) {
    FakeWorker.instances.push(this);
  }

  postMessage(message: DecodeWorkerRequest): void {
    this.requests.push(message);
  }

  respond(index: number, result: DecodeJobResult): void {
    const request = this.requests[index];
    if (!request) throw new Error(`No worker request at index ${index}`);
    this.onmessage?.({ data: { id: request.id, ok: true, result } } as MessageEvent<DecodeWorkerResponse>);
  }

  fail(index: number, message: string): void {
    const request = this.requests[index];
    if (!request) throw new Error(`No worker request at index ${index}`);
    this.onmessage?.({ data: { id: request.id, ok: false, error: message } } as MessageEvent<DecodeWorkerResponse>);
  }

  terminate(): void {
    this.terminated = true;
  }
}

function makeJob(name: string, seconds = 10): DecodeJobResult {
  const sampleRate = 10;
  const samplesPerChannel = Math.round(seconds * sampleRate);
  const left = new Float32Array(samplesPerChannel);
  const right = new Float32Array(samplesPerChannel);
  for (let i = 0; i < samplesPerChannel; i++) {
    left[i] = i % 2 === 0 ? 0.25 : -0.25;
    right[i] = i % 3 === 0 ? 0.5 : -0.125;
  }
  return {
    sampleRate,
    channels: 2,
    samplesPerChannel,
    durationSeconds: seconds,
    codec: 'BNSF/IS22',
    toneName: name,
    channelData: [left, right],
    peaks: {
      length: 4,
      min: new Float32Array([-0.1, -0.2, -0.25, -0.3]),
      max: new Float32Array([0.2, 0.3, 0.4, 0.5]),
    },
  };
}

beforeEach(() => {
  vi.stubGlobal('window', { AudioContext: FakeAudioContext });
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  soundbankPlayer.release();
  vi.unstubAllGlobals();
  FakeAudioContext.instances = [];
  FakeWorker.instances = [];
});

describe('soundbankPlayer browser service', () => {
  test('loads through the worker, builds a buffer, and drives the transport', async () => {
    const states: string[] = [];
    const unsubscribe = soundbankPlayer.subscribe((state) => states.push(`${state.status}:${state.playing}`));

    const load = soundbankPlayer.load('sha-a:100:1', new Uint8Array([1, 2, 3]), 'song_a');
    expect(soundbankPlayer.getState().status).toBe('decoding');
    await Promise.resolve(); // optional decoder lookup completes before worker dispatch
    expect(FakeWorker.instances).toHaveLength(1);
    expect(FakeWorker.instances[0].requests).toHaveLength(1);
    expect(FakeWorker.instances[0].requests[0].preferredStem).toBe('song_a');
    expect(FakeWorker.instances[0].requests[0].peakBuckets).toBe(1200);
    expect(new Uint8Array(FakeWorker.instances[0].requests[0].bankBytes)).toEqual(new Uint8Array([1, 2, 3]));

    FakeWorker.instances[0].respond(0, makeJob('song_a'));
    const loaded = await load;

    expect(loaded.codec).toBe('BNSF/IS22');
    expect(loaded.duration).toBe(10);
    expect(loaded.peaks.length).toBe(4);
    expect((loaded.audioBuffer as unknown as FakeAudioBuffer).data[1][0]).toBe(0.5);
    expect(soundbankPlayer.getState()).toMatchObject({
      status: 'ready',
      cacheKey: 'sha-a:100:1',
      playing: false,
      duration: 10,
    });
    expect(states).toContain('decoding:false');
    expect(states).toContain('ready:false');

    await soundbankPlayer.ensureContextResumed();
    const ctx = FakeAudioContext.instances[0];
    expect(ctx.state).toBe('running');

    soundbankPlayer.setVolume(0.35);
    expect(soundbankPlayer.getState().volume).toBeCloseTo(0.35);

    soundbankPlayer.play(2);
    expect(soundbankPlayer.getState().playing).toBe(true);
    expect(ctx.sources.at(-1)?.starts[0]).toEqual({ when: 0, offset: 2 });

    ctx.currentTime = 1.25;
    expect(soundbankPlayer.getCurrentTime()).toBeCloseTo(3.25);

    soundbankPlayer.seek(7);
    expect(ctx.sources.at(-1)?.starts[0]).toEqual({ when: 0, offset: 7 });
    ctx.currentTime = 2.25;
    expect(soundbankPlayer.getCurrentTime()).toBeCloseTo(8);

    soundbankPlayer.pause();
    expect(soundbankPlayer.getState().playing).toBe(false);
    ctx.currentTime = 9;
    expect(soundbankPlayer.getCurrentTime()).toBeCloseTo(8);

    soundbankPlayer.stop();
    expect(soundbankPlayer.getCurrentTime()).toBe(0);
    unsubscribe();
  });

  test('does not let a stale decode bind over a newer song', async () => {
    const slow = soundbankPlayer.load('slow:100:1', new Uint8Array([1]), 'song_slow');
    const fast = soundbankPlayer.load('fast:100:2', new Uint8Array([2]), 'song_fast');
    await Promise.resolve();
    const worker = FakeWorker.instances[0];
    expect(worker.requests).toHaveLength(2);

    worker.respond(1, makeJob('song_fast', 6));
    await expect(fast).resolves.toMatchObject({ cacheKey: 'fast:100:2', duration: 6 });
    expect(soundbankPlayer.getState()).toMatchObject({ status: 'ready', cacheKey: 'fast:100:2' });

    worker.respond(0, makeJob('song_slow', 12));
    await expect(slow).resolves.toMatchObject({ cacheKey: 'slow:100:1', duration: 12 });
    expect(soundbankPlayer.getState()).toMatchObject({ status: 'ready', cacheKey: 'fast:100:2' });
  });
});
