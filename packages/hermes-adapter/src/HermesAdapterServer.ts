/**
 * HermesAdapterServer — Node.js only.
 *
 * Creates a WebSocket server that avatar clients connect to.
 * Optionally connects upstream to a real Hermes WebSocket endpoint,
 * normalizes Hermes-format payloads into Runtime Contract v1 envelopes,
 * and re-broadcasts them alongside runtime diagnostics snapshots.
 *
 * If hermesWsUrl is omitted the server is broadcast-only; events can be
 * injected programmatically via explicit runtime envelopes.
 */
import { WebSocketServer, WebSocket } from 'ws';
import {
  createRuntimeDiagnostics,
  createRuntimeEventEnvelope,
} from '@facenode/avatar-core';
import type {
  RuntimeConnectionState,
  RuntimeDiagnostics,
  RuntimeDropReason,
  RuntimeEventEnvelope,
} from '@facenode/avatar-core';
import { normalizeIncomingPayload } from './hermesProtocol.js';
import type { HermesCorrelationState, HermesNormalizationResult } from './hermesProtocol.js';

export interface HermesAdapterServerOptions {
  /** Port the avatar clients connect to. */
  port: number;
  /** Upstream Hermes WebSocket URL (optional — omit for mock/test usage). */
  hermesWsUrl?: string;
  /** Runtime-assigned source label for envelopes and diagnostics. */
  runtimeSource?: string;
}

const HERMES_MAX_RETRIES = 5;
const HERMES_BASE_DELAY_MS = 1000;

function createInitialDiagnostics(
  source: string,
  connectionState: RuntimeConnectionState,
): RuntimeDiagnostics {
  return createRuntimeDiagnostics({
    source,
    connectionState,
    reconnectAttempts: 0,
    droppedPayloadCount: 0,
  });
}

export function parseIncomingPayload(
  raw: unknown,
  options: {
    runtimeSource?: string;
    correlation?: HermesCorrelationState;
    nextSequence?: () => number;
    now?: () => number;
  } = {},
): RuntimeEventEnvelope | null {
  const sequence = options.nextSequence ?? (() => 1);
  const result = normalizeIncomingPayload(raw, {
    source: options.runtimeSource ?? 'hermes-adapter',
    correlation: options.correlation,
    nextSequence: sequence,
    now: options.now,
  });

  return result.ok ? result.value.envelope : null;
}

export class HermesAdapterServer {
  private wss: WebSocketServer | null = null;
  private hermesWs: WebSocket | null = null;
  private readonly clients = new Set<WebSocket>();
  private runtimeSequence = 0;
  private correlation: HermesCorrelationState = {};
  private diagnostics: RuntimeDiagnostics;

  private hermesRetryCount = 0;
  private hermesRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private hermesIntentionalClose = false;
  private hermesOutageSignaled = false;

