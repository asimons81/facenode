import { useEffect, useRef, useState, useCallback } from 'react';
import { CaptionTimeline, type AvatarEvent, type AvatarState, type RuntimeDiagnostics } from '@facenode/avatar-core';
import { HermesAdapterClient } from '@facenode/hermes-adapter';
import type { WsStatus } from '@facenode/hermes-adapter';
import { AvatarController } from './AvatarController.js';

// ── Dev event palette ─────────────────────────────────────────────────────────

const DEV_EVENTS: Array<{ label: string; event: AvatarEvent; group: string }> = [
  { group: 'connection', label: 'connected', event: { type: 'connected' } },
  { group: 'connection', label: 'disconnected', event: { type: 'disconnected' } },
  { group: 'listen', label: 'listening_start', event: { type: 'listening_start' } },
  { group: 'listen', label: 'listening_end', event: { type: 'listening_end' } },
  { group: 'think', label: 'thinking_start', event: { type: 'thinking_start' } },
  { group: 'think', label: 'thinking_end', event: { type: 'thinking_end' } },
  { group: 'speak', label: 'speech_start', event: { type: 'speech_start' } },
  {
    group: 'speak',
    label: 'speech_chunk "Hello!"',
    event: { type: 'speech_chunk', text: 'Hello! I am FaceNode.', amplitude: 0.6 },
  },
  {
    group: 'speak',
    label: 'speech_chunk "Processing…"',
    event: { type: 'speech_chunk', text: 'Processing your request now…', amplitude: 0.4 },
  },
  { group: 'speak', label: 'speech_end', event: { type: 'speech_end' } },
  { group: 'error', label: 'error', event: { type: 'error', message: 'Connection lost.' } },
];

// ── Color maps ────────────────────────────────────────────────────────────────

const STATE_COLORS: Record<AvatarState, string> = {
  idle: '#4FB7A0',
  listening: '#60c8e8',
  thinking: '#e0b84a',
  speaking: '#72e0a8',
  error: '#e05c5c',
  disconnected: '#555555',
};

const WS_STATUS_COLORS: Record<WsStatus, string> = {
  connected: '#4FB7A0',
  connecting: '#e0b84a',
  disconnected: '#555555',
  error: '#e05c5c',
};

// ── Minimal shared styles ─────────────────────────────────────────────────────

const font = "'JetBrains Mono', 'Fira Code', monospace";

const S = {
  root: {
    position: 'relative' as const,
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    background: '#0a0a0a',
  },
  canvas: {
    position: 'absolute' as const,
    inset: 0,
    width: '100%',
    height: '100%',
  },
  badge: (color: string): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontFamily: font,
    fontSize: 11,
    letterSpacing: '0.08em',
    color,
    background: 'rgba(0,0,0,0.65)',
    border: `1px solid ${color}40`,
    borderRadius: 4,
    padding: '3px 9px',
    backdropFilter: 'blur(4px)',
    userSelect: 'none' as const,
    transition: 'color 0.3s, border-color 0.3s',
    whiteSpace: 'nowrap' as const,
  }),
  dot: (color: string): React.CSSProperties => ({
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: color,
    flexShrink: 0,
    transition: 'background 0.3s',
  }),
  bottomBar: {
    position: 'absolute' as const,
    bottom: 20,
    left: 20,
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  caption: (visible: boolean): React.CSSProperties => ({
    position: 'absolute',
    bottom: 56,
    left: '50%',
    transform: 'translateX(-50%)',
    fontFamily: font,
    fontSize: 14,
    color: '#e0e0e0',
    background: 'rgba(0,0,0,0.7)',
    borderRadius: 6,
    padding: '6px 16px',
    maxWidth: '58%',
    textAlign: 'center' as const,
    whiteSpace: 'pre-wrap' as const,
    backdropFilter: 'blur(4px)',
    opacity: visible ? 1 : 0,
    transition: 'opacity 0.5s ease',
    pointerEvents: 'none' as const,
  }),
  devPanel: {
    position: 'absolute' as const,
    top: 14,
    right: 14,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
    fontFamily: font,
    maxHeight: 'calc(100vh - 28px)',
    overflowY: 'auto' as const,
  },
  sectionLabel: {
    fontSize: 9,
    color: '#444',
    letterSpacing: '0.12em',
    textTransform: 'uppercase' as const,
    marginTop: 8,
    marginBottom: 2,
  },
  wsRow: {
    display: 'flex',
    gap: 4,
    alignItems: 'stretch',
  },
  urlInput: {
    background: 'rgba(0,0,0,0.7)',
    border: '1px solid #333',
    borderRadius: 4,
    color: '#aaa',
    fontSize: 11,
    fontFamily: font,
    padding: '4px 8px',
    outline: 'none',
    width: 190,
    backdropFilter: 'blur(4px)',
  },
  btn: (accent: string, active = false): React.CSSProperties => ({
    background: active ? `${accent}22` : 'rgba(0,0,0,0.7)',
    border: `1px solid ${active ? accent : accent + '40'}`,
    borderRadius: 4,
    color: accent,
    fontSize: 11,
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: font,
    letterSpacing: '0.04em',
    backdropFilter: 'blur(4px)',
    whiteSpace: 'nowrap' as const,
    transition: 'background 0.15s, border-color 0.15s',
  }),
} as const;

