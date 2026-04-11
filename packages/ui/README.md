# @facenode/ui

Shared design tokens for FaceNode apps.

## What it does

Exports the `C` token object with the dark/teal operator color palette used across the dashboard and any custom UI built on FaceNode.

## Install

```bash
pnpm add @facenode/ui
```

## Usage

```ts
import { C } from '@facenode/ui';

// CSS-in-JS / inline styles
const style = {
  background: C.bg,
  color: C.text,
  fontFamily: 'monospace',
  padding: '12px',
};
```

## Tokens

| Key | Value | Purpose |
|-----|-------|---------|
| `accent` | `#4FB7A0` | Primary interactive color |
| `bg` | `#0d0d12` | Page background |
| `panel` | `#13131a` | Panel backgrounds |
| `border` | `#2a2a38` | Dividers and outlines |
| `text` | `#d0d0e0` | Body text |
| `textDim` | `#6b6b88` | Labels and hints |
| `danger` | `#e05c5c` | Error states |
