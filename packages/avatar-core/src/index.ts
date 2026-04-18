export { AvatarEventSchema } from './events.js';
export type { AvatarEvent } from './events.js';
export {
  RUNTIME_EVENT_VERSION,
  RuntimeEnvelopeMetadataSchema,
  RuntimeEventEnvelopeSchema,
  RuntimeDropReasonSchema,
  RuntimeConnectionStateSchema,
  RuntimeDiagnosticsSchema,
  RuntimeTransportMessageSchema,
  createRuntimeEventEnvelope,
  createRuntimeDiagnostics,
  extractAvatarEvent,
  isRuntimeEventEnvelope,
  parseRuntimeEventEnvelope,
  parseRuntimeTransportMessage,
  validateRuntimeEventEnvelope,
  validateRuntimeTransportMessage,
} from './events.js';
export type {
  RuntimeEventEnvelope,
  RuntimeDropReason,
  RuntimeConnectionState,
  RuntimeDiagnostics,
  RuntimeTransportMessage,
  PayloadValidationResult,
} from './events.js';

export { AvatarConfigSchema, defaultConfig } from './config.js';
export type { AvatarConfig } from './config.js';

export { RuntimeEventProducer, createRuntimeEventProducer } from './producer.js';
export type {
  RuntimeEventProducerOptions,
  RuntimeCorrelation,
  RuntimeEnvelopeAuthoringOptions,
  SpeechStartOptions,
  SpeechChunkOptions,
  VisemeFrameOptions,
} from './producer.js';

export type { AvatarState } from './stateMachine.js';
export { AvatarStateMachine } from './stateMachine.js';

export { reduceEvent } from './eventReducer.js';

export type { AnimationController, VisemeFrame } from './animationController.js';
export { VISEMES, VISEME_OPENNESS } from './animationController.js';
export type { Viseme } from './animationController.js';

export { CaptionTimeline } from './captionTimeline.js';
export type { CaptionSnapshot, CaptionTimelineOptions } from './captionTimeline.js';