const GROUP_COLORS: Record<string, string> = {
  connection: '#4FB7A0',
  listen: '#60c8e8',
  think: '#e0b84a',
  speak: '#72e0a8',
  error: '#e05c5c',
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AvatarController | null>(null);
  const adapterRef = useRef<HermesAdapterClient | null>(null);
  const captionTimelineRef = useRef(new CaptionTimeline());

  const [avatarState, setAvatarState] = useState<AvatarState>('disconnected');
  const [caption, setCaption] = useState('');
  const [captionVisible, setCaptionVisible] = useState(false);

  const [wsUrl, setWsUrl] = useState('ws://localhost:3456');
  const [wsStatus, setWsStatus] = useState<WsStatus>('disconnected');
  const [runtimeDiagnostics, setRuntimeDiagnostics] = useState<RuntimeDiagnostics | null>(null);

  // ── Init AvatarController ──────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    const ctrl = new AvatarController(containerRef.current);
    controllerRef.current = ctrl;

    const unsubState = ctrl.onStateChange((next) => setAvatarState(next));

    const unsubEvents = ctrl.onEvent((event) => {
      const next = captionTimelineRef.current.apply(event, Date.now());
      setCaption(next.text);
      setCaptionVisible(next.visible);
    });

    let raf = 0;
    const tickCaption = () => {
      const next = captionTimelineRef.current.tick(Date.now());
      setCaption((prev) => (prev === next.text ? prev : next.text));
      setCaptionVisible(next.visible);
      raf = window.requestAnimationFrame(tickCaption);
    };
    raf = window.requestAnimationFrame(tickCaption);

    return () => {
      unsubState();
      unsubEvents();
      adapterRef.current?.disconnect();
      adapterRef.current = null;
      window.cancelAnimationFrame(raf);
      ctrl.destroy();
      controllerRef.current = null;
    };
  }, []);

  // ── WS connection handlers ─────────────────────────────────────────────────

  const handleConnect = useCallback(() => {
    const ctrl = controllerRef.current;
    if (!ctrl) return;

    // Tear down any existing connection first
    adapterRef.current?.disconnect();

    const adapter = new HermesAdapterClient({
      url: wsUrl,
      controller: ctrl,
      onRuntimeDiagnosticsChange: setRuntimeDiagnostics,
    });
    adapterRef.current = adapter;

    adapter.onStatusChange(setWsStatus);
    adapter.connect();
  }, [wsUrl]);

  const handleDisconnect = useCallback(() => {
    adapterRef.current?.disconnect();
    adapterRef.current = null;
    setWsStatus('disconnected');
  }, []);

  const dispatch = useCallback((event: AvatarEvent) => {
    controllerRef.current?.dispatch(event);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────

  const groups = [...new Set(DEV_EVENTS.map((e) => e.group))];
  const wsColor = WS_STATUS_COLORS[wsStatus];
  const stateColor = STATE_COLORS[avatarState];
  const isConnected = wsStatus === 'connected';

  return (
    <div style={S.root}>
      {/* Three.js canvas container */}
      <div ref={containerRef} style={S.canvas} />

      {/* Bottom status bar */}
      <div style={S.bottomBar}>
        <div style={S.badge(stateColor)}>
          <span style={S.dot(stateColor)} />
          {avatarState}
        </div>
        <div style={S.badge(wsColor)}>
          <span style={S.dot(wsColor)} />
          {'WS: ' + wsStatus}
        </div>
        <div style={S.badge('#9ba3b5')}>
          <span style={S.dot(runtimeDiagnostics?.lastDropReason ? '#e05c5c' : '#9ba3b5')} />
          {`RT: ${runtimeDiagnostics?.connectionState ?? 'unknown'} / drop ${runtimeDiagnostics?.droppedPayloadCount ?? 0}`}
        </div>
      </div>

      {/* Caption */}
      <div style={S.caption(captionVisible)}>{caption}</div>

      <div style={{
        position: 'absolute',
        bottom: 92,
        left: 20,
        fontFamily: font,
        fontSize: 10,
        color: '#9ba3b5',
        background: 'rgba(0,0,0,0.62)',
        border: '1px solid rgba(155,163,181,0.2)',
        borderRadius: 4,
        padding: '6px 10px',
        lineHeight: 1.5,
        whiteSpace: 'pre-line',
        pointerEvents: 'none',
      }}>
        {`last: ${runtimeDiagnostics?.lastAcceptedEvent?.event.type ?? 'none'}\nsession: ${runtimeDiagnostics?.sessionId ?? 'n/a'}\nutterance: ${runtimeDiagnostics?.utteranceId ?? 'n/a'}`}
      </div>

      {/* Dev panel */}
      <div style={S.devPanel}>
        {/* WS connection section */}
        <div style={S.sectionLabel}>websocket</div>
        <div style={S.wsRow}>
          <input
            style={S.urlInput}
            value={wsUrl}
            onChange={(e) => setWsUrl(e.target.value)}
            placeholder="ws://localhost:3456"
            spellCheck={false}
          />
        </div>
        <div style={S.wsRow}>
          <button
            style={S.btn('#4FB7A0', isConnected)}
            onClick={handleConnect}
            disabled={isConnected}
          >
            {wsStatus === 'connecting' ? 'connecting…' : 'connect'}
          </button>
          <button
            style={S.btn('#e05c5c', !isConnected && wsStatus !== 'disconnected')}
            onClick={handleDisconnect}
            disabled={wsStatus === 'disconnected'}
          >
            disconnect
          </button>
        </div>

        {/* Manual event firing */}
        <div style={{ ...S.sectionLabel, marginTop: 12 }}>manual / dev</div>
        {groups.map((group) => (
          <div key={group}>
            <div style={S.sectionLabel}>{group}</div>
            {DEV_EVENTS.filter((e) => e.group === group).map((entry) => {
              const accent = GROUP_COLORS[group] ?? '#4FB7A0';
              return (
                <button
                  key={entry.label}
                  style={S.btn(accent)}
                  onMouseEnter={(ev) => {
                    (ev.currentTarget as HTMLButtonElement).style.background = `${accent}18`;
                  }}
                  onMouseLeave={(ev) => {
                    (ev.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.7)';
                  }}
                  onClick={() => dispatch(entry.event)}
                >
                  {entry.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
