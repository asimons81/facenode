# FaceNode — Mock Demo

Step-by-step guide to running the full stack locally without a live Hermes instance.

## Prerequisites

- Node.js ≥ 20, pnpm ≥ 9
- `pnpm install` run from the repo root

## Steps

### 1. Start the mock emitter

```bash
pnpm mock
# [MockHermesEmitter] Ready — ws://localhost:3456 (avatar-event mode)
```

The mock loops through: idle → listening → thinking → speaking (with viseme frames) → repeat.

### 2. Start the avatar renderer

```bash
pnpm --filter @facenode/web-avatar dev
```

Open http://localhost:5173. Connect to `ws://localhost:3456` using the dev panel in the top-right corner. You should see the avatar cycle through states.

### 3. Start the dashboard

```bash
pnpm --filter @facenode/dashboard dev
```

Open http://localhost:5174. The dashboard connects automatically to `ws://localhost:3456` (the default WS URL). Try changing skin color, camera preset, idle intensity — all apply live.

### 4. Test the full Hermes translation path

This exercises `HermesAdapterServer` mapping Hermes-format payloads to AvatarEvents:

```bash
# Terminal 1: mock in Hermes payload mode
pnpm mock --hermes-mode
# [MockHermesEmitter] Ready — ws://localhost:3456 (hermes-mode)

# Terminal 2: bridge (translates Hermes → AvatarEvent, serves on :3457)
node --input-type=module <<'EOF'
import { HermesAdapterServer } from './packages/hermes-adapter/src/server.js';
const s = new HermesAdapterServer({
  port: 3457,
  hermesWsUrl: 'ws://localhost:3456',
});
await s.start();
console.log('[bridge] ws://localhost:3457 → Hermes at ws://localhost:3456');
EOF
```

Then change the WS URL in the dashboard to `ws://localhost:3457`.

## Config preset

See [`config.example.json`](./config.example.json) — import it via the Presets → Import JSON button.

## Custom emitter

See [`custom-emitter.ts`](./custom-emitter.ts) for a minimal programmatic example
using `MockHermesEmitter` with a custom event sequence.
