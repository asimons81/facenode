# FaceNode Runtime v1

## Executive recommendation

Do not spend the next upgrade wave adding more adapters.

FaceNode should use the current architecture as the base and push in one
direction: become a reliable Hermes-first avatar runtime with a stable event
contract, better timing realism, and a clean embeddable surface.

The immediate move is:

1. lock the runtime contract
2. harden Hermes as the canonical path
3. improve realism where timing is currently too coarse
4. extract the embeddable runtime surface from `apps/web-avatar`

## What FaceNode is now

### Strengths

- The current package split is directionally right
- `avatar-core` already owns the shared state and schema layer
- `HermesAdapterServer` and `HermesAdapterClient` already create a usable bridge
- `AvatarController` is a pragmatic orchestration point
- Tests already cover state transitions, viseme fallback, model swap races, and
  audio analyzer reconnect behavior

### Limits

- The contract is typed, but not versioned
- Hermes payload support is implemented as a mapper, not as a product-level
  runtime contract
- Timing semantics are too thin for high-quality speech realism
- The embeddable runtime lives in `apps/web-avatar`, which is a packaging smell
- The dashboard is still the most complete consumer, which means the repo is
  proving an internal app more than a reusable runtime

## Non-goals for v1

- supporting many adapters equally
- introducing a full plugin platform
- rewriting the state machine architecture
- building multi-avatar orchestration
- solving premium avatar asset delivery

## Phase 1: Runtime contract v1

### Goal

Turn `AvatarEvent` from an internal event union into a versioned runtime
contract that Hermes can target confidently.

### Why it matters

Right now the entire system depends on event names and a few optional fields.
That is acceptable for a demo, but weak for a runtime that needs to survive
producer changes, partial upgrades, and replay/debug tooling.

Without a versioned contract:

- Hermes changes will be risky
- consumers cannot reason about compatibility
- tests only validate shapes, not protocol expectations
- future adapters will copy loose behavior instead of targeting a stable spec

### Likely affected files and packages

- `packages/avatar-core/src/events.ts`
- `packages/avatar-core/src/index.ts`
- `packages/avatar-core/src/stateMachine.ts`
- `packages/avatar-core/src/eventReducer.ts`
- `packages/hermes-adapter/src/HermesAdapterServer.ts`
- `packages/hermes-adapter/src/MockHermesEmitter.ts`
- `README.md`
- `ARCHITECTURE.md`

### Proposed deliverables

- Introduce a versioned runtime envelope with a thin, explicit metadata layer:
  - Required, runtime-assigned: `version`, `sequence`, `timestamp`, `source`
  - Required, Hermes-supplied payload: `event`
  - Optional, Hermes-supplied when available: `sessionId`, `utteranceId`
- Define fallback behavior when metadata is absent:
  - Missing optional metadata is allowed and should be synthesized or left unset by the runtime bridge
  - Missing required runtime-assigned metadata should cause the envelope to be rejected at the contract boundary
  - Legacy raw `AvatarEvent` payloads can be accepted during the transition period, but they should be wrapped with generated runtime metadata before entering the controller path
- Keep the existing state/event model, but separate:
  - lifecycle events
  - speech timing events
  - expression events
  - transport/runtime error events
- Define required Hermes mappings in one place instead of scattering them across
  comments and test assumptions
- Add protocol fixtures for:
  - minimal happy path
  - reconnect during speech
  - missing `thinking_end`
  - repeated `speech_chunk`
  - viseme-only and amplitude-only speech
- Document compatibility policy:
  - what is stable
  - what is experimental
  - how version bumps work

### Risks and tradeoffs

- This adds some ceremony to a currently simple event layer
- Poorly chosen envelope fields could create churn
- If overdesigned now, it will slow the Hermes integration work

The correct move is a minimal but explicit v1, not a speculative “universal
agent event protocol.”

### Suggested test coverage

- schema tests for the v1 envelope and payload variants
- compatibility tests for old `AvatarEvent` payload acceptance if backward
  compatibility is kept temporarily
- Hermes mapping fixture tests
- reducer/state-machine tests proving lifecycle semantics under out-of-order
  events

## Phase 2: Hermes-first runtime hardening

### Goal

Make Hermes the canonical integration path and tighten the runtime around that
fact.

### Why it matters

The repo says Hermes is supported, but the code still treats Hermes mostly as a
translation layer. That is not strong enough if Hermes is the flagship
connector.

