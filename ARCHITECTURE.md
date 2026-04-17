# FaceNode — Architecture

## Package dependency graph

```
avatar-core          (no internal deps)
    ↑
avatar-sdk           (re-exports AvatarState, AvatarEvent; adds AvatarEventDispatcher)
    ↑
hermes-adapter       (depends on avatar-core + avatar-sdk)
    ↑
web-avatar           (depends on avatar-core + avatar-sdk + hermes-adapter)
    ↑
dashboard            (depends on all of the above)

ui                   (standalone design tokens — no deps)
```

All packages use source-based exports (`"main": "./src/index.ts"`) so Vite resolves
them directly without a pre-build step. TypeScript project references ensure
incremental typechecking across the graph.

---

## Event flow

```
Hermes AI agent
    │  WS (Hermes-format JSON)
    ▼
HermesAdapterServer          packages/hermes-adapter
    │  normalizeIncomingPayload()
    │  RuntimeEventEnvelopeSchema.safeParse()
    │  WS (RuntimeEventEnvelope + runtime diagnostics)
    ▼
HermesAdapterClient          packages/hermes-adapter (browser)
    │  RuntimeTransportMessageSchema.safeParse()
    │  sequence / drop enforcement
    │  controller.dispatch(envelope.event)
    ▼
AvatarController             apps/web-avatar
    │  machine.transition(event)
    │  animController.onEnterState / setMouthAmplitude / applyVisemeFrame
    ▼
ThreeAnimationController     apps/web-avatar
    │  head rotations, blink, Layer 1 / Layer 2 lip sync
    ▼
Three.js scene               apps/web-avatar
    └  60 fps render loop
```

**MockHermesEmitter** (`packages/hermes-adapter`) can stand in for a live Hermes
instance. With `hermesMode: false` (default) it emits Runtime Contract v1
envelopes directly to HermesAdapterClient for quick local demos. With
`hermesMode: true` it emits Hermes-format JSON and must be fronted by a
HermesAdapterServer, which is the canonical Hermes-first runtime path and the
point where Runtime Contract v1 envelopes and diagnostics are assigned.

---

## State machine transition table

| Current state  | Event            | Next state     |
|---------------|-----------------|----------------|
| any            | `connected`      | `idle`         |
| any            | `disconnected`   | `disconnected` |
| any            | `error`          | `error`        |
| `idle`         | `listening_start`| `listening`    |
| `listening`    | `listening_end`  | `idle`         |
| `idle/listening`| `thinking_start`| `thinking`     |
| `thinking`     | `thinking_end`   | `idle`         |
| `thinking/idle`| `speech_start`   | `speaking`     |
| `speaking`     | `speech_end`     | `idle`         |
| any            | `speech_chunk`   | *(no change)*  |
| any            | `viseme_frame`   | *(no change)*  |

Invalid directional transitions are silently ignored with a `console.warn`.
Universal events (`connected`, `disconnected`, `error`) never warn — they reset from
any state by design.

---

## Lip sync layers

### Layer 1 — amplitude envelope

Active whenever the avatar is in `speaking` state. Each `speech_chunk` event carries
an `amplitude` value in [0, 1]. `AvatarController` uses it as an envelope base,
multiplied by a double-sine at 8.5 Hz and 2.3 Hz to simulate natural mouth flutter
at 60 fps between events. `speakingSensitivity` scales the result.

If a real audio element is connected via `setAudioSource()`, an `AnalyserNode`
provides actual amplitude, replacing the simulation.

### Layer 2 — viseme frames

`viseme_frame` events carry an OVR-standard 15-viseme array (weights in [0, 1]).
`ThreeAnimationController.applyVisemeFrame()` calls `setViseme()` on the active mesh
for each phoneme, then — for the procedural mesh — flushes accumulated openness into
the mouth morph target.

**Fallback:** a 100 ms timer resets after each frame. If no new frame arrives within
that window, Layer 2 deactivates and Layer 1 amplitude takes over immediately. This
ensures smooth lip movement even when viseme delivery is intermittent.

### Viseme set (OVR standard)

`sil PP FF TH DD kk CH SS nn RR aa E ih oh ou`

---

## AvatarMesh interface — model swapping

`AvatarMesh` is an interface implemented by two classes:

- **`ProceduralAvatarMesh`** — built entirely from Three.js primitives (sphere head,
  cylinder neck, sphere eyes, circle mouth with one morph target). No external assets
  required.

- **`GltfAvatarMesh`** — loads any `.glb`/`.gltf` file via `THREE.GLTFLoader`. Drives
  lip sync through morph targets named `mouthOpen` / `jawOpen`. Drives blink through
  `eyeBlinkLeft` / `eyeBlinkRight` (Ready Player Me / VRM naming). Falls back to
  `ProceduralAvatarMesh` if the load fails.

`AvatarController.setAvatarModel()` hot-swaps the mesh without restarting the scene:
it removes the old mesh, loads the new one, reconnects `ThreeAnimationController` to
the new target, and re-applies skin color.

---

## Key design decisions

### Browser / server split in hermes-adapter

`hermes-adapter` exports two entry points:

- `index.ts` — `HermesAdapterClient` only (browser-safe, no `ws` import)
- `server.ts` — `HermesAdapterServer` + `MockHermesEmitter` (Node.js only)

This keeps Vite from bundling the Node.js `ws` module into the browser bundle.

### Config lives in avatar-core

`AvatarConfigSchema` is in `avatar-core` (not `dashboard`) so any consumer — a test,
a custom React app, a non-browser host — can import the schema and defaults without
pulling in the dashboard. The dashboard owns persistence (`localStorage`) but not the
schema.

### AvatarMesh as interface

Separating the interface from implementations means `ThreeAnimationController` never
needs to know which mesh it's driving. This made adding glTF support a zero-change to
the animation layer — only `AvatarController.setAvatarModel()` needed updating.

### No iframe in dashboard

The dashboard instantiates `AvatarController` directly in the center column rather
than embedding the web-avatar app in an iframe. This allows the config controls to
call controller methods synchronously with no postMessage overhead.
