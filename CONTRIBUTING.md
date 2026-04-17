# Contributing to FaceNode

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20.0.0 |
| pnpm | ≥ 9.0.0 |

## Setup

```bash
git clone https://github.com/asimons81/facenode.git
cd facenode
pnpm install
```

## Scripts reference

| Command | What it does |
|---------|-------------|
| `pnpm mock` | Start mock event emitter on ws://localhost:3456 |
| `pnpm mock --hermes-mode` | Mock emitting raw Hermes-format payloads |
| `pnpm --filter @facenode/web-avatar dev` | Start avatar renderer on :5173 |
| `pnpm --filter @facenode/dashboard dev` | Start dashboard on :5174 |
| `pnpm test` | Run all tests across all packages |
| `pnpm typecheck` | TypeScript project-reference build check |
| `pnpm build` | Production build of all packages and apps |
| `pnpm --filter <pkg> typecheck` | Typecheck a single package |
| `pnpm --filter <pkg> test` | Test a single package |

If a workspace package contains tests, it must define its own `test` script.
Root `pnpm test` only runs package scripts, so missing scripts silently skip
coverage.

## Commit convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(hermes-adapter): add hermesMode to MockHermesEmitter
fix(web-avatar): prevent viseme timer from running in disconnected state
docs: update ARCHITECTURE with glTF model-swap flow
test(avatar-core): add viseme_frame schema rejection cases
```

**Types:** `feat` `fix` `docs` `test` `refactor` `perf` `chore`

## PR process

1. Branch from `main`: `git checkout -b feat/my-feature`
2. Make changes; ensure `pnpm typecheck` and `pnpm test` pass
3. Open a PR against `main` using the PR template
4. One approving review required before merge

## Adding a new adapter

All adapters must implement `AvatarEventDispatcher` from `@facenode/avatar-sdk`:

```ts
import type { AvatarEventDispatcher } from '@facenode/avatar-sdk';

export class MyAdapter {
  constructor(private readonly controller: AvatarEventDispatcher) {}

  // On receiving an event from your source:
  // this.controller.dispatch({ type: 'listening_start' });
}
```

Create a new package under `packages/` following the same structure as
`packages/hermes-adapter`. The adapter must NOT import from `apps/web-avatar` —
depend only on `avatar-core` and `avatar-sdk`.

## Adding a new avatar model

Implement the `AvatarMesh` interface from `apps/web-avatar/src/three/avatarMesh.ts`:

```ts
import type { AvatarMesh } from '@facenode/web-avatar';

export class MyAvatarMesh implements AvatarMesh {
  // ...implement group, headGroup, eyeL, eyeR
  // ...implement setMouthAmplitude, setViseme, setSkinColor, setHeadColor, resetHeadColor, dispose
}
```

Then call `AvatarController.setAvatarModel()` — or extend its `model` enum — to wire
your implementation into the hot-swap flow.