The Hermes path should be the best-tested, best-documented, most observable
path in the project.

### Likely affected files and packages

- `packages/hermes-adapter/src/HermesAdapterServer.ts`
- `packages/hermes-adapter/src/HermesAdapterClient.ts`
- `packages/hermes-adapter/src/MockHermesEmitter.ts`
- `packages/hermes-adapter/src/server.ts`
- `packages/hermes-adapter/test/*`
- `apps/dashboard/src/App.tsx`
- `apps/web-avatar/src/App.tsx`

### Proposed deliverables

- Treat Hermes mapping as a named protocol surface, not a local helper
- Add runtime diagnostics:
  - last Hermes event seen
  - current session/utterance ids
  - dropped payload counts
  - reconnect attempt counts
  - last protocol error
- Make reconnect semantics explicit:
  - upstream Hermes disconnected
  - local client disconnected
  - runtime degraded but still mounted
- Add “runtime status” separate from avatar animation state
- Provide a Hermes integration harness based on realistic event transcripts
- Make the dashboard explicitly identify when it is in Hermes mode and show
  mapping/runtime health

### Risks and tradeoffs

- More runtime status signals can confuse the UI if mixed with avatar state
- It will be tempting to add bi-directional control messages too early
- Hardening Hermes first may frustrate users asking for other adapters

That tradeoff is correct. Hermes depth is more valuable right now than adapter
breadth.

### Suggested test coverage

- `hermes-adapter` is included in the root test command and should stay there
- end-to-end integration tests:
  - Hermes payload -> server -> client -> controller
  - reconnect mid-session
  - malformed payload followed by recovery
  - duplicate or late speech lifecycle events
- dashboard tests for runtime status rendering and Hermes mode behavior

## Phase 3: Realism pass

### Goal

Improve human realism through better timing semantics, mouth behavior, and
expression support.

### Why it matters

The current realism layer is clever, but still coarse:

- amplitude simulation is a fallback, not a timing model
- viseme timeout is a single fixed threshold
- captions update chunk-by-chunk with no real utterance model
- there is no expression lane at all

The result is functional but still reads as a demo under sustained use.

### Likely affected files and packages

- `packages/avatar-core/src/events.ts`
- `packages/avatar-core/src/animationController.ts`
- `apps/web-avatar/src/AvatarController.ts`
- `apps/web-avatar/src/three/threeAnimationController.ts`
- `apps/web-avatar/src/audio/amplitudeAnalyzer.ts`
- `apps/web-avatar/src/three/avatarMesh.ts`
- `apps/dashboard/src/App.tsx`

### Proposed deliverables

- Add utterance-aware speech semantics:
  - `speech_start`
  - `speech_partial`
  - `speech_final`
  - `speech_end`
- Add expression events with a small controlled set:
  - `neutral`
  - `warm`
  - `curious`
  - `concerned`
  - `affirming`
- Improve timing behavior:
  - attack/decay smoothing on amplitude
  - configurable viseme hold and release
  - better speech end tail-off
- Add caption aggregation so subtitles show an utterance, not just the latest
  chunk
- Add expression hooks in the mesh/controller contract without forcing a full
  facial rig rewrite

### Risks and tradeoffs

- Expression work can sprawl into asset-pipeline work if not constrained
- Overfitting to the procedural avatar would be a mistake
- True realism depends on upstream timing quality; the runtime cannot invent all
  of it locally

Keep the first pass small and runtime-driven.

### Suggested test coverage

- controller tests for utterance aggregation and audio/viseme precedence
- animation tests for expression blending and viseme fallback
- snapshot-like tests for caption state and timing transitions
- contract tests validating expression events and timing fields

## Phase 4: Embeddable runtime surface

### Goal

Make FaceNode something another product can embed directly without importing a
demo app shell.

### Why it matters

Right now the most reusable runtime API is exported from `apps/web-avatar`,
which is the wrong boundary as the project grows.

That is manageable today, but it becomes a liability when:

- SDK/API stability matters
- multiple host apps need the runtime
- bundle size and packaging matter
- host apps want more control than the demo UI exposes

### Likely affected files and packages

- extract `AvatarController` and runtime-facing web code from
  `apps/web-avatar`
- create a package such as `packages/avatar-runtime-web`
- update `apps/web-avatar` to become a thin demo host
- update `apps/dashboard` to consume the new package
- add a focused embed example under `examples/`

### Proposed deliverables

