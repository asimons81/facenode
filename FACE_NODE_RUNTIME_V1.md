# FaceNode Runtime Contract v1

FaceNode's runtime transport is envelope-only. Hermes is an adapter-edge concern: `HermesAdapterServer` normalizes Hermes-native payloads into runtime envelopes, and browser clients only consume `RuntimeEventEnvelope` or `RuntimeDiagnostics` messages.

## Transport messages

The WebSocket transport carries exactly two JSON message shapes:

1. `RuntimeEventEnvelope`
2. `RuntimeDiagnostics`

Bare `AvatarEvent` payloads are rejected on the transport boundary.

### RuntimeEventEnvelope

```ts
{
  version: 1;
  source: string;
  sequence: number;
  timestamp: number;
  sessionId?: string;
  utteranceId?: string;
  event: AvatarEvent;
}
```

Rules:

- `version`, `source`, `sequence`, and `timestamp` are runtime-assigned metadata.
- `sessionId` and `utteranceId` are optional correlation fields carried forward by the Hermes adapter when upstream payloads omit them.
- Runtime envelopes are validated before they reach the avatar controller.
- Client ordering is enforced per `source`.
- A repeated sequence from the same source is dropped as `duplicate_runtime_event`.
- A lower sequence from the same source is dropped as `out_of_order_runtime_event`.

### RuntimeDiagnostics

```ts
{
  kind: 'runtime_diagnostics';
  version: 1;
  source: string;
  updatedAt: number;
  connectionState: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
  reconnectAttempts: number;
  droppedPayloadCount: number;
  lastDropReason?: RuntimeDropReason;
  lastDropDetail?: string;
  lastAcceptedEvent?: RuntimeEventEnvelope;
  sessionId?: string;
  utteranceId?: string;
}
```

Meaning:

- `connectionState` describes adapter transport health, not avatar animation state.
- `reconnectAttempts` is the current retry count for the active outage or `0` when healthy.
- `lastAcceptedEvent` is the last envelope accepted by that runtime boundary.
- `sessionId` and `utteranceId` mirror the currently active correlation the runtime believes it is in.
- Diagnostics are allowed to clear optional fields. A later disconnect can intentionally remove `utteranceId` instead of leaving stale state behind.

## Supported Hermes event surface

`HermesAdapterServer` currently normalizes the following Hermes-native payloads:

| Hermes payload | Runtime event |
| --- | --- |
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

Any other Hermes event name is dropped as `unknown_hermes_event`.

## Normalization and correlation rules

Normalization path:

1. Parse raw WebSocket text as JSON.
2. Detect Hermes-native payloads versus runtime envelopes.
3. Validate Hermes payload shape and map it to `AvatarEvent`.
4. Stamp the runtime envelope metadata.
5. Broadcast the envelope plus updated diagnostics.

Correlation behavior:

- `sessionId` and `utteranceId` carry forward across Hermes payloads when Hermes omits them.
- `speech_end` keeps the completed utterance on the accepted envelope, then clears `utteranceId` for future correlation.
- Explicit Hermes `disconnect` keeps the current `sessionId` on the disconnect envelope, clears `utteranceId` on that envelope, and clears both values for future correlation.
- Adapter-synthesized transport disconnects keep the current `sessionId`, clear `utteranceId`, and reset the runtime before reconnect.
- `error` clears the active `utteranceId` for future correlation.

## Drop reasons

Stable v1 drop reasons are:

- `invalid_json`: raw WebSocket text was not valid JSON.
- `invalid_runtime_payload`: payload was JSON, but it was not a valid runtime envelope or diagnostics message.
- `invalid_hermes_payload`: payload looked like Hermes but failed Hermes mapping or event validation.
- `unknown_hermes_event`: Hermes `event` name is not supported.
- `duplicate_runtime_event`: runtime envelope repeated a previously accepted sequence for the same source.
- `out_of_order_runtime_event`: runtime envelope arrived with a lower sequence than the last accepted envelope from the same source.

## Reconnect semantics

### Server-side upstream Hermes reconnect

`HermesAdapterServer` treats upstream Hermes availability as a transport lifecycle:

- Initial connect starts in `connecting`.
- A healthy upstream connection reports `connected`.
- If Hermes drops after a successful connection, the server immediately emits a synthetic `disconnected` runtime envelope so downstream clients leave active speech/listening/thinking state deterministically.
- After that reset, the server enters `reconnecting` and retries with exponential backoff: 1s, 2s, 4s, 8s, 16s.
- Retry budget is capped at 5 attempts.
- When retries are exhausted, diagnostics move to `error` and the outage remains visible instead of silently stalling.
- When Hermes reconnects, diagnostics return to `connected` and normal event flow resumes.

### Browser client reconnect

`HermesAdapterClient` treats the local adapter socket separately from upstream Hermes:

- Unexpected socket close dispatches a single `disconnected` avatar event locally.
- The browser client retries the local socket with exponential backoff up to 5 attempts.
- Retry exhaustion moves client diagnostics to `error` and dispatches an `error` avatar event.
- Runtime envelope ordering is enforced per source before dispatch.

## Debugging expectations

For a real Hermes-backed session, the minimum reliable debugging view is:

- adapter `connectionState`
- `reconnectAttempts`
- `lastAcceptedEvent`
- `droppedPayloadCount`
- `lastDropReason` and `lastDropDetail`
- `sessionId`
- `utteranceId`

Those values are the contract the dashboard debug panel is expected to surface.
