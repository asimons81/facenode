# @facenode/dashboard

Live configuration dashboard — three-column layout with avatar preview, all config controls, and event log.

## What it does

- **Left panel (320 px)** — collapsible sections: Connection, Appearance (skin/bg/env/model), Camera, Subtitles, Animation, HUD, Presets (export/import/reset)
- **Center** — live `AvatarController` preview with state label and WS status HUDs, subtitle overlay
- **Right panel (280 px)** — WS status, current avatar state, timestamped event log (max 100 entries)
- **localStorage persistence** — config saved under `facenode:config`, reloaded on next visit
- **glTF model loader** — URL input + load button; shows loading state; falls back gracefully

## Dev server

```bash
pnpm --filter @facenode/dashboard dev
# → http://localhost:5174
```

Requires the mock (or a real Hermes server) to be running:

```bash
pnpm mock   # ws://localhost:3456 (default)
```

## Environment

```bash
# apps/dashboard/.env.example
VITE_DEFAULT_WS_URL=ws://localhost:3456
```
