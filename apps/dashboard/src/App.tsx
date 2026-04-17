import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AvatarController } from '@facenode/web-avatar';
import { HermesAdapterClient } from '@facenode/hermes-adapter';
import type { WsStatus } from '@facenode/hermes-adapter';
import type { AvatarState, AvatarEvent, RuntimeDiagnostics } from '@facenode/avatar-core';
import { useConfig } from './hooks/useConfig.js';
import { ControlPanel } from './panels/ControlPanel.js';
import { DebugPanel } from './panels/DebugPanel.js';
import type { LogEntry } from './panels/DebugPanel.js';
import { C } from './components/Primitives.js';
import { applyAvatarModelConfig } from './modelSync.js';

const MAX_LOG = 100;
let logIdCounter = 0;

function formatPayload(event: AvatarEvent): string {
  if (event.type === 'speech_chunk') {
    const parts: string[] = [];
    if (event.text) parts.push(`"${event.text}"`);
    if (event.amplitude !== undefined) parts.push(`amp=${event.amplitude.toFixed(2)}`);
    return parts.join(' ');
  }
  if (event.type === 'error') return event.message;
  return '';
}

function formatTime(d: Date): string {
  return d.toTimeString().slice(0, 8);
}

export function App() {
  const { config, modelRevision, setConfig, resetConfig, exportConfig, importConfig } = useConfig();

  const avatarContainerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AvatarController | null>(null);
  const adapterRef = useRef<HermesAdapterClient | null>(null);

  const [avatarState, setAvatarState] = useState<AvatarState>('disconnected');
  const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected');
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostics | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);

  const pushLog = useCallback((event: AvatarEvent) => {
    const entry: LogEntry = {
      id: ++logIdCounter,
      ts: formatTime(new Date()),
      type: event.type,
      payload: formatPayload(event),
    };
    setLog((prev) => [entry, ...prev].slice(0, MAX_LOG));
  }, []);

  // ── Controller init ──────────────────────────────────────────────────────

  useEffect(() => {
    const container = avatarContainerRef.current;
    if (!container) return;

    const ctrl = new AvatarController(container);
    controllerRef.current = ctrl;

    // Apply initial config
    ctrl.setSkinColor(config.skinColor);
    ctrl.setBackgroundColor(config.backgroundColor);
    ctrl.setIdleIntensity(config.idleIntensity);
    ctrl.setBlinkFrequency(config.blinkFrequency);
    ctrl.setSpeakingSensitivity(config.speakingSensitivity);
    ctrl.setCameraPreset(config.cameraPreset);
    ctrl.setEnvironmentPreset(config.environmentPreset);

    ctrl.onStateChange((next) => setAvatarState(next));
    ctrl.onEvent(pushLog);

    return () => {
      ctrl.destroy();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally only on mount

  // ── Adapter connect/disconnect based on wsUrl ────────────────────────────

  useEffect(() => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;

    // Disconnect existing adapter
    adapterRef.current?.disconnect();

    const adapter = new HermesAdapterClient({
      url: config.wsUrl,
      controller: ctrl,
      onStatusChange: (status) => setWsStatus(status),
      onRuntimeDiagnosticsChange: (diagnostics) => setRuntimeDiagnostics(diagnostics),
    });
    adapterRef.current = adapter;
    adapter.connect();

    return () => {
      adapter.disconnect();
      adapterRef.current = null;
    };
  }, [config.wsUrl]);

  // ── Config → controller sync ─────────────────────────────────────────────

  useEffect(() => {
    controllerRef.current?.setSkinColor(config.skinColor);
  }, [config.skinColor]);

  useEffect(() => {
    controllerRef.current?.setBackgroundColor(config.backgroundColor);
  }, [config.backgroundColor]);

  useEffect(() => {
    controllerRef.current?.setIdleIntensity(config.idleIntensity);
  }, [config.idleIntensity]);

  useEffect(() => {
    controllerRef.current?.setBlinkFrequency(config.blinkFrequency);
  }, [config.blinkFrequency]);

  useEffect(() => {
    controllerRef.current?.setSpeakingSensitivity(config.speakingSensitivity);
  }, [config.speakingSensitivity]);

  useEffect(() => {
    controllerRef.current?.setCameraPreset(config.cameraPreset);
  }, [config.cameraPreset]);

  useEffect(() => {
    controllerRef.current?.setEnvironmentPreset(config.environmentPreset);
  }, [config.environmentPreset]);

  // ── Avatar model loader ───────────────────────────────────────────────────

  useEffect(() => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;
    void applyAvatarModelConfig(ctrl, config);
  }, [modelRevision, config.avatarModel, config.gltfModelUrl]);

  const handleLoadModel = useCallback(async (model: 'procedural' | 'gltf', url?: string) => {
    await controllerRef.current?.setAvatarModel(model, url);
  }, []);

  // ── Caption size mapping ─────────────────────────────────────────────────

  const captionFontSize = config.subtitleSize === 'sm' ? '14px'
    : config.subtitleSize === 'lg' ? '22px'
    : '17px';

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      width: '100vw',
      background: C.bg,
      overflow: 'hidden',
    }}>
      {/* Left: Controls */}
      <ControlPanel
        config={config}
        onChange={setConfig}
        onReset={resetConfig}
        onExport={exportConfig}
        onImport={importConfig}
        onLoadModel={handleLoadModel}
      />

      {/* Center: Avatar preview */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Three.js canvas container */}
        <div
          ref={avatarContainerRef}
          style={{ flex: 1, position: 'relative' }}
        />

        {/* State label HUD */}
        {config.showStateLabel && (
          <div style={{
            position: 'absolute',
            bottom: '8px',
            left: '8px',
            fontFamily: 'monospace',
            fontSize: '10px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: C.textDim,
            pointerEvents: 'none',
          }}>
            {avatarState}
          </div>
        )}

        {/* Connection status HUD */}
        {config.showConnectionStatus && (
          <div style={{
            position: 'absolute',
            bottom: '8px',
            right: '8px',
            fontFamily: 'monospace',
            fontSize: '10px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: wsStatus === 'connected' ? C.accent
              : wsStatus === 'error' ? C.danger
              : C.textDim,
            pointerEvents: 'none',
          }}>
            ● {wsStatus}
          </div>
        )}

        {/* Subtitles */}
        {config.subtitlesEnabled && (
          <div style={{
            position: 'absolute',
            bottom: '40px',
            left: '50%',
            transform: 'translateX(-50%)',
            maxWidth: '80%',
            textAlign: 'center',
            fontSize: captionFontSize,
            fontFamily: 'monospace',
            color: '#e8e8f0',
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            pointerEvents: 'none',
          }}>
            <CaptionDisplay controller={controllerRef} />
          </div>
        )}
      </div>

      {/* Right: Debug */}
      <DebugPanel
        wsStatus={wsStatus}
        avatarState={avatarState}
        runtimeDiagnostics={runtimeDiagnostics}
        log={log}
      />
    </div>
  );
}

// ── Caption subcomponent ─────────────────────────────────────────────────────

interface CaptionDisplayProps {
  controller: React.RefObject<AvatarController | null>;
}

function CaptionDisplay({ controller }: CaptionDisplayProps) {
  const [caption, setCaption] = useState('');

  useEffect(() => {
    const ctrl = controller.current;
    if (!ctrl) return;

    const unsub = ctrl.onEvent((event) => {
      if (event.type === 'speech_chunk' && event.text) {
        setCaption(event.text);
      } else if (event.type === 'speech_end') {
        setCaption('');
      }
    });

    return unsub;
  }, [controller]);

  return <>{caption}</>;
}
