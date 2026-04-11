/**
 * HermesAdapterServer — Node.js only.
 *
 * Creates a WebSocket server that avatar clients connect to.
 * Optionally connects upstream to a real Hermes WebSocket endpoint,
 * translates Hermes-format payloads → AvatarEvents, and re-broadcasts them.
 *
 * If hermesWsUrl is omitted the server is broadcast-only; events can be
 * injected programmatically via broadcast().
 *
 * ── Hermes payload mapping ────────────────────────────────────────────────────
 *
 * When hermesWsUrl is set, the server reads Hermes-native JSON objects and
 * maps them to AvatarEvents before broadcasting to avatar clients.
 *
 * Expected Hermes event shapes:
 *   { "event": "ready" }                               → connected
 *   { "event": "disconnect" }                          → disconnected
 *   { "event": "user.speech.start" }                   → listening_start
 *   { "event": "user.speech.end" }                     → listening_end
 *   { "event": "llm.start" }                           → thinking_start
 *   { "event": "llm.end" }                             → thinking_end
 *   { "event": "tts.start", "audio_url": "..." }       → speech_start
 *   { "event": "tts.chunk", "text": "...",
 *             "amplitude": 0.6 }                       → speech_chunk
 *   { "event": "tts.end" }                             → speech_end
 *   { "event": "tts.viseme", "timestamp": 1234,
 *     "visemes": [{ "viseme": "aa", "weight": 0.8 }] } → viseme_frame
 *   { "event": "error", "message": "..." }             → error
 *
 * Unrecognised events are silently dropped.
 *
 * As a fallback, if the payload already matches AvatarEventSchema directly
 * (e.g. from MockHermesEmitter in non-hermesMode), it is forwarded as-is.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { AvatarEventSchema } from '@facenode/avatar-core';
import type { AvatarEvent, Viseme } from '@facenode/avatar-core';

export interface HermesAdapterServerOptions {
  /** Port the avatar clients connect to. */
  port: number;
  /** Upstream Hermes WebSocket URL (optional — omit for mock/test usage). */
  hermesWsUrl?: string;
}

// ── Hermes payload translator ─────────────────────────────────────────────────

type RawObject = Record<string, unknown>;

function mapHermesPayload(raw: RawObject): AvatarEvent | null {
  const ev = raw['event'];
  if (typeof ev !== 'string') return null;

  switch (ev) {
    case 'ready':
      return { type: 'connected' };

    case 'disconnect':
      return { type: 'disconnected' };

    case 'user.speech.start':
      return { type: 'listening_start' };

    case 'user.speech.end':
      return { type: 'listening_end' };

    case 'llm.start':
      return { type: 'thinking_start' };

    case 'llm.end':
      return { type: 'thinking_end' };

    case 'tts.start':
      return {
        type: 'speech_start',
        audioUrl: typeof raw['audio_url'] === 'string' ? raw['audio_url'] : undefined,
      };

    case 'tts.chunk':
      return {
        type: 'speech_chunk',
        text: typeof raw['text'] === 'string' ? raw['text'] : undefined,
        amplitude:
          typeof raw['amplitude'] === 'number' ? raw['amplitude'] : undefined,
      };

    case 'tts.end':
      return { type: 'speech_end' };

    case 'tts.viseme': {
      const rawVisemes = raw['visemes'];
      const visemes: Array<{ viseme: Viseme; weight: number }> = [];
      if (Array.isArray(rawVisemes)) {
        for (const v of rawVisemes) {
          if (
            v !== null &&
            typeof v === 'object' &&
            typeof (v as RawObject)['viseme'] === 'string' &&
            typeof (v as RawObject)['weight'] === 'number'
          ) {
            visemes.push({
              viseme: (v as RawObject)['viseme'] as Viseme,
              weight: (v as RawObject)['weight'] as number,
            });
          }
        }
      }
      return {
        type: 'viseme_frame',
        timestamp: typeof raw['timestamp'] === 'number' ? raw['timestamp'] : Date.now(),
        visemes,
      };
    }

    case 'error':
      return {
        type: 'error',
        message: typeof raw['message'] === 'string' ? raw['message'] : 'Unknown Hermes error',
      };

    default:
      return null;
  }
}

function validateAvatarEvent(raw: unknown): AvatarEvent | null {
  const result = AvatarEventSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** Try Hermes mapping first; if it yields nothing, fall back to AvatarEventSchema. */
export function parseIncomingPayload(raw: unknown): AvatarEvent | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const mapped = mapHermesPayload(raw as RawObject);
  if (mapped) return validateAvatarEvent(mapped);

  // Fallback: treat payload as a raw AvatarEvent (e.g. mock without hermesMode)
  return validateAvatarEvent(raw);
}

// ── Reconnect constants ───────────────────────────────────────────────────────

const HERMES_MAX_RETRIES = 5;
const HERMES_BASE_DELAY_MS = 1000;

// ── Server class ──────────────────────────────────────────────────────────────

export class HermesAdapterServer {
  private wss: WebSocketServer | null = null;
  private hermesWs: WebSocket | null = null;
  private readonly clients = new Set<WebSocket>();

  // Hermes reconnect state
  private hermesRetryCount = 0;
  private hermesRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private hermesIntentionalClose = false;

  constructor(private readonly options: HermesAdapterServerOptions) {}

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ port: this.options.port });

    this.wss.on('connection', (client) => {
      this.clients.add(client);
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
      this.hermesRetryCount = 0;
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

    await new Promise<void>((resolve, reject) => {
      if (!this.wss) return resolve();
      this.wss.close((err) => (err ? reject(err) : resolve()));
    });

    this.wss = null;
    this.clients.clear();
  }

  /**
   * Broadcast a validated AvatarEvent JSON to all connected avatar clients.
   * Safe to call even if no clients are connected.
   */
  broadcast(event: AvatarEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async connectToHermes(url: string): Promise<void> {
    const ws = new WebSocket(url);
    this.hermesWs = ws;
    let connected = false;

    ws.on('message', (data) => {
      try {
        const raw = JSON.parse(data.toString()) as unknown;
        const event = parseIncomingPayload(raw);
        if (event) {
          this.broadcast(event);
        } else {
          console.warn('[HermesAdapterServer] Dropped unrecognised payload:', data.toString().slice(0, 200));
        }
      } catch (err) {
        console.warn('[HermesAdapterServer] Failed to parse message:', err);
      }
    });

    ws.on('close', () => {
      if (this.hermesIntentionalClose || !connected) return;
      console.warn('[HermesAdapterServer] Hermes upstream closed — scheduling reconnect.');
      this.hermesWs = null;
      this.scheduleHermesReconnect(url);
    });

    ws.on('error', (err) => {
      // onerror precedes onclose — log only, let onclose schedule the retry.
      if (!this.hermesIntentionalClose) {
        console.warn('[HermesAdapterServer] Hermes upstream error:', err.message);
      }
    });

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        connected = true;
        this.hermesRetryCount = 0;
        console.log(`[HermesAdapterServer] Connected to Hermes at ${url}`);
        resolve();
      });
      ws.once('error', reject);
    });
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
      this.broadcast({ type: 'error', message: `Lost Hermes connection at ${url}` });
      return;
    }

    const delay = HERMES_BASE_DELAY_MS * Math.pow(2, this.hermesRetryCount - 1);
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
}
