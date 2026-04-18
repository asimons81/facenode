# FaceNode Roadmap

## Current status

Milestone 1 and Milestone 2 of the Hermes-first runtime work are complete:

- Runtime Contract v1 is versioned and documented.
- Hermes payload normalization is explicit and fixture-covered.
- Runtime diagnostics now expose connection state, reconnect attempts, last accepted event, drop visibility, and session/utterance correlation.
- Runtime envelope ordering, duplicate handling, and malformed transport rejection are intentional and tested.
- Upstream Hermes disconnects reset downstream avatar lifecycle deterministically before reconnect.

The next meaningful step is Milestone 3, not more Milestone 2 cleanup.

## Milestone 3: Realism pass

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

## Milestone 4: Embeddable runtime surface

Goal: make FaceNode easy to embed into another product without dragging the dashboard along.

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

Hermes depth still matters more than adapter breadth, but the next investment should improve realism and embeddability rather than revisit Milestone 2 basics.
