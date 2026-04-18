/**
 * HermesAdapterClient — browser only.
 *
 * Connects to a HermesAdapterServer (or MockHermesEmitter) over a local
 * WebSocket, validates incoming payloads as runtime transport messages, and
 * dispatches only the inner AvatarEvent to an
 * AvatarEventDispatcher (typically AvatarController).
 *
 * Auto-reconnect: exponential backoff starting at 1 s, max 5 attempts.
 * After exhausting retries, dispatches `{ type: 'error' }` to the controller.
 */
import {
  createRuntimeDiagnostics,
  extractAvatarEvent,
  isRuntimeEventEnvelope,
  validateRuntimeTransportMessage,
} from '@facenode/avatar-core';
import type { RuntimeDiagnostics, RuntimeDropReason, RuntimeEventEnvelope } from '@facenode/avatar-core';
import type { AvatarEventDispatcher } from '@facenode/avatar-sdk';

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

type StatusListener = (status: WsStatus) => void;
type DiagnosticsListener = (diagnostics: RuntimeDiagnostics) => void;

export interface HermesAdapterClientOptions {
  url: string;
  controller: AvatarEventDispatcher;
  /** Optional callback for WebSocket connection status changes. */
  onStatusChange?: (status: WsStatus) => void;
  /** Optional callback for runtime diagnostics snapshots. */
  onRuntimeDiagnosticsChange?: (diagnostics: RuntimeDiagnostics) => void;
}

export class HermesAdapterClient {
  private ws: WebSocket | null = null;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private outageNotified = false;

  private _status: WsStatus = 'disconnected';
  private readonly statusListeners = new Set<StatusListener>();
  private readonly diagnosticsListeners = new Set<DiagnosticsListener>();
  private readonly lastSequenceBySource = new Map<string, number>();
  private _runtimeDiagnostics: RuntimeDiagnostics = createRuntimeDiagnostics({
    source: 'hermes-adapter-client',
    connectionState: 'disconnected',
    reconnectAttempts: 0,
    droppedPayloadCount: 0,
  });

  private static readonly MAX_RETRIES = 5;
  private static readonly BASE_DELAY_MS = 1000;

  constructor(private readonly options: HermesAdapterClientOptions) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  connect(): void {
    this.teardownConnection();
    this.intentionalClose = false;
    this.outageNotified = false;
    this.retryCount = 0;
    this.lastSequenceBySource.clear();
    this.attemptConnection();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearRetryTimer();
    this.lastSequenceBySource.clear();
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this.setStatus('disconnected');
  }

  get status(): WsStatus {
    return this._status;
  }

  get runtimeDiagnostics(): RuntimeDiagnostics {
    return this._runtimeDiagnostics;
  }

