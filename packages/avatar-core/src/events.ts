import { z } from 'zod';
import { VISEMES } from './animationController.js';

export const AvatarEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('connected') }),
  z.object({ type: z.literal('disconnected') }),
  z.object({ type: z.literal('listening_start') }),
  z.object({ type: z.literal('listening_end') }),
  z.object({ type: z.literal('thinking_start') }),
  z.object({ type: z.literal('thinking_end') }),
  z.object({
    type: z.literal('speech_start'),
    audioUrl: z.string().optional(),
  }),
  z.object({
    type: z.literal('speech_chunk'),
    text: z.string().optional(),
    amplitude: z.number().min(0).max(1).optional(),
  }),
  z.object({ type: z.literal('speech_end') }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({
    type: z.literal('viseme_frame'),
    timestamp: z.number(),
    visemes: z.array(
      z.object({ viseme: z.enum(VISEMES), weight: z.number().min(0).max(1) }),
    ),
  }),
]);

export type AvatarEvent = z.infer<typeof AvatarEventSchema>;

export const RUNTIME_EVENT_VERSION = 1 as const;

export const RuntimeEnvelopeMetadataSchema = z.object({
  version: z.literal(RUNTIME_EVENT_VERSION),
  /** Bridge/runtime identity that authored this envelope. */
  source: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  timestamp: z.number().finite().nonnegative(),
  sessionId: z.string().min(1).optional(),
  utteranceId: z.string().min(1).optional(),
});

export const RuntimeEventEnvelopeSchema = z.object({
  ...RuntimeEnvelopeMetadataSchema.shape,
  event: AvatarEventSchema,
});

export type RuntimeEventEnvelope = z.infer<typeof RuntimeEventEnvelopeSchema>;

export const RuntimeDropReasonSchema = z.enum([
  'invalid_json',
  'invalid_runtime_payload',
  'unknown_hermes_event',
  'invalid_hermes_payload',
  'out_of_order_runtime_event',
]);

export type RuntimeDropReason = z.infer<typeof RuntimeDropReasonSchema>;

export const RuntimeConnectionStateSchema = z.enum([
  'idle',
  'connecting',
  'connected',
  'reconnecting',
  'disconnected',
  'error',
]);

export type RuntimeConnectionState = z.infer<typeof RuntimeConnectionStateSchema>;

export const RuntimeDiagnosticsSchema = z.object({
  kind: z.literal('runtime_diagnostics'),
  version: z.literal(RUNTIME_EVENT_VERSION),
  source: z.string().min(1),
  updatedAt: z.number().finite().nonnegative(),
  connectionState: RuntimeConnectionStateSchema,
  reconnectAttempts: z.number().int().nonnegative(),
  droppedPayloadCount: z.number().int().nonnegative(),
  lastDropReason: RuntimeDropReasonSchema.optional(),
  lastDropDetail: z.string().min(1).optional(),
  lastAcceptedEvent: RuntimeEventEnvelopeSchema.optional(),
  sessionId: z.string().min(1).optional(),
  utteranceId: z.string().min(1).optional(),
});

export type RuntimeDiagnostics = z.infer<typeof RuntimeDiagnosticsSchema>;

export const RuntimeTransportMessageSchema = z.union([
  RuntimeEventEnvelopeSchema,
  RuntimeDiagnosticsSchema,
]);

export type RuntimeTransportMessage = z.infer<typeof RuntimeTransportMessageSchema>;

export interface PayloadValidationSuccess<T> {
  ok: true;
  value: T;
}

export interface PayloadValidationFailure {
  ok: false;
  reason: RuntimeDropReason;
  detail: string;
}

export type PayloadValidationResult<T> =
  | PayloadValidationSuccess<T>
  | PayloadValidationFailure;

export function createRuntimeEventEnvelope(
  event: AvatarEvent,
  metadata: {
    /** Bridge/runtime identity that is wrapping this payload. */
    source: string;
    sequence: number;
    timestamp?: number;
    sessionId?: string;
    utteranceId?: string;
  },
): RuntimeEventEnvelope {
  return RuntimeEventEnvelopeSchema.parse({
    version: RUNTIME_EVENT_VERSION,
    event,
    source: metadata.source,
    sequence: metadata.sequence,
    timestamp: metadata.timestamp ?? Date.now(),
    sessionId: metadata.sessionId,
    utteranceId: metadata.utteranceId,
  });
}

export function extractAvatarEvent(envelope: RuntimeEventEnvelope): AvatarEvent {
  return envelope.event;
}

export function isRuntimeEventEnvelope(payload: unknown): payload is RuntimeEventEnvelope {
  return payload !== null && typeof payload === 'object' && 'version' in payload;
}

export function parseRuntimeEventEnvelope(raw: unknown): RuntimeEventEnvelope | null {
  const result = validateRuntimeEventEnvelope(raw);
  return result.ok ? result.value : null;
}

export function parseRuntimeTransportMessage(raw: unknown): RuntimeTransportMessage | null {
  const result = RuntimeTransportMessageSchema.safeParse(raw);
  return result.success ? result.data : null;
}

export function validateRuntimeEventEnvelope(
  raw: unknown,
): PayloadValidationResult<RuntimeEventEnvelope> {
  const result = RuntimeEventEnvelopeSchema.safeParse(raw);
  if (result.success) {
    return {
      ok: true,
      value: result.data,
    };
  }

  return {
    ok: false,
    reason: 'invalid_runtime_payload',
    detail: formatZodError(result.error),
  };
}

export function validateRuntimeTransportMessage(
  raw: unknown,
): PayloadValidationResult<RuntimeTransportMessage> {
  const result = RuntimeTransportMessageSchema.safeParse(raw);
  if (result.success) {
    return {
      ok: true,
      value: result.data,
    };
  }

  return {
    ok: false,
    reason: 'invalid_runtime_payload',
    detail: formatZodError(result.error),
  };
}

export function createRuntimeDiagnostics(
  diagnostics: Omit<RuntimeDiagnostics, 'kind' | 'version' | 'updatedAt'> & {
    updatedAt?: number;
  },
): RuntimeDiagnostics {
  return RuntimeDiagnosticsSchema.parse({
    kind: 'runtime_diagnostics',
    version: RUNTIME_EVENT_VERSION,
    updatedAt: diagnostics.updatedAt ?? Date.now(),
    ...diagnostics,
  });
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'payload';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}
