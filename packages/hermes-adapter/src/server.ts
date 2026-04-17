/**
 * @facenode/hermes-adapter/server — Node.js-only entry point.
 *
 * Import this from server-side code only.  Never import it in Vite
 * app code — it pulls in `ws` which is not available in the browser.
 */
export { HermesAdapterServer } from './HermesAdapterServer.js';
export type { HermesAdapterServerOptions } from './HermesAdapterServer.js';
export { normalizeIncomingPayload } from './hermesProtocol.js';
export type {
  HermesCorrelationState,
  HermesNormalizationContext,
  HermesNormalizationResult,
} from './hermesProtocol.js';

export { MockHermesEmitter } from './MockHermesEmitter.js';
export type { MockHermesEmitterOptions } from './MockHermesEmitter.js';
