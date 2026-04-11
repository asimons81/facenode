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
