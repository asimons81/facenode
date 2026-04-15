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

export const RuntimeEventEnvelopeSchema = z.object({
  version: z.literal(RUNTIME_EVENT_VERSION),
  /** Bridge/runtime identity that authored this envelope. */
  source: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  timestamp: z.number(),
  sessionId: z.string().min(1).optional(),
  utteranceId: z.string().min(1).optional(),
  event: AvatarEventSchema,
});

export type RuntimeEventEnvelope = z.infer<typeof RuntimeEventEnvelopeSchema>;

export const AvatarEventPayloadSchema = z.union([
  AvatarEventSchema,
  RuntimeEventEnvelopeSchema,
]);

export type AvatarEventPayload = z.infer<typeof AvatarEventPayloadSchema>;

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

export function extractAvatarEvent(payload: AvatarEventPayload): AvatarEvent {
  return 'event' in payload ? payload.event : payload;
}

export function isRuntimeEventEnvelope(
  payload: AvatarEventPayload,
): payload is RuntimeEventEnvelope {
  return 'version' in payload;
}

export function parseAvatarEventPayload(raw: unknown): AvatarEventPayload | null {
  const result = AvatarEventPayloadSchema.safeParse(raw);
  return result.success ? result.data : null;
}
