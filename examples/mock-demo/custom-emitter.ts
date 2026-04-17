#!/usr/bin/env tsx
/**
 * custom-emitter.ts — minimal example of using MockHermesEmitter programmatically
 * with a custom event sequence.
 *
 * Run: npx tsx custom-emitter.ts
 */
import { createRuntimeEventEnvelope } from '@facenode/avatar-core';

// MockHermesEmitter accepts a SEQUENCE of steps (event | wait) but those are
// internal. For full control, subclass it or use HermesAdapterServer + explicit runtime envelopes:

import { HermesAdapterServer } from '../../packages/hermes-adapter/src/server.js';

const PORT = 3456;

const server = new HermesAdapterServer({ port: PORT });
await server.start();

console.log(`[custom-emitter] Server ready on ws://localhost:${PORT}`);
console.log('[custom-emitter] Sending custom sequence in 2 seconds…');

await sleep(2000);

// Custom sequence: jump straight to speaking
server.broadcast(runtimeEvent({ type: 'connected' }));
await sleep(500);

server.broadcast(runtimeEvent({ type: 'speech_start' }));
await sleep(300);

const lines = [
  { text: 'Welcome to FaceNode.', amplitude: 0.6 },
  { text: 'Welcome to FaceNode. This is', amplitude: 0.75 },
  { text: 'Welcome to FaceNode. This is a custom', amplitude: 0.65 },
  { text: 'Welcome to FaceNode. This is a custom emitter.', amplitude: 0.8 },
];

for (const line of lines) {
  server.broadcast(runtimeEvent({ type: 'speech_chunk', text: line.text, amplitude: line.amplitude }));
  await sleep(600);
}

server.broadcast(runtimeEvent({ type: 'speech_end' }));
await sleep(2000);

server.broadcast(runtimeEvent({ type: 'disconnected' }));
await server.stop();
console.log('[custom-emitter] Done.');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let runtimeSequence = 0;

function runtimeEvent(event: Parameters<typeof createRuntimeEventEnvelope>[0]) {
  runtimeSequence += 1;
  return createRuntimeEventEnvelope(event, {
    source: 'custom-emitter',
    sequence: runtimeSequence,
  });
}
