import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { reduceEvent } from '@facenode/avatar-core';
import type { AvatarState, RuntimeDropReason, RuntimeEventEnvelope } from '@facenode/avatar-core';
import { normalizeIncomingPayload } from '../src/hermesProtocol.js';
import type { HermesCorrelationState } from '../src/hermesProtocol.js';

interface TranscriptResult {
  accepted: RuntimeEventEnvelope[];
  dropped: Array<{ reason: RuntimeDropReason; detail: string }>;
  states: AvatarState[];
}

function runFixture(name: string): TranscriptResult {
  const fixturePath = path.join(import.meta.dirname, 'fixtures', `${name}.json`);
  const transcript = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as unknown[];

  let sequence = 0;
  let state: AvatarState = 'disconnected';
  let correlation: HermesCorrelationState = {};

  const accepted: RuntimeEventEnvelope[] = [];
  const dropped: Array<{ reason: RuntimeDropReason; detail: string }> = [];
  const states: AvatarState[] = [];

  for (const payload of transcript) {
    const result = normalizeIncomingPayload(payload, {
      source: 'hermes-adapter',
      correlation,
      nextSequence: () => ++sequence,
      now: () => 1700000000000 + sequence,
    });

    if (!result.ok) {
      dropped.push(result.drop);
      continue;
    }

    correlation = result.value.correlation;
    accepted.push(result.value.envelope);
    state = reduceEvent(state, result.value.envelope.event);
    states.push(state);
  }

  return { accepted, dropped, states };
}

describe('Hermes transcript fixtures', () => {
  it('normal happy path yields a clean lifecycle with correlated envelopes', () => {
    const result = runFixture('happy-path');

    expect(result.dropped).toEqual([]);
    expect(result.accepted.map((entry) => entry.event.type)).toEqual([
      'connected',
      'listening_start',
      'listening_end',
      'thinking_start',
      'thinking_end',
      'speech_start',
      'speech_chunk',
      'viseme_frame',
      'speech_end',
    ]);
    expect(result.states.at(-1)).toBe('idle');
    expect(result.accepted[5]).toMatchObject({
      sessionId: 'session-happy',
      utteranceId: 'utt-happy',
      event: { type: 'speech_start' },
    });
  });

  it('handles reconnect during speech as explicit lifecycle events', () => {
    const result = runFixture('reconnect-during-speech');

    expect(result.dropped).toEqual([]);
    expect(result.accepted.map((entry) => entry.event.type)).toEqual([
      'connected',
      'thinking_start',
      'speech_start',
      'speech_chunk',
      'disconnected',
      'connected',
      'speech_chunk',
      'speech_end',
    ]);
    expect(result.states).toEqual([
      'idle',
      'thinking',
      'speaking',
      'speaking',
      'disconnected',
      'idle',
      'idle',
      'idle',
    ]);
  });

  it('tolerates missing thinking_end by allowing speech_start to advance from thinking', () => {
    const result = runFixture('missing-thinking-end');

    expect(result.dropped).toEqual([]);
    expect(result.accepted.map((entry) => entry.event.type)).toEqual([
      'connected',
      'thinking_start',
      'speech_start',
      'speech_chunk',
      'speech_end',
    ]);
    expect(result.states).toEqual(['idle', 'thinking', 'speaking', 'speaking', 'idle']);
  });

  it('keeps repeated speech_chunk payloads instead of deduping them away', () => {
    const result = runFixture('repeated-speech-chunk');

    expect(result.dropped).toEqual([]);
    expect(result.accepted.filter((entry) => entry.event.type === 'speech_chunk')).toHaveLength(2);
    expect(result.states).toEqual(['idle', 'speaking', 'speaking', 'speaking', 'idle']);
  });

  it('supports a viseme-only speaking path', () => {
    const result = runFixture('viseme-only-path');

    expect(result.dropped).toEqual([]);
    expect(result.accepted.map((entry) => entry.event.type)).toEqual([
      'connected',
      'speech_start',
      'viseme_frame',
      'viseme_frame',
      'speech_end',
    ]);
    expect(result.states.at(-1)).toBe('idle');
  });

  it('supports amplitude-only fallback when no viseme frames arrive', () => {
    const result = runFixture('amplitude-only-fallback');

    expect(result.dropped).toEqual([]);
    expect(result.accepted.map((entry) => entry.event.type)).toEqual([
      'connected',
      'speech_start',
      'speech_chunk',
      'speech_chunk',
      'speech_end',
    ]);
    expect(result.states.at(-1)).toBe('idle');
  });

  it('quarantines malformed and partial payloads with explicit drop reasons', () => {
    const result = runFixture('malformed-partial-drop');

    expect(result.accepted.map((entry) => entry.event.type)).toEqual([
      'connected',
      'speech_start',
      'speech_chunk',
      'speech_end',
    ]);
    expect(result.dropped.map((drop) => drop.reason)).toEqual([
      'invalid_hermes_payload',
      'unknown_hermes_event',
      'invalid_runtime_payload',
    ]);
    expect(result.dropped[0]?.detail).toContain('amplitude');
    expect(result.states.at(-1)).toBe('idle');
  });
});
