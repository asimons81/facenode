import React from 'react';
import type { AvatarState } from '@facenode/avatar-core';
import type { WsStatus } from '@facenode/hermes-adapter';
import { C } from '../components/Primitives.js';

export interface LogEntry {
  id: number;
  ts: string;
  type: string;
  payload: string;
}

interface DebugPanelProps {
  wsStatus: WsStatus;
  avatarState: AvatarState;
  log: LogEntry[];
}

const STATE_COLORS: Record<AvatarState, string> = {
  disconnected: C.textDim,
  idle:         C.accent,
  listening:    '#7ec8e3',
  thinking:     '#c8a77e',
  speaking:     '#a0c87e',
  error:        C.danger,
};

const WS_COLORS: Record<WsStatus, string> = {
  connecting:  '#c8a77e',
  connected:   C.accent,
  disconnected: C.textDim,
  error:       C.danger,
};

export function DebugPanel({ wsStatus, avatarState, log }: DebugPanelProps) {
  return (
    <div style={{
      width: '280px',
      flexShrink: 0,
      background: '#0f0f17',
      borderLeft: `1px solid ${C.border}`,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'monospace',
      fontSize: '11px',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px',
        borderBottom: `1px solid ${C.border}`,
        color: C.text,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontSize: '11px',
      }}>
        Debug
      </div>

      {/* WS status */}
      <div style={{
        padding: '10px 12px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: C.textDim }}>WS Status</span>
          <span style={{
            color: WS_COLORS[wsStatus],
            fontWeight: 600,
            textTransform: 'uppercase',
            fontSize: '10px',
          }}>
            ● {wsStatus}
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: C.textDim }}>Avatar State</span>
          <span style={{
            color: STATE_COLORS[avatarState],
            fontWeight: 600,
            textTransform: 'uppercase',
            fontSize: '10px',
          }}>
            {avatarState}
          </span>
        </div>
      </div>

      {/* Event log */}
      <div style={{
        padding: '8px 12px 4px',
        color: C.textDim,
        fontSize: '10px',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        borderBottom: `1px solid ${C.border}`,
      }}>
        Event Log
      </div>

      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        padding: '4px 0',
      }}>
        {log.length === 0 ? (
          <div style={{ padding: '8px 12px', color: C.textDim, fontStyle: 'italic' }}>
            No events yet
          </div>
        ) : (
          log.map((entry) => (
            <div
              key={entry.id}
              style={{
                padding: '3px 12px',
                borderBottom: `1px solid ${C.border}20`,
                display: 'grid',
                gridTemplateColumns: '60px 1fr',
                gap: '6px',
                alignItems: 'start',
              }}
            >
              <span style={{ color: C.textDim, fontSize: '10px' }}>{entry.ts}</span>
              <div>
                <span style={{ color: C.accent, fontWeight: 600 }}>{entry.type}</span>
                {entry.payload && (
                  <span style={{ color: C.textDim, marginLeft: '4px', wordBreak: 'break-all' }}>
                    {entry.payload}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
