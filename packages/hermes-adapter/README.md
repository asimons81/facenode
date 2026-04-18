# @facenode/hermes-adapter

WebSocket bridge between Hermes AI agent events and FaceNode avatar events.

## What it does

- **`HermesAdapterServer`** (Node.js) normalizes Hermes-native payloads into Runtime Contract v1 envelopes, rebroadcasts them, and emits runtime diagnostics snapshots.
- **`HermesAdapterClient`** (browser) validates runtime transport messages, enforces per-source sequence ordering, dispatches typed avatar events to `AvatarController`, and exposes runtime diagnostics to the UI.
- **`MockHermesEmitter`** (Node.js) provides scripted runtime-envelope and Hermes-native streams for dev, demo, and fixture-driven tests.

## Hermes payload mapping

When `hermesWsUrl` is set, `HermesAdapterServer` accepts these Hermes-native JSON shapes:

| Hermes payload | AvatarEvent |
|---|---|
| `{ "event": "ready" }` | `connected` |
| `{ "event": "disconnect" }` | `disconnected` |
| `{ "event": "user.speech.start" }` | `listening_start` |
| `{ "event": "user.speech.end" }` | `listening_end` |
| `{ "event": "llm.start" }` | `thinking_start` |
| `{ "event": "llm.end" }` | `thinking_end` |
| `{ "event": "tts.start", "audio_url": "..." }` | `speech_start` |
| `{ "event": "tts.chunk", "text": "...", "amplitude": 0.6 }` | `speech_chunk` |
| `{ "event": "tts.end" }` | `speech_end` |
| `{ "event": "tts.viseme", "timestamp": 1234, "visemes": [...] }` | `viseme_frame` |
| `{ "event": "error", "message": "..." }` | `error` |

Unrecognized Hermes events are dropped as `unknown_hermes_event`. Malformed Hermes payloads are dropped as `invalid_hermes_payload`. Runtime transport stays envelope-only; bare `AvatarEvent` payloads are rejected as `invalid_runtime_payload`.

## Validation and ordering semantics

- Invalid WebSocket JSON is dropped as `invalid_json`.
- Runtime envelopes are validated before dispatch.
- Runtime ordering is enforced per `source`.
- Equal sequence numbers are dropped as `duplicate_runtime_event`.
- Lower sequence numbers are dropped as `out_of_order_runtime_event`.
- Session and utterance correlation are carried forward across Hermes payloads until a lifecycle boundary clears them.

## Reconnect semantics

- `HermesAdapterServer` retries upstream Hermes with exponential backoff (`1s`, `2s`, `4s`, `8s`, `16s`) up to 5 attempts.
- If upstream Hermes drops after a successful connection, the server emits a synthetic `disconnected` runtime envelope immediately so downstream avatars leave active speech deterministically before reconnecting.
- Retry exhaustion is visible through diagnostics `connectionState: 'error'` and reconnect counts.
- `HermesAdapterClient` separately retries its local WebSocket with the same bounded backoff policy and dispatches a local `disconnected` event once per outage.

## Install

```bash
pnpm add @facenode/hermes-adapter
```

```ts
import { HermesAdapterClient } from '@facenode/hermes-adapter';
import { HermesAdapterServer, MockHermesEmitter } from '@facenode/hermes-adapter/server';
```

## Usage

### Running the mock

```bash
pnpm mock
pnpm mock --hermes-mode
PORT=9000 pnpm mock
```

### HermesAdapterServer

```ts
import { HermesAdapterServer } from '@facenode/hermes-adapter/server';

const server = new HermesAdapterServer({
  port: 3456,
  hermesWsUrl: 'ws://hermes.local:8080',
});
await server.start();
```

### HermesAdapterClient

```ts
import { HermesAdapterClient } from '@facenode/hermes-adapter';

const client = new HermesAdapterClient({
  url: 'ws://localhost:3456',
  controller: avatarController,
});
client.connect();
```

See [FACE_NODE_RUNTIME_V1.md](../../FACE_NODE_RUNTIME_V1.md) for the canonical runtime transport contract.
