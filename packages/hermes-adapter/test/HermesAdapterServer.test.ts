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
});
