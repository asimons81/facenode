# FaceNode Roadmap

## Current reality

FaceNode already has the right core shape:

- `avatar-core` defines the event/state contract and shared config
- `hermes-adapter` translates Hermes payloads and handles transport
- `web-avatar` renders and animates the avatar
- `dashboard` proves the controller can be configured live

The problem is not that the architecture is wrong. The problem is that the
runtime contract is still too implicit, Hermes is not yet treated as the
product-default runtime path, and the embeddable surface still lives inside an
app package rather than a dedicated runtime package.

## Next major upgrade wave

### Milestone 1: Runtime contract v1

Goal: make the event contract stable, versioned, and testable before adding
more breadth.

Deliver:

- Versioned runtime envelope for FaceNode events
- Explicit Hermes-to-runtime mapping spec
- Event/session/utterance correlation fields
- Contract fixtures and compatibility tests
- Runtime docs for producers and consumers

Primary packages:

- `packages/avatar-core`
- `packages/hermes-adapter`
- `ARCHITECTURE.md`
- `README.md`

### Milestone 2: Hermes-first runtime hardening

Goal: make Hermes the reliable flagship integration path instead of one adapter
among many.

Deliver:

- Hermes protocol surface clarified and documented
- Better upstream lifecycle handling and observability
- Stronger message validation, drop reasons, and reconnect semantics
- Hermes integration fixtures covering realistic event sequences
- Dashboard and renderer defaults tuned for Hermes-first usage

Primary packages:

- `packages/hermes-adapter`
- `apps/dashboard`
- `apps/web-avatar`

### Milestone 3: Realism pass

Goal: improve human realism through timing, audio, and expression behavior.

Deliver:

- Better utterance timing model
- Smarter amplitude smoothing and hold/release behavior
- Expression channel layered on top of state and visemes
- Subtitle/caption timing cleanup
- Regression tests for sync and expression blending

Primary packages:

- `packages/avatar-core`
- `apps/web-avatar`
- `apps/dashboard`

### Milestone 4: Embeddable runtime surface

Goal: make FaceNode easy to drop into another product without dragging the
dashboard along.

Deliver:

- Dedicated embeddable web runtime package
- Cleaner public API for mount / update / destroy / connect
- Host configuration surface separated from internal demo controls
- Reference embed example

Primary packages:

- new package extracted from `apps/web-avatar`
- `apps/dashboard`
- `examples/`

## What should wait

- Additional adapters beyond Hermes
- Multi-avatar scenes
- WASM phoneme extraction
- Streaming glTF and large-scale asset delivery work

Those are valid later bets, but none of them matter if the Hermes runtime
contract is still squishy.

## What should not be prioritized yet

- Broad adapter matrix work
- Native mobile experiences
- Heavy cloud orchestration features
- Deep avatar asset pipeline work

FaceNode should first become the best way to render a Hermes-backed talking
head reliably.
