# @facenode/web-avatar

Three.js avatar renderer — procedural and glTF mesh, state animations, dual-layer lip sync, React shell.

## What it does

- **Procedural mesh** — head, neck, eyes, and mouth built from Three.js primitives; no external assets
- **glTF mesh** — load any `.glb`/`.gltf` file; drives lip sync via `mouthOpen` morph target, blink via `eyeBlinkLeft`/`eyeBlinkRight`
- **State animations** — per-state head bob, tilt, and rotation; error/disconnect color tints
- **Layer 1 lip sync** — amplitude envelope at 60 fps from `speech_chunk.amplitude`
- **Layer 2 lip sync** — OVR 15-viseme frames; automatic Layer 1 fallback after 100 ms silence
- **`AvatarController`** — single entry point wiring all subsystems; all config hot-applies to the live scene

## Dev server

```bash
pnpm --filter @facenode/web-avatar dev
# → http://localhost:5173
```

## AvatarController API

```ts
import { AvatarController } from '@facenode/web-avatar';

const ctrl = new AvatarController(document.getElementById('canvas-container'));

// Feed events (from HermesAdapterClient or any source)
ctrl.dispatch({ type: 'listening_start' });

// Config — all hot-apply
ctrl.setSkinColor('#c8956a');
ctrl.setBackgroundColor('#0a0a0a');
ctrl.setCameraPreset('bust');         // 'head' | 'bust' | 'wide'
ctrl.setEnvironmentPreset('studio');  // 'none' | 'soft' | 'studio'
ctrl.setIdleIntensity(0.8);           // 0–1
ctrl.setBlinkFrequency('fast');       // 'slow' | 'normal' | 'fast'
ctrl.setSpeakingSensitivity(0.7);     // 0–1

// glTF model hot-swap
await ctrl.setAvatarModel('gltf', 'https://example.com/avatar.glb');
await ctrl.setAvatarModel('procedural'); // revert

// Subscribe
const unsub = ctrl.onStateChange((next, prev) => { ... });
const unsub2 = ctrl.onEvent((event) => { ... });

// Cleanup
ctrl.destroy();
```

See [ARCHITECTURE.md](../../ARCHITECTURE.md) for lip sync layer details.
