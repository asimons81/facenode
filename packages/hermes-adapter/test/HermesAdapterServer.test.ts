import { describe, expect, it } from 'vitest';
import { parseIncomingPayload } from '../src/HermesAdapterServer.js';

describe('parseIncomingPayload', () => {
  it('validates Hermes-mapped events before returning them', () => {
    expect(
      parseIncomingPayload({
        event: 'tts.chunk',
        text: 'hello',
        amplitude: 0.4,
      }),
    ).toEqual({
      type: 'speech_chunk',
      text: 'hello',
      amplitude: 0.4,
    });
  });

  it('rejects invalid Hermes-mapped payloads that fail AvatarEventSchema', () => {
    expect(
      parseIncomingPayload({
        event: 'tts.chunk',
        amplitude: 2,
      }),
    ).toBeNull();
  });

  it('accepts runtime envelopes without stripping metadata', () => {
    expect(
      parseIncomingPayload({
        version: 1,
        source: 'hermes-adapter',
        sequence: 9,
        timestamp: 1234,
        event: { type: 'thinking_end' },
      }),
    ).toEqual({
      version: 1,
      source: 'hermes-adapter',
      sequence: 9,
      timestamp: 1234,
      event: { type: 'thinking_end' },
    });
  });

  it('accepts envelopes when optional metadata is absent', () => {
    expect(
      parseIncomingPayload({
        version: 1,
        source: 'hermes-adapter',
        sequence: 9,
        timestamp: 1234,
        event: { type: 'connected' },
      }),
    ).toEqual({
      version: 1,
      source: 'hermes-adapter',
      sequence: 9,
      timestamp: 1234,
      event: { type: 'connected' },
    });
  });
});
