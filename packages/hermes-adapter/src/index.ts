/**
 * @facenode/hermes-adapter — browser-safe entry point.
 *
 * Exports only HermesAdapterClient (uses native browser WebSocket).
 * Server-side classes (HermesAdapterServer, MockHermesEmitter) are
 * Node.js-only and exported from the "./server" subpath to prevent
 * bundlers from pulling in the `ws` package.
 */
export { HermesAdapterClient } from './HermesAdapterClient.js';
export type { HermesAdapterClientOptions, WsStatus } from './HermesAdapterClient.js';
