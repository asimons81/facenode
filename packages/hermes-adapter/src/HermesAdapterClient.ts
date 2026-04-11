/**
 * HermesAdapterClient — browser only.
 *
 * Connects to a HermesAdapterServer (or MockHermesEmitter) over a local
 * WebSocket, validates incoming payloads with AvatarEventSchema, and
 * dispatches them to an AvatarEventDispatcher (typically AvatarController).
 *
 * Auto-reconnect: exponential backoff starting at 1 s, max 5 attempts.
 * After exhausting retries, dispatches `{ type: 'error' }` to the controller.
 */
import { AvatarEventSchema } from '@facenode/avatar-core';
import type { AvatarEventDispatcher } from '@facenode/avatar-sdk';

export type WsStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

type StatusListener = (status: WsStatus) => void;

export interface HermesAdapterClientOptions {
  url: string;
  controller: AvatarEventDispatcher;
  /** Optional callback for WebSocket connection status changes. */
  onStatusChange?: (status: WsStatus) => void;
}

export class HermesAdapterClient {
  private ws: WebSocket | null = null;
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private outageNotified = false;

  private _status: WsStatus = 'disconnected';
  private readonly statusListeners = new Set<StatusListener>();

  private static readonly MAX_RETRIES = 5;
  private static readonly BASE_DELAY_MS = 1000;

  constructor(private readonly options: HermesAdapterClientOptions) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  connect(): void {
    this.teardownConnection();
    this.intentionalClose = false;
    this.outageNotified = false;
    this.retryCount = 0;
    this.attemptConnection();
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.clearRetryTimer();
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

  /** @returns Unsubscribe function. */
  onStatusChange(cb: StatusListener): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
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
        const result = AvatarEventSchema.safeParse(raw);
        if (result.success) {
          this.options.controller.dispatch(result.data);
        } else {
          const issue = result.error.issues[0];
          console.warn(
            '[HermesAdapterClient] Dropped invalid event:',
            issue?.message ?? result.error.message,
          );
        }
      } catch (err) {
        console.warn('[HermesAdapterClient] Failed to parse message:', err);
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
}
