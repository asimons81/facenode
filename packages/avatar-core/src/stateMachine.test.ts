import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AvatarStateMachine } from './stateMachine.js';
import { reduceEvent } from './eventReducer.js';
import {
  AvatarEventSchema,
  RuntimeEventEnvelopeSchema,
  RuntimeDiagnosticsSchema,
  createRuntimeEventEnvelope,
  createRuntimeDiagnostics,
  extractAvatarEvent,
  parseRuntimeEventEnvelope,
  parseRuntimeTransportMessage,
  validateRuntimeEventEnvelope,
} from './events.js';
import type { AvatarEvent, AvatarState, RuntimeEventEnvelope } from './index.js';

// ---------------------------------------------------------------------------
// AvatarEventSchema
// ---------------------------------------------------------------------------

describe('AvatarEventSchema', () => {
  it('parses all valid event shapes', () => {
    const valid: AvatarEvent[] = [
      { type: 'connected' },
      { type: 'disconnected' },
      { type: 'listening_start' },
      { type: 'listening_end' },
      { type: 'thinking_start' },
      { type: 'thinking_end' },
      { type: 'speech_start' },
      { type: 'speech_start', audioUrl: 'http://example.com/audio.mp3' },
      { type: 'speech_chunk' },
      { type: 'speech_chunk', text: 'hello', amplitude: 0.5 },
      { type: 'speech_end' },
      { type: 'error', message: 'something broke' },
      { type: 'viseme_frame', timestamp: 1000, visemes: [] },
      { type: 'viseme_frame', timestamp: 2000, visemes: [{ viseme: 'aa', weight: 0.8 }] },
    ];
    for (const ev of valid) {
      expect(() => AvatarEventSchema.parse(ev)).not.toThrow();
    }
  });

  it('rejects viseme_frame with missing timestamp', () => {
    expect(() =>
      AvatarEventSchema.parse({ type: 'viseme_frame', visemes: [] }),
    ).toThrow();
  });

  it('rejects unsupported viseme labels', () => {
    expect(() =>
      AvatarEventSchema.parse({
        type: 'viseme_frame',
        timestamp: 0,
        visemes: [{ viseme: 'zzz', weight: 0.5 }],
      }),
    ).toThrow();
  });

  it('rejects viseme weight outside [0, 1]', () => {
    expect(() =>
      AvatarEventSchema.parse({
        type: 'viseme_frame',
        timestamp: 0,
        visemes: [{ viseme: 'aa', weight: 1.5 }],
      }),
    ).toThrow();
  });

  it('rejects amplitude outside [0, 1]', () => {
    expect(() =>
      AvatarEventSchema.parse({ type: 'speech_chunk', amplitude: 1.5 }),
    ).toThrow();
    expect(() =>
      AvatarEventSchema.parse({ type: 'speech_chunk', amplitude: -0.1 }),
    ).toThrow();
  });

  it('rejects error event without message', () => {
    expect(() => AvatarEventSchema.parse({ type: 'error' })).toThrow();
  });

  it('rejects unknown event types', () => {
    expect(() => AvatarEventSchema.parse({ type: 'unknown_event' })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// RuntimeEventEnvelopeSchema
// ---------------------------------------------------------------------------

describe('RuntimeEventEnvelopeSchema', () => {
  it('parses a valid runtime envelope with thin metadata', () => {
    const payload = createRuntimeEventEnvelope(
      { type: 'speech_chunk', text: 'hello', amplitude: 0.5 },
      {
        source: 'hermes-adapter',
        sequence: 3,
        timestamp: 1234,
      },
    );

    expect(RuntimeEventEnvelopeSchema.parse(payload)).toEqual(payload);
  });

  it('allows optional metadata to be absent', () => {
    expect(() =>
      RuntimeEventEnvelopeSchema.parse({
        version: 1,
        source: 'hermes-adapter',
        sequence: 1,
        timestamp: 1234,
        event: { type: 'connected' },
      }),
    ).not.toThrow();
  });

  it('rejects envelopes missing required runtime-assigned metadata', () => {
    expect(() =>
      RuntimeEventEnvelopeSchema.parse({
        version: 1,
        source: 'hermes-adapter',
        timestamp: 1234,
        event: { type: 'connected' },
      }),
    ).toThrow();
  });

  it('parses runtime envelopes as the canonical event transport shape', () => {
    const envelope: RuntimeEventEnvelope = {
      version: 1,
      source: 'hermes-adapter',
      sequence: 2,
      timestamp: 1234,
      event: { type: 'connected' },
    };

    expect(parseRuntimeEventEnvelope(envelope)).toEqual(envelope);
    expect(parseRuntimeTransportMessage(envelope)).toEqual(envelope);
    expect(extractAvatarEvent(envelope)).toEqual({ type: 'connected' });
  });

  it('rejects bare AvatarEvent payloads at the runtime contract boundary', () => {
    expect(parseRuntimeEventEnvelope({ type: 'connected' })).toBeNull();
    expect(parseRuntimeTransportMessage({ type: 'connected' })).toBeNull();
  });

  it('returns explicit drop detail when a payload fails validation', () => {
    expect(
      validateRuntimeEventEnvelope({
        version: 1,
        source: 'hermes-adapter',
        sequence: 1,
        timestamp: 1234,
        event: { type: 'speech_chunk', amplitude: 4 },
      }),
    ).toEqual({
      ok: false,
      reason: 'invalid_runtime_payload',
      detail: 'event.amplitude: Number must be less than or equal to 1',
    });
  });
});

describe('RuntimeDiagnosticsSchema', () => {
  it('parses runtime diagnostics snapshots', () => {
    const diagnostics = createRuntimeDiagnostics({
      source: 'hermes-adapter',
      connectionState: 'connected',
      reconnectAttempts: 2,
      droppedPayloadCount: 3,
      lastDropReason: 'invalid_hermes_payload',
      lastDropDetail: 'amplitude must be between 0 and 1',
      sessionId: 'session-123',
      utteranceId: 'utt-456',
      lastAcceptedEvent: createRuntimeEventEnvelope(
        { type: 'speech_end' },
        {
          source: 'hermes-adapter',
          sequence: 9,
          timestamp: 5000,
          sessionId: 'session-123',
          utteranceId: 'utt-456',
        },
      ),
      updatedAt: 6000,
    });

    expect(RuntimeDiagnosticsSchema.parse(diagnostics)).toEqual(diagnostics);
    expect(parseRuntimeTransportMessage(diagnostics)).toEqual(diagnostics);
  });

  it('requires diagnostics to use a known connection state and drop reason', () => {
    expect(() =>
      RuntimeDiagnosticsSchema.parse({
        kind: 'runtime_diagnostics',
        version: 1,
        source: 'hermes-adapter',
        updatedAt: 1234,
        connectionState: 'online',
        reconnectAttempts: 0,
        droppedPayloadCount: 0,
      }),
    ).toThrow();
  });
});

// ---------------------------------------------------------------------------
// reduceEvent — pure function, no machine needed
// ---------------------------------------------------------------------------

describe('reduceEvent', () => {
  it('connected always returns idle', () => {
    const states: AvatarState[] = [
      'disconnected', 'idle', 'listening', 'thinking', 'speaking', 'error',
    ];
    for (const s of states) {
      expect(reduceEvent(s, { type: 'connected' })).toBe('idle');
    }
  });

  it('disconnected always returns disconnected', () => {
    const states: AvatarState[] = [
      'idle', 'listening', 'thinking', 'speaking', 'error', 'disconnected',
    ];
    for (const s of states) {
      expect(reduceEvent(s, { type: 'disconnected' })).toBe('disconnected');
    }
  });

  it('error always returns error', () => {
    const states: AvatarState[] = [
      'disconnected', 'idle', 'listening', 'thinking', 'speaking',
    ];
    for (const s of states) {
      expect(reduceEvent(s, { type: 'error', message: 'oops' })).toBe('error');
    }
  });

  it('speech_chunk never changes state', () => {
    const states: AvatarState[] = [
      'idle', 'listening', 'thinking', 'speaking', 'error', 'disconnected',
    ];
    for (const s of states) {
      expect(reduceEvent(s, { type: 'speech_chunk', amplitude: 0.3 })).toBe(s);
    }
  });

  it('viseme_frame never changes state', () => {
    const states: AvatarState[] = [
      'idle', 'listening', 'thinking', 'speaking', 'error', 'disconnected',
    ];
    const frame = { type: 'viseme_frame' as const, timestamp: 0, visemes: [] };
    for (const s of states) {
      expect(reduceEvent(s, frame)).toBe(s);
    }
  });

  it('listening_start: idle → listening', () => {
    expect(reduceEvent('idle', { type: 'listening_start' })).toBe('listening');
  });

  it('listening_start: non-idle states are no-ops', () => {
    const invalid: AvatarState[] = ['listening', 'thinking', 'speaking', 'error', 'disconnected'];
    for (const s of invalid) {
      expect(reduceEvent(s, { type: 'listening_start' })).toBe(s);
    }
  });

  it('listening_end: listening → idle', () => {
    expect(reduceEvent('listening', { type: 'listening_end' })).toBe('idle');
  });

  it('listening_end: non-listening states are no-ops', () => {
    const invalid: AvatarState[] = ['idle', 'thinking', 'speaking', 'error', 'disconnected'];
    for (const s of invalid) {
      expect(reduceEvent(s, { type: 'listening_end' })).toBe(s);
    }
  });

  it('thinking_start: idle → thinking', () => {
    expect(reduceEvent('idle', { type: 'thinking_start' })).toBe('thinking');
  });

  it('thinking_start: listening → thinking', () => {
    expect(reduceEvent('listening', { type: 'thinking_start' })).toBe('thinking');
  });

  it('thinking_start: other states are no-ops', () => {
    const invalid: AvatarState[] = ['thinking', 'speaking', 'error', 'disconnected'];
    for (const s of invalid) {
      expect(reduceEvent(s, { type: 'thinking_start' })).toBe(s);
    }
  });

  it('thinking_end: thinking → idle', () => {
    expect(reduceEvent('thinking', { type: 'thinking_end' })).toBe('idle');
  });

  it('thinking_end: non-thinking states are no-ops', () => {
    const invalid: AvatarState[] = ['idle', 'listening', 'speaking', 'error', 'disconnected'];
    for (const s of invalid) {
      expect(reduceEvent(s, { type: 'thinking_end' })).toBe(s);
    }
  });

  it('speech_start: thinking → speaking', () => {
    expect(reduceEvent('thinking', { type: 'speech_start' })).toBe('speaking');
  });

  it('speech_start: idle → speaking', () => {
    expect(reduceEvent('idle', { type: 'speech_start' })).toBe('speaking');
  });

  it('speech_start: other states are no-ops', () => {
    const invalid: AvatarState[] = ['listening', 'speaking', 'error', 'disconnected'];
    for (const s of invalid) {
      expect(reduceEvent(s, { type: 'speech_start' })).toBe(s);
    }
  });

  it('speech_end: speaking → idle', () => {
    expect(reduceEvent('speaking', { type: 'speech_end' })).toBe('idle');
  });

  it('speech_end: non-speaking states are no-ops', () => {
    const invalid: AvatarState[] = ['idle', 'listening', 'thinking', 'error', 'disconnected'];
    for (const s of invalid) {
      expect(reduceEvent(s, { type: 'speech_end' })).toBe(s);
    }
  });
});

// ---------------------------------------------------------------------------
// AvatarStateMachine
// ---------------------------------------------------------------------------

describe('AvatarStateMachine', () => {
  let machine: AvatarStateMachine;

  beforeEach(() => {
    machine = new AvatarStateMachine();
  });

  // --- Initial state ---

  it('defaults to disconnected', () => {
    expect(machine.current).toBe('disconnected');
  });

  it('accepts a custom initial state', () => {
    expect(new AvatarStateMachine('idle').current).toBe('idle');
  });

  // --- Valid full lifecycle ---

  it('transitions through a full speech lifecycle', () => {
    const events: AvatarEvent[] = [
      { type: 'connected' },
      { type: 'listening_start' },
      { type: 'thinking_start' },
      { type: 'speech_start' },
      { type: 'speech_end' },
      { type: 'disconnected' },
    ];
    const expected: AvatarState[] = [
      'idle', 'listening', 'thinking', 'speaking', 'idle', 'disconnected',
    ];
    for (let i = 0; i < events.length; i++) {
      const result = machine.transition(events[i]!);
      expect(result).toBe(expected[i]);
      expect(machine.current).toBe(expected[i]);
    }
  });

  it('can skip listening → thinking directly from idle', () => {
    machine.transition({ type: 'connected' });
    expect(machine.transition({ type: 'thinking_start' })).toBe('thinking');
  });

  it('can skip thinking → speaking directly from idle', () => {
    machine.transition({ type: 'connected' });
    expect(machine.transition({ type: 'speech_start' })).toBe('speaking');
  });

  it('error can be reached from any state', () => {
    const states: AvatarState[] = [
      'disconnected', 'idle', 'listening', 'thinking', 'speaking',
    ];
    for (const initial of states) {
      const m = new AvatarStateMachine(initial);
      expect(m.transition({ type: 'error', message: 'fail' })).toBe('error');
    }
  });

  it('disconnected can be reached from any state', () => {
    const states: AvatarState[] = ['idle', 'listening', 'thinking', 'speaking', 'error'];
    for (const initial of states) {
      const m = new AvatarStateMachine(initial);
      expect(m.transition({ type: 'disconnected' })).toBe('disconnected');
    }
  });

  // --- Invalid / no-op transitions ---

  it('ignores invalid transitions and returns current state', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    machine.transition({ type: 'connected' }); // → idle
    // Can't go listening_end from idle
    expect(machine.transition({ type: 'listening_end' })).toBe('idle');
    expect(machine.current).toBe('idle');
    warn.mockRestore();
  });

  it('speech_chunk never changes state', () => {
    machine.transition({ type: 'connected' }); // → idle
    expect(machine.transition({ type: 'speech_chunk', amplitude: 0.8 })).toBe('idle');
    expect(machine.current).toBe('idle');
  });

  it('warns on invalid directional transitions', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    machine.transition({ type: 'connected' }); // → idle
    machine.transition({ type: 'speech_end' });  // invalid from idle
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('speech_end');
    warn.mockRestore();
  });

  it('does not warn for speech_chunk (intentional no-op)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    machine.transition({ type: 'connected' }); // → idle
    machine.transition({ type: 'speech_chunk', amplitude: 0 });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not warn for viseme_frame (intentional no-op)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    machine.transition({ type: 'connected' }); // → idle
    machine.transition({ type: 'viseme_frame', timestamp: 0, visemes: [] });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not warn for universal events (connected/disconnected/error)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    machine.transition({ type: 'connected' }); // → idle, valid
    machine.transition({ type: 'connected' }); // → idle again, already idle — no warn
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  // --- on(state, cb) ---

  it('on() fires when entering the specified state', () => {
    machine.transition({ type: 'connected' }); // → idle
    const cb = vi.fn();
    machine.on('listening', cb);
    machine.transition({ type: 'listening_start' });
    expect(cb).toHaveBeenCalledOnce();
  });

  it('on() does not fire for other state entries', () => {
    machine.transition({ type: 'connected' }); // → idle
    const cb = vi.fn();
    machine.on('thinking', cb);
    machine.transition({ type: 'listening_start' }); // → listening, not thinking
    expect(cb).not.toHaveBeenCalled();
  });

  it('on() unsubscribe stops future calls', () => {
    machine.transition({ type: 'connected' }); // → idle
    const cb = vi.fn();
    const unsub = machine.on('listening', cb);
    unsub();
    machine.transition({ type: 'listening_start' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('multiple on() listeners for the same state all fire', () => {
    machine.transition({ type: 'connected' }); // → idle
    const a = vi.fn();
    const b = vi.fn();
    machine.on('listening', a);
    machine.on('listening', b);
    machine.transition({ type: 'listening_start' });
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  // --- onChange(cb) ---

  it('onChange fires with next and prev states', () => {
    machine.transition({ type: 'connected' }); // → idle (first transition, no listener yet)
    const cb = vi.fn();
    machine.onChange(cb);
    machine.transition({ type: 'listening_start' });
    expect(cb).toHaveBeenCalledWith('listening', 'idle');
  });

  it('onChange does not fire on no-op transitions', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    machine.transition({ type: 'connected' }); // → idle
    const cb = vi.fn();
    machine.onChange(cb);
    machine.transition({ type: 'speech_chunk', amplitude: 0.5 });
    machine.transition({ type: 'speech_end' }); // invalid from idle
    expect(cb).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('onChange unsubscribe stops future calls', () => {
    machine.transition({ type: 'connected' }); // → idle
    const cb = vi.fn();
    const unsub = machine.onChange(cb);
    unsub();
    machine.transition({ type: 'listening_start' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('onChange fires for every transition in a sequence', () => {
    const calls: Array<[AvatarState, AvatarState]> = [];
    machine.onChange((next, prev) => calls.push([next, prev]));

    machine.transition({ type: 'connected' });         // disconnected → idle
    machine.transition({ type: 'listening_start' });   // idle → listening
    machine.transition({ type: 'thinking_start' });    // listening → thinking
    machine.transition({ type: 'speech_start' });      // thinking → speaking
    machine.transition({ type: 'speech_end' });        // speaking → idle

    expect(calls).toEqual([
      ['idle', 'disconnected'],
      ['listening', 'idle'],
      ['thinking', 'listening'],
      ['speaking', 'thinking'],
      ['idle', 'speaking'],
    ]);
  });

  // --- on() and onChange() interact correctly ---

  it('on() state listener and onChange both fire for the same transition', () => {
    machine.transition({ type: 'connected' }); // → idle
    const onListening = vi.fn();
    const onChange = vi.fn();
    machine.on('listening', onListening);
    machine.onChange(onChange);
    machine.transition({ type: 'listening_start' });
    expect(onListening).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith('listening', 'idle');
  });
});