  /** @returns Unsubscribe function. */
  onStatusChange(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  /** @returns Unsubscribe function. */
  onRuntimeDiagnosticsChange(cb: DiagnosticsListener): () => void {
    this.diagnosticsListeners.add(cb);
    return () => this.diagnosticsListeners.delete(cb);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private attemptConnection(): void {
    this.setStatus('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.options.url);
    } catch (err) {
      console.warn('[HermesAdapterClient] Failed to create WebSocket:', err);
      this.scheduleRetry();
      return;
    }

    this.ws = ws;

    ws.onopen = () => {
      this.retryCount = 0;
      this.outageNotified = false;
      this.setStatus('connected');
      console.log(`[HermesAdapterClient] Connected to ${this.options.url}`);
    };

    ws.onmessage = (msg: MessageEvent<unknown>) => {
      try {
        const raw = JSON.parse(msg.data as string) as unknown;
        const message = validateRuntimeTransportMessage(raw);
        if (!message.ok) {
          this.recordLocalDrop(message.reason, message.detail);
          return;
        }

        if ('kind' in message.value) {
          this.setRuntimeDiagnostics(message.value);
          return;
        }

        if (isRuntimeEventEnvelope(message.value)) {
          if (!this.acceptEnvelope(message.value)) {
            return;
          }
        }

        this.options.controller.dispatch(extractAvatarEvent(message.value));
      } catch (err) {
        this.recordLocalDrop('invalid_json', `Invalid JSON payload: ${(err as Error).message}`);
      }
    };

    ws.onclose = () => {
      if (this.intentionalClose) return;
      if (this.ws === ws) {
        this.ws = null;
      }
      console.log('[HermesAdapterClient] Connection closed — scheduling retry.');
      this.dispatchDisconnectedLifecycle();
      this.scheduleRetry();
    };

    ws.onerror = () => {
      // onerror always precedes onclose; let onclose handle retry scheduling.
      // Just log so the dev knows.
      if (!this.intentionalClose) {
        console.warn(`[HermesAdapterClient] WebSocket error on ${this.options.url}`);
      }
    };
  }

  private scheduleRetry(): void {
    if (this.intentionalClose) return;

    this.retryCount += 1;

    if (this.retryCount > HermesAdapterClient.MAX_RETRIES) {
      console.error(
        `[HermesAdapterClient] Max retries (${HermesAdapterClient.MAX_RETRIES}) exhausted.`,
      );
      this.ws = null;
      this.dispatchDisconnectedLifecycle();
      this.setStatus('error');
      this.patchDiagnostics({
        connectionState: 'error',
        reconnectAttempts: HermesAdapterClient.MAX_RETRIES,
      });
      this.options.controller.dispatch({
        type: 'error',
        message: `WebSocket connection to ${this.options.url} failed after ${HermesAdapterClient.MAX_RETRIES} retries.`,
      });
      return;
    }

    const delay = HermesAdapterClient.BASE_DELAY_MS * Math.pow(2, this.retryCount - 1);
    console.log(
      `[HermesAdapterClient] Retry ${this.retryCount}/${HermesAdapterClient.MAX_RETRIES} in ${delay}ms…`,
    );
    this.setStatus('connecting');
    this.patchDiagnostics({
      connectionState: 'reconnecting',
      reconnectAttempts: this.retryCount,
    });
    this.retryTimer = setTimeout(() => this.attemptConnection(), delay);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  private setStatus(status: WsStatus): void {
    if (this._status === status) return;
    this._status = status;
    this.options.onStatusChange?.(status);
    this.statusListeners.forEach((cb) => cb(status));

    const connectionState = status === 'connecting'
      ? this.retryCount > 0 ? 'reconnecting' : 'connecting'
      : status;
    this.patchDiagnostics({ connectionState });
  }

  private dispatchDisconnectedLifecycle(): void {
    if (this.outageNotified) return;
    this.outageNotified = true;
    this.options.controller.dispatch({ type: 'disconnected' });
  }

  private teardownConnection(): void {
    this.intentionalClose = true;
    this.clearRetryTimer();

    if (!this.ws) return;

    const ws = this.ws;
    this.ws = null;
    ws.onopen = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.close();
  }

  private acceptEnvelope(envelope: RuntimeEventEnvelope): boolean {
    const lastSeen = this.lastSequenceBySource.get(envelope.source) ?? -1;
    if (envelope.sequence <= lastSeen) {
      this.recordLocalDrop(
        envelope.sequence === lastSeen ? 'duplicate_runtime_event' : 'out_of_order_runtime_event',
        envelope.sequence === lastSeen
          ? `Received duplicate sequence ${envelope.sequence} from ${envelope.source}.`
          : `Received sequence ${envelope.sequence} after ${lastSeen} from ${envelope.source}.`,
      );
      return false;
    }

    this.lastSequenceBySource.set(envelope.source, envelope.sequence);
    this.patchDiagnostics({
      lastAcceptedEvent: envelope,
      sessionId: envelope.sessionId,
      utteranceId: envelope.utteranceId,
    });
    return true;
  }

  private recordLocalDrop(reason: RuntimeDropReason, detail: string): void {
    console.warn('[HermesAdapterClient] Dropped payload:', reason, detail);
    this.patchDiagnostics({
      droppedPayloadCount: this._runtimeDiagnostics.droppedPayloadCount + 1,
      lastDropReason: reason,
      lastDropDetail: detail,
    });
  }

  private setRuntimeDiagnostics(diagnostics: RuntimeDiagnostics): void {
    this._runtimeDiagnostics = diagnostics;
    if (diagnostics.lastAcceptedEvent) {
      this.lastSequenceBySource.set(
        diagnostics.lastAcceptedEvent.source,
        diagnostics.lastAcceptedEvent.sequence,
      );
    }
    this.options.onRuntimeDiagnosticsChange?.(diagnostics);
    this.diagnosticsListeners.forEach((cb) => cb(diagnostics));
  }

  private patchDiagnostics(
    patch: Partial<Omit<RuntimeDiagnostics, 'kind' | 'version' | 'source' | 'updatedAt'>>,
  ): void {
    const hasPatch = <K extends keyof typeof patch>(key: K): boolean =>
      Object.prototype.hasOwnProperty.call(patch, key);

    this.setRuntimeDiagnostics(createRuntimeDiagnostics({
      source: this._runtimeDiagnostics.source,
      connectionState: hasPatch('connectionState')
        ? patch.connectionState ?? this._runtimeDiagnostics.connectionState
        : this._runtimeDiagnostics.connectionState,
      reconnectAttempts: hasPatch('reconnectAttempts')
        ? patch.reconnectAttempts ?? this._runtimeDiagnostics.reconnectAttempts
        : this._runtimeDiagnostics.reconnectAttempts,
      droppedPayloadCount: hasPatch('droppedPayloadCount')
        ? patch.droppedPayloadCount ?? this._runtimeDiagnostics.droppedPayloadCount
        : this._runtimeDiagnostics.droppedPayloadCount,
      lastDropReason: hasPatch('lastDropReason')
        ? patch.lastDropReason
        : this._runtimeDiagnostics.lastDropReason,
      lastDropDetail: hasPatch('lastDropDetail')
        ? patch.lastDropDetail
        : this._runtimeDiagnostics.lastDropDetail,
      lastAcceptedEvent: hasPatch('lastAcceptedEvent')
        ? patch.lastAcceptedEvent
        : this._runtimeDiagnostics.lastAcceptedEvent,
      sessionId: hasPatch('sessionId') ? patch.sessionId : this._runtimeDiagnostics.sessionId,
      utteranceId: hasPatch('utteranceId') ? patch.utteranceId : this._runtimeDiagnostics.utteranceId,
    }));
  }
}



