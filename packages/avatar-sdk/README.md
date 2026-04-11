# @facenode/avatar-sdk

Minimal adapter interface for connecting any agent system to FaceNode.

## What it does

Exports the `AvatarEventDispatcher` interface — the only contract an adapter needs to satisfy to feed events into an `AvatarController`. Using this interface instead of importing `AvatarController` directly keeps adapters free of Three.js and browser dependencies.

## Install

```bash
pnpm add @facenode/avatar-sdk
```

## Usage

```ts
import type { AvatarEventDispatcher } from '@facenode/avatar-sdk';

export class MyAgentAdapter {
  constructor(private readonly controller: AvatarEventDispatcher) {}

  onAgentEvent(raw: unknown): void {
    // translate raw → AvatarEvent, then:
    this.controller.dispatch({ type: 'listening_start' });
  }
}
```

`AvatarController` (from `@facenode/web-avatar`) implements `AvatarEventDispatcher`, as does any test double you write.

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for a full guide to adding a new adapter.
