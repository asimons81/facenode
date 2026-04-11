# @facenode/hermes-adapter

WebSocket bridge between Hermes AI agent events and FaceNode avatar events.

## What it does

- **`HermesAdapterServer`** (Node.js) — WebSocket server that avatar clients connect to. When `hermesWsUrl` is provided, connects upstream to Hermes, translates payloads, and rebroadcasts them. Exponential backoff reconnection (max 5 retries).
- **`HermesAdapterClient`** (browser) — Connects to the server, validates events with Zod, dispatches to `AvatarController`. Auto-reconnects with exponential backoff.
- **`MockHermesEmitter`** (Node.js) — Scripted WebSocket server for dev/demo. Loops through a full idle → listening → thinking → speaking sequence with viseme frames.

## Hermes payload mapping

When `hermesWsUrl` is set, `HermesAdapterServer` expects these Hermes-native JSON shapes:

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

Unrecognised event names are dropped. As a fallback, payloads that already match `AvatarEventSchema` directly are forwarded as-is (useful for the mock in non-hermes mode).

## Install

```bash
# Client only (browser-safe)
pnpm add @facenode/hermes-adapter

# Server + mock (Node.js)
pnpm add @facenode/hermes-adapter
import { HermesAdapterServer, MockHermesEmitter } from '@facenode/hermes-adapter/server';
```

## Usage

### Running the mock

```bash
pnpm mock                  # AvatarEvent mode (connect clients directly)
pnpm mock --hermes-mode    # Hermes payload mode (pair with HermesAdapterServer)
PORT=9000 pnpm mock        # custom port
```

### HermesAdapterServer

```ts
import { HermesAdapterServer } from '@facenode/hermes-adapter/server';

const server = new HermesAdapterServer({
  port: 3456,
  hermesWsUrl: 'ws://hermes.local:8080',  // optional
});
await server.start();
// Avatar clients connect to ws://localhost:3456
```

### HermesAdapterClient

```ts
import { HermesAdapterClient } from '@facenode/hermes-adapter';

const client = new HermesAdapterClient({
  url: 'ws://localhost:3456',
  controller: avatarController,   // implements AvatarEventDispatcher
});
client.connect();

client.onStatusChange((status) => {
  console.log('WS status:', status); // 'connecting' | 'connected' | 'disconnected' | 'error'
});
```

See [ARCHITECTURE.md](../../ARCHITECTURE.md) for the full event flow.