  constructor(private readonly options: HermesAdapterServerOptions) {
    this.diagnostics = createInitialDiagnostics(
      this.runtimeSource,
      this.options.hermesWsUrl ? 'connecting' : 'idle',
    );
  }

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ port: this.options.port });

    this.wss.on('connection', (client) => {
      this.clients.add(client);
      this.sendDiagnostics(client);

      client.on('close', () => this.clients.delete(client));
      client.on('error', (err) => {
        console.warn('[HermesAdapterServer] Client error:', err.message);
        this.clients.delete(client);
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.wss!.once('listening', resolve);
      this.wss!.once('error', reject);
    });

    console.log(`[HermesAdapterServer] Listening on ws://localhost:${this.options.port}`);

    if (this.options.hermesWsUrl) {
      this.hermesIntentionalClose = false;
      this.hermesOutageSignaled = false;
      this.hermesRetryCount = 0;
      this.updateDiagnostics({ connectionState: 'connecting', reconnectAttempts: 0 });
      try {
        await this.connectToHermes(this.options.hermesWsUrl);
      } catch (err) {
        await this.stop();
        throw err;
      }
    }
  }

  async stop(): Promise<void> {
    this.hermesIntentionalClose = true;
    this.clearHermesRetryTimer();

    if (this.hermesWs) {
      this.hermesWs.removeAllListeners();
      this.hermesWs.close();
      this.hermesWs = null;
    }

    this.updateDiagnostics({
      connectionState: 'disconnected',
      reconnectAttempts: this.hermesRetryCount,
      utteranceId: undefined,
    });

    await new Promise<void>((resolve, reject) => {
      if (!this.wss) return resolve();
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });

    this.wss = null;
    this.clients.clear();
  }

  /**
   * Broadcast a validated runtime envelope to all connected avatar clients.
   */
  broadcast(envelope: RuntimeEventEnvelope): void {
    this.runtimeSequence = Math.max(this.runtimeSequence, envelope.sequence);
    this.broadcastJson(envelope);
    this.recordAcceptedEnvelope(envelope);
  }

  getRuntimeDiagnostics(): RuntimeDiagnostics {
    return this.diagnostics;
  }

  private get runtimeSource(): string {
    return this.options.runtimeSource ?? 'hermes-adapter';
  }

  private nextRuntimeSequence(): number {
    this.runtimeSequence += 1;
    return this.runtimeSequence;
  }

  private async connectToHermes(url: string): Promise<void> {
    const ws = new WebSocket(url);
    this.hermesWs = ws;
    let connected = false;

    ws.on('message', (data) => {
      try {
        const raw = JSON.parse(data.toString()) as unknown;
        const result = normalizeIncomingPayload(raw, {
          source: this.runtimeSource,
          correlation: this.correlation,
          nextSequence: () => this.nextRuntimeSequence(),
        });

        this.handleNormalizedResult(result);
      } catch (err) {
        this.recordDrop('invalid_json', `Invalid JSON payload: ${(err as Error).message}`);
      }
    });

    ws.on('close', () => {
      if (this.hermesIntentionalClose || !connected) return;
      console.warn('[HermesAdapterServer] Hermes upstream closed — scheduling reconnect.');
      this.hermesWs = null;
      this.signalTransportDisconnect();
      this.updateDiagnostics({
        connectionState: 'reconnecting',
        reconnectAttempts: this.hermesRetryCount,
      });
      this.scheduleHermesReconnect(url);
    });

    ws.on('error', (err) => {
      if (!this.hermesIntentionalClose) {
        console.warn('[HermesAdapterServer] Hermes upstream error:', err.message);
      }
    });

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        connected = true;
        this.hermesOutageSignaled = false;
        this.hermesRetryCount = 0;
        this.updateDiagnostics({
          connectionState: 'connected',
          reconnectAttempts: 0,
        });
        console.log(`[HermesAdapterServer] Connected to Hermes at ${url}`);
        resolve();
      });
      ws.once('error', reject);
    });
  }

  private handleNormalizedResult(result: HermesNormalizationResult): void {
    if (!result.ok) {
      this.recordDrop(result.drop.reason, result.drop.detail);
      return;
    }

    this.correlation = result.value.correlation;
    this.broadcastJson(result.value.envelope);
    this.recordAcceptedEnvelope(result.value.envelope);
  }

  private scheduleHermesReconnect(url: string): void {
    if (this.hermesIntentionalClose) return;
    if (this.hermesRetryTimer !== null) return;

    this.hermesRetryCount += 1;

    if (this.hermesRetryCount > HERMES_MAX_RETRIES) {
      console.error(
        `[HermesAdapterServer] Max retries (${HERMES_MAX_RETRIES}) exhausted — giving up on Hermes connection.`,
      );
      this.clearHermesRetryTimer();
      this.signalTransportDisconnect();
      this.updateDiagnostics({
        connectionState: 'error',
        reconnectAttempts: HERMES_MAX_RETRIES,
      });
      this.broadcast(createRuntimeEventEnvelope(
        {
          type: 'error',
          message: `Lost Hermes connection at ${url}`,
        },
        {
          source: this.runtimeSource,
          sequence: this.nextRuntimeSequence(),
        },
      ));
      return;
    }

    const delay = HERMES_BASE_DELAY_MS * Math.pow(2, this.hermesRetryCount - 1);
    this.updateDiagnostics({
      connectionState: 'reconnecting',
      reconnectAttempts: this.hermesRetryCount,
    });
    console.log(
      `[HermesAdapterServer] Hermes reconnect ${this.hermesRetryCount}/${HERMES_MAX_RETRIES} in ${delay}ms…`,
    );

    this.hermesRetryTimer = setTimeout(() => {
      this.hermesRetryTimer = null;
      if (!this.hermesIntentionalClose) {
        void this.connectToHermes(url).catch((err) => {
          console.warn('[HermesAdapterServer] Reconnect attempt failed:', (err as Error).message);
          this.scheduleHermesReconnect(url);
        });
      }
    }, delay);
  }

  private clearHermesRetryTimer(): void {
    if (this.hermesRetryTimer !== null) {
      clearTimeout(this.hermesRetryTimer);
      this.hermesRetryTimer = null;
    }
  }

  private recordAcceptedEnvelope(envelope: RuntimeEventEnvelope): void {
    this.updateDiagnostics({
      lastAcceptedEvent: envelope,
      sessionId: envelope.sessionId,
      utteranceId: envelope.utteranceId,
    });
  }

  private recordDrop(reason: RuntimeDropReason, detail: string): void {
    console.warn('[HermesAdapterServer] Dropped payload:', reason, detail);
    this.updateDiagnostics({
      droppedPayloadCount: this.diagnostics.droppedPayloadCount + 1,
      lastDropReason: reason,
      lastDropDetail: detail,
    });
  }

  private updateDiagnostics(
    patch: Partial<Omit<RuntimeDiagnostics, 'kind' | 'version' | 'source' | 'updatedAt'>>,
  ): void {
    const hasPatch = <K extends keyof typeof patch>(key: K): boolean =>
      Object.prototype.hasOwnProperty.call(patch, key);

    this.diagnostics = createRuntimeDiagnostics({
      source: this.runtimeSource,
      connectionState: hasPatch('connectionState')
        ? patch.connectionState ?? this.diagnostics.connectionState
        : this.diagnostics.connectionState,
      reconnectAttempts: hasPatch('reconnectAttempts')
        ? patch.reconnectAttempts ?? this.diagnostics.reconnectAttempts
        : this.diagnostics.reconnectAttempts,
      droppedPayloadCount: hasPatch('droppedPayloadCount')
        ? patch.droppedPayloadCount ?? this.diagnostics.droppedPayloadCount
        : this.diagnostics.droppedPayloadCount,
      lastDropReason: hasPatch('lastDropReason')
        ? patch.lastDropReason
        : this.diagnostics.lastDropReason,
      lastDropDetail: hasPatch('lastDropDetail')
        ? patch.lastDropDetail
        : this.diagnostics.lastDropDetail,
      lastAcceptedEvent: hasPatch('lastAcceptedEvent')
        ? patch.lastAcceptedEvent
        : this.diagnostics.lastAcceptedEvent,
      sessionId: hasPatch('sessionId') ? patch.sessionId : this.diagnostics.sessionId,
      utteranceId: hasPatch('utteranceId') ? patch.utteranceId : this.diagnostics.utteranceId,
    });
    this.broadcastDiagnostics();
  }

  private signalTransportDisconnect(): void {
    if (this.hermesOutageSignaled) return;
    this.hermesOutageSignaled = true;

    const envelope = createRuntimeEventEnvelope(
      { type: 'disconnected' },
      {
        source: this.runtimeSource,
        sequence: this.nextRuntimeSequence(),
        sessionId: this.correlation.sessionId,
      },
    );

    this.correlation = {
      sessionId: this.correlation.sessionId,
      utteranceId: undefined,
    };
    this.broadcastJson(envelope);
    this.recordAcceptedEnvelope(envelope);
  }

  private broadcastJson(payload: RuntimeEventEnvelope | RuntimeDiagnostics): void {
    const outgoing = JSON.stringify(payload);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(outgoing);
      }
    }
  }

  private broadcastDiagnostics(): void {
    this.broadcastJson(this.diagnostics);
  }

  private sendDiagnostics(client: WebSocket): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(this.diagnostics));
      return;
    }

    const sendWhenReady = () => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(this.diagnostics));
      }
    };
    client.once('open', sendWhenReady);
  }
}





