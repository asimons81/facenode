# FaceNode Roadmap

## v0.1.0 — Shipped ✅

- Monorepo scaffold (pnpm workspaces, TypeScript project references)
- `avatar-core`: Zod event schema, state machine, `AnimationController` interface, `AvatarConfig` schema
- `web-avatar`: Three.js scene, procedural avatar mesh, state animations, Layer 1 lip sync, React shell with captions
- `hermes-adapter`: `HermesAdapterServer`, `HermesAdapterClient` (auto-reconnect), `MockHermesEmitter` (scripted loop)
- Dashboard: three-column layout, all config controls, live avatar preview, event log, localStorage persistence

## v0.2.0 — Current 🚧

- **Real Hermes wiring**: `HermesAdapterServer` translates Hermes-native JSON → `AvatarEvent` with exponential backoff reconnection
- **glTF model support**: `GltfAvatarMesh` loads any `.glb`/`.gltf`; hot-swap via `setAvatarModel()`; fallback to procedural on error
- **Layer 2 viseme pipeline**: OVR 15-viseme set, `applyVisemeFrame()`, 100 ms Layer 1 fallback, `viseme_frame` in mock sequence
- **Dashboard model selector**: segmented control + URL input + load button in Appearance section
- **OSS release polish**: README, ARCHITECTURE, CONTRIBUTING, ROADMAP, per-package READMEs, package.json metadata, examples

## Future

- **Additional adapters**: OpenAI Realtime API, ElevenLabs streaming, VAPI, LiveKit
- **Cloud TTS integration**: detect `speech_start.audioUrl` and auto-connect the audio element for real amplitude
- **Mobile dashboard**: responsive layout, touch-friendly controls
- **Multi-avatar scenes**: `MultiAvatarController` managing N avatars with independent state machines
- **Expression system**: Layer 3 — facial expression blendshapes (happy, curious, confused) driven by sentiment from the LLM
- **WASM lip sync**: on-device phoneme extraction from audio PCM → `viseme_frame` without a server-side pipeline
- **Streaming glTF**: LOD-aware progressive loading for large production avatars
