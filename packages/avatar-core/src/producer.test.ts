import { describe, expect, it, vi } from 'vitest';
import { RuntimeEventEnvelopeSchema } from './events.js';
import { createRuntimeEventProducer } from './producer.js';

describe('RuntimeEventProducer', () => {
  it('creates valid sequenced runtime envelopes with event helpers', () => {
    const producer = createRuntimeEventProducer({
      source: 'demo-producer',
      now: () => 1234,
    });

    const thinkingStart = producer.thinkingStart();
    const speechChunk = producer.speechChunk({ text: 'hello', amplitude: 0.5 });

    expect(RuntimeEventEnvelopeSchema.parse(thinkingStart)).toEqual(thinkingStart);
    expect(RuntimeEventEnvelopeSchema.parse(speechChunk)).toEqual(speechChunk);
    expect(thinkingStart).toMatchObject({
      source: 'demo-producer',
      sequence: 1,
      timestamp: 1234,
      event: { type: 'thinking_start' },
    });
    expect(speechChunk).toMatchObject({
      source: 'demo-producer',
      sequence: 2,
      timestamp: 1234,
      event: { type: 'speech_chunk', text: 'hello', amplitude: 0.5 },
    });
  });

  it('supports explicit correlation state with propagation and clearing', () => {
    const producer = createRuntimeEventProducer({
      source: 'demo-producer',
      sessionId: 'session-1',
    });

    producer.setUtterance('utt-1');

    const first = producer.speechStart();
    const second = producer.speechChunk({ amplitude: 0.4 });
    producer.clearUtterance();
    const third = producer.speechEnd();

    expect(first).toMatchObject({
      sessionId: 'session-1',
      utteranceId: 'utt-1',
    });
    expect(second).toMatchObject({
      sessionId: 'session-1',
      utteranceId: 'utt-1',
    });
    expect(third).toMatchObject({
      sessionId: 'session-1',
    });
    expect(third.utteranceId).toBeUndefined();
  });

  it('allows per-envelope correlation overrides without mutating producer state', () => {
    const producer = createRuntimeEventProducer({
      source: 'demo-producer',
      sessionId: 'session-1',
      utteranceId: 'utt-1',
    });

    const overridden = producer.speechChunk({
      text: 'override',
      sessionId: 'session-2',
      utteranceId: null,
    });
    const next = producer.speechEnd();

    expect(overridden).toMatchObject({
      sessionId: 'session-2',
    });
    expect(overridden.utteranceId).toBeUndefined();
    expect(next).toMatchObject({
      sessionId: 'session-1',
      utteranceId: 'utt-1',
    });
  });

  it('uses the generic event() authoring path for helpers that are not wrapped explicitly', () => {
    const now = vi.fn(() => 9876);
    const producer = createRuntimeEventProducer({
      source: 'demo-producer',
      now,
    });

    const envelope = producer.event({
      type: 'viseme_frame',
      timestamp: 450,
      visemes: [{ viseme: 'aa', weight: 0.7 }],
    });

    expect(envelope).toMatchObject({
      source: 'demo-producer',
      sequence: 1,
      timestamp: 9876,
      event: {
        type: 'viseme_frame',
        timestamp: 450,
        visemes: [{ viseme: 'aa', weight: 0.7 }],
      },
    });
    expect(now).toHaveBeenCalledOnce();
  });

  it('still rejects invalid event payloads through the shared runtime schema', () => {
    const producer = createRuntimeEventProducer({ source: 'demo-producer' });

    expect(() =>
      producer.speechChunk({ amplitude: 4 }),
    ).toThrow();
  });
});