- New public embed API, for example:
  - `createAvatarRuntime(container, options)`
  - `runtime.connectHermes(...)`
  - `runtime.dispatch(...)`
  - `runtime.updateConfig(...)`
  - `runtime.destroy()`
- Keep `AvatarController` internally if useful, but stop making an app package
  the public runtime package
- Separate demo-only UI from runtime API
- Add one production-style embed example with a simple host page

### Risks and tradeoffs

- This is the only phase that changes package boundaries materially
- Doing it too early would create churn
- Doing it too late will harden the wrong public API

That is why it should happen after contract stabilization and Hermes hardening,
not before.

### Suggested test coverage

- package-level API tests for the new runtime package
- embed smoke tests for mount/update/destroy/connect flows
- dashboard regression tests after migration to the extracted package

## What should wait

### Additional adapters

Wait until the Hermes-first contract is stable. Otherwise new adapters will be
built against a moving target.

### Multi-avatar scenes

Interesting, but it multiplies complexity before single-avatar runtime behavior
is fully hardened.

### WASM lip sync

Potentially strong later, but not the best next move while the runtime contract
and timing semantics are still underdefined.

### Streaming glTF and asset work

Valuable for scale, but FaceNode is not bottlenecked there yet.

## What not to prioritize yet

- “Adapter marketplace” thinking
- Native mobile UI work
- Cloud TTS provider sprawl
- Full sentiment engine architecture
- Major renderer rewrites

Those are all easy ways to create surface area without making the Hermes path
meaningfully more reliable.

## Milestone structure for GitHub

### Milestone A: Runtime contract v1

Suggested issues:

- define FaceNode runtime envelope v1
- update `AvatarEventSchema` and compatibility layer
- add Hermes mapping spec fixtures
- document runtime protocol and compatibility policy
- add contract regression tests to root test workflow

### Milestone B: Hermes runtime hardening

Suggested issues:

- refactor Hermes mapping into explicit protocol module
- add Hermes runtime diagnostics and counters
- separate runtime connection health from avatar state
- add reconnect and malformed-payload integration tests
- update dashboard to surface Hermes runtime health

### Milestone C: Realism pass

Suggested issues:

- add utterance-aware speech event model
- implement subtitle aggregation for partial/final speech
- add amplitude smoothing and viseme hold/release tuning
- add minimal expression channel and controller support
- add realism regression tests

### Milestone D: Embeddable runtime extraction

Suggested issues:

- create `avatar-runtime-web` package
- migrate dashboard to runtime package
- turn `apps/web-avatar` into demo host only
- add minimal embed example
- finalize public runtime API docs

## Repo-shape risks to address now

### 1. `apps/web-avatar` is acting like a package

This is the biggest structural smell.

`apps/web-avatar/package.json` exports `AvatarController`, and
`apps/dashboard` consumes it directly. That works in a monorepo, but it mixes
demo-host concerns with reusable runtime concerns. The current boundary will
become brittle as soon as external embedding matters.

### 2. Root test coverage depends on package-local `test` scripts

`packages/hermes-adapter` and `apps/dashboard` now participate in root test
coverage because they define `test` scripts. That is the correct pattern, but it
is convention-based rather than enforced, so new workspace packages with tests
can still be skipped if they forget to add the script.

### 3. The contract is renderer-biased

The SDK is intentionally minimal, but the current event set is really a
renderer-control protocol rather than a runtime conversation model. That is why
timing, utterance identity, and expressions are missing.

### 4. Runtime state and connection state are conflated

`AvatarState` includes `disconnected` and `error`, while the Hermes client also
tracks WebSocket status separately. That split is survivable now, but it will
cause confusion as runtime health gets richer. FaceNode needs a clean boundary
between:

- avatar behavioral state
- runtime transport state
- protocol health

### 5. Mapping logic is too embedded in adapter code

`mapHermesPayload()` is a private helper in `HermesAdapterServer.ts`. If Hermes
is central, that mapping should be a named protocol surface with its own tests,
fixtures, and docs.

## Final recommendation

Treat the next major upgrade as “FaceNode Runtime v1,” not “more adapter work.”

The sequence should be:

1. version and document the contract
2. harden the Hermes runtime path
3. improve realism through better timing and expression semantics
4. extract the embeddable runtime surface from the app package

That is the highest-confidence path to turning FaceNode from a convincing demo
into a serious Hermes-first runtime without rewriting the whole system.
