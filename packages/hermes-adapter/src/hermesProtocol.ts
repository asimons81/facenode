import {
  AvatarEventSchema,
  createRuntimeEventEnvelope,
  validateAvatarEventPayload,
} from '@facenode/avatar-core';
import type {
  AvatarEvent,
  RuntimeDropReason,
  RuntimeEventEnvelope,
  Viseme,
} from '@facenode/avatar-core';

type RawObject = Record<string, unknown>;

export interface HermesCorrelationState {
  sessionId?: string;
  utteranceId?: string;
}

export interface HermesNormalizationContext {
  source: string;
  nextSequence: () => number;
  now?: () => number;
  correlation?: HermesCorrelationState;
}

export interface HermesNormalizedPayload {
  envelope: RuntimeEventEnvelope;
  origin: 'hermes' | 'runtime' | 'legacy';
  correlation: HermesCorrelationState;
}

export interface HermesPayloadDrop {
  reason: RuntimeDropReason;
  detail: string;
}

export type HermesNormalizationResult =
  | { ok: true; value: HermesNormalizedPayload }
  | { ok: false; drop: HermesPayloadDrop };

export function normalizeIncomingPayload(
  raw: unknown,
  context: HermesNormalizationContext,
): HermesNormalizationResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      ok: false,
      drop: {
        reason: 'invalid_runtime_payload',
        detail: 'Payload must be a JSON object.',
      },
    };
  }

  const rawObject = raw as RawObject;

  if (hasHermesEventName(rawObject)) {
    return normalizeHermesPayload(rawObject, context);
  }

  const validated = validateAvatarEventPayload(raw);
  if (!validated.ok) {
    return {
      ok: false,
      drop: {
        reason: validated.reason,
        detail: validated.detail,
      },
    };
  }

  const payload = validated.value;
  if ('event' in payload) {
    return {
      ok: true,
      value: {
        envelope: payload,
        origin: 'runtime',
        correlation: {
          sessionId: payload.sessionId,
          utteranceId: payload.utteranceId,
        },
      },
    };
  }

  const correlation = resolveCorrelation(rawObject, context.correlation);
  return {
    ok: true,
    value: {
      envelope: createRuntimeEventEnvelope(payload, {
        source: context.source,
        sequence: context.nextSequence(),
        timestamp: context.now?.() ?? Date.now(),
        sessionId: correlation.sessionId,
        utteranceId: correlation.utteranceId,
      }),
      origin: 'legacy',
      correlation,
    },
  };
}

function normalizeHermesPayload(
  raw: RawObject,
  context: HermesNormalizationContext,
): HermesNormalizationResult {
  const mapped = mapHermesPayload(raw);
  if (!mapped.ok) {
    return mapped;
  }

  const correlation = resolveCorrelation(raw, context.correlation);
  return {
    ok: true,
    value: {
      envelope: createRuntimeEventEnvelope(mapped.value, {
        source: context.source,
        sequence: context.nextSequence(),
        timestamp: context.now?.() ?? Date.now(),
        sessionId: correlation.sessionId,
        utteranceId: correlation.utteranceId,
      }),
      origin: 'hermes',
      correlation: clearResolvedCorrelation(mapped.value, correlation),
    },
  };
}

function mapHermesPayload(raw: RawObject):
  | { ok: true; value: AvatarEvent }
  | { ok: false; drop: HermesPayloadDrop } {
  const rawEvent = raw['event'];
  if (typeof rawEvent !== 'string') {
    return {
      ok: false,
      drop: {
        reason: 'invalid_hermes_payload',
        detail: 'Hermes payload is missing a string event name.',
      },
    };
  }

  const candidate = mapKnownHermesEvent(rawEvent, raw);
  if (candidate === null) {
    return {
      ok: false,
      drop: {
        reason: 'unknown_hermes_event',
        detail: `Unsupported Hermes event "${rawEvent}".`,
      },
    };
  }

  const validated = AvatarEventSchema.safeParse(candidate);
  if (!validated.success) {
    return {
      ok: false,
      drop: {
        reason: 'invalid_hermes_payload',
        detail: validated.error.issues
          .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join('.') : 'payload';
            return `${path}: ${issue.message}`;
          })
          .join('; '),
      },
    };
  }

  return {
    ok: true,
    value: validated.data,
  };
}

function mapKnownHermesEvent(rawEvent: string, raw: RawObject): AvatarEvent | null {
  switch (rawEvent) {
    case 'ready':
      return { type: 'connected' };

    case 'disconnect':
      return { type: 'disconnected' };

    case 'user.speech.start':
      return { type: 'listening_start' };

    case 'user.speech.end':
      return { type: 'listening_end' };

    case 'llm.start':
      return { type: 'thinking_start' };

    case 'llm.end':
      return { type: 'thinking_end' };

    case 'tts.start':
      return {
        type: 'speech_start',
        audioUrl: typeof raw['audio_url'] === 'string' ? raw['audio_url'] : undefined,
      };

    case 'tts.chunk':
      return {
        type: 'speech_chunk',
        text: typeof raw['text'] === 'string' ? raw['text'] : undefined,
        amplitude: typeof raw['amplitude'] === 'number' ? raw['amplitude'] : undefined,
      };

    case 'tts.end':
      return { type: 'speech_end' };

    case 'tts.viseme':
      return {
        type: 'viseme_frame',
        timestamp: typeof raw['timestamp'] === 'number' ? raw['timestamp'] : Date.now(),
        visemes: normalizeVisemes(raw['visemes']),
      };

    case 'error':
      return {
        type: 'error',
        message: typeof raw['message'] === 'string' ? raw['message'] : 'Unknown Hermes error',
      };

    default:
      return null;
  }
}

function normalizeVisemes(rawVisemes: unknown): Array<{ viseme: Viseme; weight: number }> {
  if (!Array.isArray(rawVisemes)) return [];

  const visemes: Array<{ viseme: Viseme; weight: number }> = [];
  for (const item of rawVisemes) {
    if (
      item !== null &&
      typeof item === 'object' &&
      typeof (item as RawObject)['viseme'] === 'string' &&
      typeof (item as RawObject)['weight'] === 'number'
    ) {
      visemes.push({
        viseme: (item as RawObject)['viseme'] as Viseme,
        weight: (item as RawObject)['weight'] as number,
      });
    }
  }

  return visemes;
}

function hasHermesEventName(raw: Record<string, unknown>): raw is RawObject & { event: string } {
  return typeof raw['event'] === 'string';
}

function resolveCorrelation(
  raw: Record<string, unknown>,
  current: HermesCorrelationState | undefined,
): HermesCorrelationState {
  return {
    sessionId: readFirstString(raw, ['sessionId', 'session_id']) ?? current?.sessionId,
    utteranceId: readFirstString(raw, ['utteranceId', 'utterance_id']) ?? current?.utteranceId,
  };
}

function clearResolvedCorrelation(
  event: AvatarEvent,
  correlation: HermesCorrelationState,
): HermesCorrelationState {
  if (event.type === 'speech_end' || event.type === 'disconnected' || event.type === 'error') {
    return {
      sessionId: event.type === 'disconnected' ? undefined : correlation.sessionId,
      utteranceId: undefined,
    };
  }

  return correlation;
}

function readFirstString(raw: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    if (typeof raw[key] === 'string' && raw[key].length > 0) {
      return raw[key] as string;
    }
  }
  return undefined;
}
