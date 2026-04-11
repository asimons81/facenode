import React, { useRef, useState } from 'react';
import type { AvatarConfig } from '@facenode/avatar-core';
import { C, Section, Slider, Toggle, SegmentedControl, ColorPicker, TextInput } from '../components/Primitives.js';

interface ControlPanelProps {
  config: AvatarConfig;
  onChange: (patch: Partial<AvatarConfig>) => void;
  onReset: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onLoadModel: (model: 'procedural' | 'gltf', url?: string) => Promise<void>;
}

export function ControlPanel({ config, onChange, onReset, onExport, onImport, onLoadModel }: ControlPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const accentColor = config.accentColor;

  return (
    <div style={{
      width: '320px',
      flexShrink: 0,
      overflowY: 'auto',
      background: '#0f0f17',
      borderRight: `1px solid ${C.border}`,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <span style={{ color: accentColor, fontFamily: 'monospace', fontWeight: 700, fontSize: '13px' }}>
          FACENODE
        </span>
        <span style={{ color: C.textDim, fontFamily: 'monospace', fontSize: '11px' }}>
          dashboard
        </span>
      </div>

      {/* Connection */}
      <Section title="Connection">
        <TextInput
          label="WebSocket URL"
          value={config.wsUrl}
          placeholder="ws://localhost:3456"
          onChange={(v) => onChange({ wsUrl: v })}
        />
      </Section>

      {/* Appearance */}
      <Section title="Appearance">
        <ColorPicker label="Skin" value={config.skinColor} onChange={(v) => onChange({ skinColor: v })} />
        <ColorPicker label="Accent" value={config.accentColor} onChange={(v) => onChange({ accentColor: v })} />
        <ColorPicker label="Background" value={config.backgroundColor} onChange={(v) => onChange({ backgroundColor: v })} />
        <SegmentedControl
          label="Environment"
          value={config.environmentPreset}
          accentColor={accentColor}
          options={[
            { value: 'none', label: 'None' },
            { value: 'soft', label: 'Soft' },
            { value: 'studio', label: 'Studio' },
          ]}
          onChange={(v) => onChange({ environmentPreset: v })}
        />
        <SegmentedControl
          label="Model"
          value={config.avatarModel}
          accentColor={accentColor}
          options={[
            { value: 'procedural', label: 'Procedural' },
            { value: 'gltf', label: 'glTF' },
          ]}
          onChange={(v) => onChange({ avatarModel: v })}
        />
        {config.avatarModel === 'gltf' && (
          <div style={{ marginTop: '8px' }}>
            <TextInput
              label="glTF URL"
              value={config.gltfModelUrl ?? ''}
              placeholder="https://example.com/avatar.glb"
              onChange={(v) => onChange({ gltfModelUrl: v })}
            />
            <button
              disabled={modelLoading || !config.gltfModelUrl}
              onClick={async () => {
                setModelLoading(true);
                await onLoadModel('gltf', config.gltfModelUrl);
                setModelLoading(false);
              }}
              style={{
                ...btnStyle(accentColor),
                marginTop: '6px',
                opacity: modelLoading || !config.gltfModelUrl ? 0.5 : 1,
                cursor: modelLoading || !config.gltfModelUrl ? 'not-allowed' : 'pointer',
              }}
            >
              {modelLoading ? 'Loading…' : 'Load glTF Model'}
            </button>
          </div>
        )}
        {config.avatarModel === 'procedural' && (
          <div style={{ marginTop: '6px' }}>
            <button
              onClick={() => void onLoadModel('procedural')}
              style={btnStyle(C.textDim)}
            >
              Reset to procedural
            </button>
          </div>
        )}
      </Section>

      {/* Camera */}
      <Section title="Camera">
        <SegmentedControl
          label="Preset"
          value={config.cameraPreset}
          accentColor={accentColor}
          options={[
            { value: 'head', label: 'Head' },
            { value: 'bust', label: 'Bust' },
            { value: 'wide', label: 'Wide' },
          ]}
          onChange={(v) => onChange({ cameraPreset: v })}
        />
      </Section>

      {/* Subtitles */}
      <Section title="Subtitles">
        <Toggle label="Enabled" value={config.subtitlesEnabled} accentColor={accentColor} onChange={(v) => onChange({ subtitlesEnabled: v })} />
        <SegmentedControl
          label="Size"
          value={config.subtitleSize}
          accentColor={accentColor}
          options={[
            { value: 'sm', label: 'Sm' },
            { value: 'md', label: 'Md' },
            { value: 'lg', label: 'Lg' },
          ]}
          onChange={(v) => onChange({ subtitleSize: v })}
        />
      </Section>

      {/* Animation */}
      <Section title="Animation">
        <Slider
          label="Idle intensity"
          value={config.idleIntensity}
          accentColor={accentColor}
          onChange={(v) => onChange({ idleIntensity: v })}
        />
        <SegmentedControl
          label="Blink freq"
          value={config.blinkFrequency}
          accentColor={accentColor}
          options={[
            { value: 'slow', label: 'Slow' },
            { value: 'normal', label: 'Normal' },
            { value: 'fast', label: 'Fast' },
          ]}
          onChange={(v) => onChange({ blinkFrequency: v })}
        />
        <Slider
          label="Speaking sens"
          value={config.speakingSensitivity}
          accentColor={accentColor}
          onChange={(v) => onChange({ speakingSensitivity: v })}
        />
      </Section>

      {/* HUD */}
      <Section title="HUD">
        <Toggle label="State label" value={config.showStateLabel} accentColor={accentColor} onChange={(v) => onChange({ showStateLabel: v })} />
        <Toggle label="Connection status" value={config.showConnectionStatus} accentColor={accentColor} onChange={(v) => onChange({ showConnectionStatus: v })} />
      </Section>

      {/* Presets */}
      <Section title="Presets" defaultOpen={false}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
          <button
            onClick={onExport}
            style={btnStyle(accentColor)}
          >
            Export JSON
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={btnStyle(C.textDim)}
          >
            Import JSON
          </button>
          <button
            onClick={onReset}
            style={btnStyle(C.danger)}
          >
            Reset to defaults
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImport(file);
            e.target.value = '';
          }}
        />
      </Section>

      {/* Bottom spacer */}
      <div style={{ flex: 1 }} />
    </div>
  );
}

function btnStyle(color: string): React.CSSProperties {
  return {
    width: '100%',
    padding: '6px',
    background: 'none',
    border: `1px solid ${color}`,
    borderRadius: '4px',
    color: color,
    fontFamily: 'monospace',
    fontSize: '11px',
    cursor: 'pointer',
    letterSpacing: '0.05em',
  };
}
