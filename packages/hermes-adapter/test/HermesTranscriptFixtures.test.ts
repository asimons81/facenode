import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { reduceEvent } from '@facenode/avatar-core';
import type {
  AvatarState,
  RuntimeDropReason,
  RuntimeEventEnvelope,
} from '@facenode/avatar-core';
import { normalizeIncomingPayload } from '../src/hermesProtocol.js';
import type { HermesCorrelationState } from '../src/hermesProtocol.js';

interface TranscriptResult {
  accepted: RuntimeEventEnvelope[];
  dropped: Array<{ reason: RuntimeDropReason; detail: string }>;
  states: AvatarState[];
  finalCorrelation: HermesCorrelationState;
}

function runFixture(name: string): TranscriptResult {
  const fixturePath = path.join(import.meta.dirname, 'fixtures', `${name}.json`);
  const transcript = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as unknown[];

  let sequence = 0;
  let state: AvatarState = 'disconnected';
  let correlation: HermesCorrelationState = {};
  const lastSequenceBySource = new Map<string, number>();

  const accepted: RuntimeEventEnvelope[] = [];
  const dropped: Array<{ reason: RuntimeDropReason; detail: string }> = [];
  const states: AvatarState[] = [];

  for (const frame of transcript) {
    let raw = frame;
    if (typeof frame === 'string') {
      try {
        raw = JSON.parse(frame) as unknown;
      } catch (error) {
        dropped.push({
          reason: 'invalid_json',
          detail: `Invalid JSON payload: ${(error as Error).message}`,
        });
        continue;
      }
    }

    const result = normalizeIncomingPayload(raw, {
      source: 'hermes-adapter',
      correlation,
      nextSequence: () => ++sequence,
      now: () => 1700000000000 + sequence,
    });

    if (!result.ok) {
      dropped.push(result.drop);
      continue;
    }

    const envelope = result.value.envelope;
    const lastSeen = lastSequenceBySource.get(envelope.source) ?? -1;
    if (envelope.sequence <= lastSeen) {
      dropped.push({
        reason: envelope.sequence === lastSeen
          ? 'duplicate_runtime_event'
          : 'out_of_order_runtime_event',
        detail: envelope.sequence === lastSeen
          ? `Received duplicate sequence ${envelope.sequence} from ${envelope.source}.`
          : `Received sequence ${envelope.sequence} after ${lastSeen} from ${envelope.source}.`,
      });
      continue;
    }

    lastSequenceBySource.set(envelope.source, envelope.sequence);
    correlation = result.value.correlation;
    accepted.push(envelope);
    state = reduceEvent(state, envelope.event);
    states.push(state);
  }

  return { accepted, dropped, states, finalCorrelation: correlation };
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
    expect(result.finalCorrelation).toEqual({ sessionId: 'session-happy', utteranceId: undefined });
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
    expect(result.accepted[4]).toMatchObject({
      event: { type: 'disconnected' },
      sessionId: 'session-reconnect',
      utteranceId: undefined,
    });
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

  it('resolves a missing speech_end with an explicit disconnect reset', () => {
    const result = runFixture('speech-start-without-end');

    expect(result.dropped).toEqual([]);
    expect(result.accepted.map((entry) => entry.event.type)).toEqual([
      'connected',
      'speech_start',
      'speech_chunk',
      'disconnected',
    ]);
    expect(result.accepted.at(-1)).toMatchObject({
      event: { type: 'disconnected' },
      sessionId: 'session-cutoff',
      utteranceId: undefined,
    });
    expect(result.states).toEqual(['idle', 'speaking', 'speaking', 'disconnected']);
    expect(result.finalCorrelation).toEqual({ sessionId: undefined, utteranceId: undefined });
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

  it('quarantines malformed Hermes, unknown Hermes, and malformed runtime payloads with explicit drop reasons', () => {
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

  it('drops malformed JSON frames but keeps the transcript recoverable', () => {
    const result = runFixture('malformed-json-and-recovery');

    expect(result.accepted.map((entry) => entry.event.type)).toEqual([
      'connected',
      'speech_start',
      'speech_end',
    ]);
    expect(result.dropped.map((drop) => drop.reason)).toEqual(['invalid_json']);
    expect(result.states.at(-1)).toBe('idle');
  });

  it('distinguishes duplicate runtime envelopes from out-of-order ones', () => {
    const result = runFixture('runtime-envelope-ordering');

    expect(result.accepted.map((entry) => entry.event.type)).toEqual([
      'connected',
      'speech_start',
      'speech_end',
    ]);
    expect(result.dropped.map((drop) => drop.reason)).toEqual([
      'duplicate_runtime_event',
      'out_of_order_runtime_event',
    ]);
    expect(result.states).toEqual(['idle', 'speaking', 'idle']);
  });

  it('carries session and utterance correlation forward until a lifecycle boundary clears them', () => {
    const result = runFixture('correlation-carry-forward');

    expect(result.dropped).toEqual([]);
    expect(result.accepted.map((entry) => ({
      type: entry.event.type,
      sessionId: entry.sessionId,
      utteranceId: entry.utteranceId,
    }))).toEqual([
      { type: 'connected', sessionId: 'session-carry', utteranceId: undefined },
      { type: 'speech_start', sessionId: 'session-carry', utteranceId: 'utt-carry' },
      { type: 'speech_chunk', sessionId: 'session-carry', utteranceId: 'utt-carry' },
      { type: 'viseme_frame', sessionId: 'session-carry', utteranceId: 'utt-carry' },
      { type: 'speech_end', sessionId: 'session-carry', utteranceId: 'utt-carry' },
      { type: 'thinking_start', sessionId: 'session-carry', utteranceId: undefined },
    ]);
    expect(result.finalCorrelation).toEqual({ sessionId: 'session-carry', utteranceId: undefined });
  });
});

