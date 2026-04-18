# @facenode/avatar-core

State machine, Zod event schemas, animation controller interface, and shared config for FaceNode.

This package has no browser or Node.js-specific dependencies — it is safe to import in any environment.

## What it does

- **`AvatarEventSchema`** — Zod discriminated union validating all 11 avatar lifecycle and lip-sync event types
- **`RuntimeEventEnvelopeSchema`** — canonical Runtime Contract v1 envelope used on transport-facing paths
- **`RuntimeDiagnosticsSchema`** — runtime health snapshot schema used alongside envelopes on transport-facing paths
- **`RuntimeEventProducer`** — small producer-facing helper for sequenced, correlated envelope authoring
- **`AvatarStateMachine`** — typed state machine with `on(state, cb)` and `onChange(cb)` subscriptions
- **`reduceEvent`** — pure function mapping `(state, event) → nextState`
- **`AnimationController`** — interface for Three.js (or any renderer) to implement
- **`AvatarConfigSchema`** — Zod schema for all runtime config (connection, appearance, animation, HUD, model)
- **`VISEMES` / `Viseme`** — OVR 15-viseme set constant and type

## Install

```bash
pnpm add @facenode/avatar-core
```

## Usage

```ts
import {
  AvatarStateMachine,
  createRuntimeEventProducer,
  extractAvatarEvent,
  parseRuntimeTransportMessage,
} from '@facenode/avatar-core';

const machine = new AvatarStateMachine();

machine.onChange((next, prev) => {
  console.log(`${prev} → ${next}`);
});

// Validate and dispatch an incoming WebSocket message
const message = parseRuntimeTransportMessage(JSON.parse(rawMessage));
if (message && !('kind' in message)) {
  machine.transition(extractAvatarEvent(message));
}

const producer = createRuntimeEventProducer({ source: 'demo-producer' });
const envelope = producer.speechChunk({ text: 'hello', amplitude: 0.5 });
```

See [ARCHITECTURE.md](../../ARCHITECTURE.md) for the full state transition table and event flow.

## Producer Guide

Use `createRuntimeEventProducer(...)` when you are authoring a non-Hermes event
stream that should emit valid Runtime Contract v1 envelopes on the transport
path.

Do not use it for Hermes normalization or other adapter-edge translation work.
Those paths should continue to use the lower-level envelope authoring path where
they need tight control over incoming payload handling.

### Producer lifecycle

- `source` identifies the producer and should stay stable for that stream.
- `sequence` is maintained by the producer instance and must increase
  monotonically for that producer/source.
- `sessionId` and `utteranceId` are explicit producer state. Set or clear them
  when your producer knows that correlation changed.
- Per-envelope overrides are allowed, including `null` to omit a correlation
  field for a single emitted envelope.

### Helper surface

- Generic: `event(...)`
- Lifecycle: `connected`, `disconnected`, `listeningStart`, `listeningEnd`,
  `thinkingStart`, `thinkingEnd`
- Speech: `speechStart`, `speechChunk`, `speechEnd`
- Lip sync: `visemeFrame`
- Error: `error`

### Minimal example

```ts
import { createRuntimeEventProducer } from '@facenode/avatar-core';

const producer = createRuntimeEventProducer({ source: 'demo-producer' });

const envelope = producer.thinkingStart();
```

### Streaming example

```ts
import { createRuntimeEventProducer } from '@facenode/avatar-core';

const producer = createRuntimeEventProducer({
  source: 'demo-producer',
  sessionId: 'session-1',
});

producer.setUtterance('utt-1');

send(producer.speechStart());
send(producer.speechChunk({ text: 'Hello', amplitude: 0.42 }));
send(producer.speechChunk({ text: 'Hello there', amplitude: 0.55 }));
send(producer.speechEnd());
```

### Custom event example

```ts
import { createRuntimeEventProducer } from '@facenode/avatar-core';

const producer = createRuntimeEventProducer({ source: 'demo-producer' });

send(producer.event({
  type: 'viseme_frame',
  timestamp: 240,
  visemes: [{ viseme: 'aa', weight: 0.8 }],
}));
```

### Hard rules

- Transport is envelope-only.
- Sequence must be monotonic per producer/source.
- Correlation is explicit producer state, not implicit magic.
- Non-Hermes producers should not hand-roll runtime envelopes when the producer
  API fits.
