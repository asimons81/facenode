export { AvatarEventSchema } from './events.js';
export type { AvatarEvent } from './events.js';
export {
  RUNTIME_EVENT_VERSION,
  RuntimeEnvelopeMetadataSchema,
  RuntimeEventEnvelopeSchema,
  RuntimeDropReasonSchema,
  RuntimeConnectionStateSchema,
  RuntimeDiagnosticsSchema,
  AvatarEventPayloadSchema,
  RuntimeTransportMessageSchema,
  createRuntimeEventEnvelope,
  createRuntimeDiagnostics,
  extractAvatarEvent,
  isRuntimeEventEnvelope,
  parseAvatarEventPayload,
  parseRuntimeTransportMessage,
  validateAvatarEventPayload,
  validateRuntimeTransportMessage,
} from './events.js';
export type {
  RuntimeEventEnvelope,
  RuntimeDropReason,
  RuntimeConnectionState,
  RuntimeDiagnostics,
  AvatarEventPayload,
  RuntimeTransportMessage,
  PayloadValidationResult,
} from './events.js';

export { AvatarConfigSchema, defaultConfig } from './config.js';
export type { AvatarConfig } from './config.js';

export type { AvatarState } from './stateMachine.js';
export { AvatarStateMachine } from './stateMachine.js';

export { reduceEvent } from './eventReducer.js';

export type { AnimationController, VisemeFrame } from './animationController.js';
export { VISEMES } from './animationController.js';
export type { Viseme } from './animationController.js';
