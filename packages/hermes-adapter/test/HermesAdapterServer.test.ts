import { describe, expect, it } from 'vitest';
import { parseIncomingPayload } from '../src/HermesAdapterServer.js';

describe('parseIncomingPayload', () => {
  it('normalizes Hermes payloads into runtime envelopes', () => {
    expect(
      parseIncomingPayload({
        event: 'tts.chunk',
        sessionId: 'session-1',
        utteranceId: 'utt-1',
        text: 'hello',
        amplitude: 0.4,
      }),
    ).toMatchObject({
      version: 1,
      source: 'hermes-adapter',
      sequence: 1,
      sessionId: 'session-1',
      utteranceId: 'utt-1',
      event: {
        type: 'speech_chunk',
        text: 'hello',
        amplitude: 0.4,
      },
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

  it('rejects legacy raw AvatarEvent payloads instead of wrapping them', () => {
    expect(parseIncomingPayload({ type: 'connected' })).toBeNull();
  });
});
