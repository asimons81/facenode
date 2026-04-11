#!/usr/bin/env tsx
/**
 * Mock Hermes emitter — dev/demo entry point.
 *
 * Usage:
 *   pnpm mock                         # AvatarEvent mode, default port 3456
 *   pnpm mock --hermes-mode           # Hermes payload mode (test full translation path)
 *   PORT=9000 pnpm mock               # custom port
 *
 * hermes-mode:
 *   Emits raw Hermes-format payloads instead of AvatarEvent JSON.
 *   Pair with HermesAdapterServer (hermesWsUrl pointing here) to exercise the
 *   full Hermes → HermesAdapterServer → HermesAdapterClient → AvatarController path.
 *
 *   Example:
 *     pnpm mock --hermes-mode                 # mock on :3456
 *     # In a separate process:
 *     node -e "
 *       const {HermesAdapterServer} = await import('./dist/server.js');
 *       const s = new HermesAdapterServer({ port: 3457, hermesWsUrl: 'ws://localhost:3456' });
 *       await s.start();
 *     "
 *     # Connect web-avatar to ws://localhost:3457
 */
import { MockHermesEmitter } from '../MockHermesEmitter.js';

const port = Number(process.env['PORT'] ?? 3456);
const hermesMode = process.argv.includes('--hermes-mode');

const emitter = new MockHermesEmitter({ port, hermesMode });

await emitter.start();

console.log('[mock] Press Ctrl+C to stop.\n');

process.on('SIGINT', async () => {
  console.log('\n[mock] Shutting down…');
  await emitter.stop();
  process.exit(0);
});
