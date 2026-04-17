/**
 * MockHermesEmitter — Node.js only.
 *
 * Standalone WebSocket server that emits a scripted sequence of events on a
 * loop. Use this to develop and demo the avatar without a live Hermes instance.
 *
 * Protocol:
 *  - Clients connect to ws://localhost:<port>
 *  - Each new client immediately receives a "connected / ready" event so
 *    the avatar reaches idle state.
 *  - The global sequence loop broadcasts to ALL connected clients simultaneously.
 *  - The loop repeats with an optional inter-cycle pause (loopInterval).
 *
 * hermesMode:
 *  - When false (default): broadcasts Runtime Contract v1 envelopes.
 *    Use with HermesAdapterClient directly.
 *  - When true: broadcasts Hermes-native payload JSON.
 *    Use with HermesAdapterServer (hermesWsUrl pointing here) to test the full
 *    Hermes → HermesAdapterServer → HermesAdapterClient → AvatarController path.
 *
 * Run via: pnpm mock          (runtime-envelope mode)
 *          pnpm mock --hermes-mode  (Hermes payload mode)
 */
import { WebSocketServer, WebSocket } from 'ws';
import { createRuntimeEventEnvelope } from '@facenode/avatar-core';
import type { AvatarEvent } from '@facenode/avatar-core';

// ── Types ─────────────────────────────────────────────────────────────────────

type AvatarStep =
  | { kind: 'event'; event: AvatarEvent }
  | { kind: 'wait'; ms: number };

// Raw Hermes payload shape (what a real Hermes server would emit)
type HermesPayload = Record<string, unknown>;

// ── Sequence definition ───────────────────────────────────────────────────────

const SEQUENCE: AvatarStep[] = [
  { kind: 'event', event: { type: 'connected' } },
  { kind: 'wait', ms: 2000 },
  { kind: 'event', event: { type: 'listening_start' } },
  { kind: 'wait', ms: 1500 },
  { kind: 'event', event: { type: 'listening_end' } },
  { kind: 'event', event: { type: 'thinking_start' } },
  { kind: 'wait', ms: 2000 },
  { kind: 'event', event: { type: 'thinking_end' } },
  { kind: 'event', event: { type: 'speech_start' } },
  { kind: 'wait', ms: 300 },

  // Speech chunk 1 — with viseme frame
  { kind: 'event', event: { type: 'viseme_frame', timestamp: 300, visemes: [{ viseme: 'sil', weight: 0.8 }, { viseme: 'PP', weight: 0.2 }] } },
  { kind: 'event', event: { type: 'speech_chunk', text: 'Hello.', amplitude: 0.5 } },
  { kind: 'wait', ms: 250 },
  { kind: 'event', event: { type: 'viseme_frame', timestamp: 550, visemes: [{ viseme: 'E', weight: 0.7 }, { viseme: 'ih', weight: 0.3 }] } },
  { kind: 'wait', ms: 250 },

  // Speech chunk 2
  { kind: 'event', event: { type: 'viseme_frame', timestamp: 800, visemes: [{ viseme: 'aa', weight: 0.9 }] } },
  { kind: 'event', event: { type: 'speech_chunk', text: 'Hello, I', amplitude: 0.7 } },
  { kind: 'wait', ms: 250 },
  { kind: 'event', event: { type: 'viseme_frame', timestamp: 1050, visemes: [{ viseme: 'ih', weight: 0.6 }, { viseme: 'E', weight: 0.4 }] } },
  { kind: 'wait', ms: 250 },

  // Speech chunk 3
  { kind: 'event', event: { type: 'viseme_frame', timestamp: 1300, visemes: [{ viseme: 'aa', weight: 0.8 }, { viseme: 'nn', weight: 0.2 }] } },
  { kind: 'event', event: { type: 'speech_chunk', text: 'Hello, I am', amplitude: 0.65 } },
  { kind: 'wait', ms: 250 },
  { kind: 'event', event: { type: 'viseme_frame', timestamp: 1550, visemes: [{ viseme: 'E', weight: 0.5 }, { viseme: 'oh', weight: 0.5 }] } },
  { kind: 'wait', ms: 250 },

  // Speech chunk 4
  { kind: 'event', event: { type: 'viseme_frame', timestamp: 1800, visemes: [{ viseme: 'ou', weight: 0.7 }, { viseme: 'oh', weight: 0.3 }] } },
  { kind: 'event', event: { type: 'speech_chunk', text: 'Hello, I am Ozzy.', amplitude: 0.85 } },
  { kind: 'wait', ms: 500 },

  { kind: 'event', event: { type: 'speech_end' } },
  { kind: 'wait', ms: 3000 },
];

// ── Hermes payload encoder ────────────────────────────────────────────────────

