# @facenode/avatar-core

State machine, Zod event schemas, animation controller interface, and shared config for FaceNode.

This package has no browser or Node.js-specific dependencies — it is safe to import in any environment.

## What it does

- **`AvatarEventSchema`** — Zod discriminated union validating all 11 event types (`connected`, `speech_chunk`, `viseme_frame`, etc.)
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
import { AvatarStateMachine, AvatarEventSchema } from '@facenode/avatar-core';

const machine = new AvatarStateMachine();

machine.onChange((next, prev) => {
  console.log(`${prev} → ${next}`);
});

// Validate and dispatch an incoming WebSocket message
const result = AvatarEventSchema.safeParse(JSON.parse(rawMessage));
if (result.success) {
  machine.transition(result.data);
}
```

See [ARCHITECTURE.md](../../ARCHITECTURE.md) for the full state transition table and event flow.
