import { afterEach, describe, expect, it, vi } from 'vitest';
import { AmplitudeAnalyzer } from './amplitudeAnalyzer.js';

class MockAnalyserNode {
  fftSize = 0;
  smoothingTimeConstant = 0;
  readonly frequencyBinCount = 8;
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
  readonly getByteTimeDomainData = vi.fn((buffer: Uint8Array) => {
    buffer.fill(128);
  });
}

class MockMediaElementAudioSourceNode {
  readonly connect = vi.fn();
  readonly disconnect = vi.fn();
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];

  readonly analyser = new MockAnalyserNode();
  readonly source = new MockMediaElementAudioSourceNode();
  readonly destination = {};
  state: AudioContextState = 'running';

  constructor() {
    MockAudioContext.instances.push(this);
  }

  createAnalyser(): MockAnalyserNode {
    return this.analyser;
  }

  createMediaElementSource(_audioElement: HTMLAudioElement): MockMediaElementAudioSourceNode {
    return this.source;
  }
}

describe('AmplitudeAnalyzer reconnect handling', () => {
  const originalAudioContext = globalThis.AudioContext;

  afterEach(() => {
    globalThis.AudioContext = originalAudioContext;
    vi.restoreAllMocks();
    MockAudioContext.instances = [];
  });

  it('reuses a single AudioContext across disconnect/reconnect cycles', () => {
    globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;
    const analyzer = new AmplitudeAnalyzer();
    const audio = {} as HTMLAudioElement;

    analyzer.connect(audio);
    analyzer.disconnect();
    analyzer.connect(audio);

    expect(MockAudioContext.instances).toHaveLength(1);
    expect(analyzer.isConnected).toBe(true);
  });
});