/** Convert an AvatarEvent to its equivalent Hermes-native payload. */
function toHermesPayload(event: AvatarEvent): HermesPayload | null {
  switch (event.type) {
    case 'connected':         return { event: 'ready' };
    case 'disconnected':      return { event: 'disconnect' };
    case 'listening_start':   return { event: 'user.speech.start' };
    case 'listening_end':     return { event: 'user.speech.end' };
    case 'thinking_start':    return { event: 'llm.start' };
    case 'thinking_end':      return { event: 'llm.end' };
    case 'speech_start':      return { event: 'tts.start', audio_url: event.audioUrl };
    case 'speech_chunk':      return { event: 'tts.chunk', text: event.text, amplitude: event.amplitude };
    case 'speech_end':        return { event: 'tts.end' };
    case 'viseme_frame':      return { event: 'tts.viseme', timestamp: event.timestamp, visemes: event.visemes };
    case 'error':             return { event: 'error', message: event.message };
  }
}

// ── Class ─────────────────────────────────────────────────────────────────────

export interface MockHermesEmitterOptions {
  port: number;
  /** Delay (ms) between loop repetitions. Default: 0. */
  loopInterval?: number;
  /**
   * When true, emit Hermes-native payload JSON instead of AvatarEvent JSON.
   * Use this to test the full HermesAdapterServer translation path.
   * Default: false.
   */
  hermesMode?: boolean;
}

export class MockHermesEmitter {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();
  private abort: AbortController | null = null;
  private readonly hermesMode: boolean;
  private runtimeSequence = 0;

  constructor(private readonly options: MockHermesEmitterOptions) {
    this.hermesMode = options.hermesMode ?? false;
  }

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ port: this.options.port });

    this.wss.on('connection', (client) => {
      this.clients.add(client);

      // Immediately orient the new client.
      if (this.hermesMode) {
        this.sendRaw(client, JSON.stringify({ event: 'ready' }));
      } else {
        this.sendRaw(client, JSON.stringify(this.toRuntimeEnvelope({ type: 'connected' })));
      }

      client.on('close', () => this.clients.delete(client));
      client.on('error', () => this.clients.delete(client));
    });

    await new Promise<void>((resolve, reject) => {
      this.wss!.once('listening', resolve);
      this.wss!.once('error', reject);
    });

    const modeLabel = this.hermesMode ? 'hermes-mode' : 'runtime-envelope mode';
    console.log(`[MockHermesEmitter] Ready — ws://localhost:${this.options.port} (${modeLabel})`);
    console.log(
      `[MockHermesEmitter] Sequence: ${SEQUENCE.filter((s) => s.kind === 'event').length} events` +
        ` | loop interval: ${this.options.loopInterval ?? 0}ms`,
    );

    this.abort = new AbortController();
    void this.runLoop(this.abort.signal);
  }

  async stop(): Promise<void> {
    this.abort?.abort();
    this.abort = null;

    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });

    this.wss = null;
    this.clients.clear();
    console.log('[MockHermesEmitter] Stopped.');
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private sendRaw(client: WebSocket, payload: string): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }

  private broadcast(event: AvatarEvent): void {
    let payload: string;

    if (this.hermesMode) {
      const hermes = toHermesPayload(event);
      if (!hermes) return; // skip if no mapping
      payload = JSON.stringify(hermes);
    } else {
      payload = JSON.stringify(this.toRuntimeEnvelope(event));
    }

    const label =
      event.type === 'speech_chunk'
        ? `speech_chunk "${event.text ?? ''}"`
        : event.type === 'viseme_frame'
        ? `viseme_frame [${event.visemes.map((v) => v.viseme).join(',')}]`
        : event.type;
    console.log(`[MockHermesEmitter] → ${label}`);

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        clearTimeout(tid);
        signal.removeEventListener('abort', onAbort);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      const tid = setTimeout(() => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal.addEventListener('abort', onAbort);
    });
  }

  private toRuntimeEnvelope(event: AvatarEvent) {
    this.runtimeSequence += 1;
    return createRuntimeEventEnvelope(event, {
      source: 'mock-hermes-emitter',
      sequence: this.runtimeSequence,
    });
  }

  private async runLoop(signal: AbortSignal): Promise<void> {
    try {
      while (!signal.aborted) {
        for (const step of SEQUENCE) {
          if (signal.aborted) break;

          if (step.kind === 'event') {
            this.broadcast(step.event);
          } else {
            await this.sleep(step.ms, signal);
          }
        }

        const interval = this.options.loopInterval ?? 0;
        if (!signal.aborted && interval > 0) {
          await this.sleep(interval, signal);
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Normal shutdown.
      } else {
        console.error('[MockHermesEmitter] Loop error:', err);
      }
    }
  }
}
