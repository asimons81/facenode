import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  type Handler = (...args: any[]) => void;

  class SimpleEmitter {
    private listeners = new Map<string, Handler[]>();

    on(event: string, handler: Handler): this {
      const list = this.listeners.get(event) ?? [];
      list.push(handler);
      this.listeners.set(event, list);
      return this;
    }

    once(event: string, handler: Handler): this {
      const onceHandler: Handler = (...args) => {
        this.off(event, onceHandler);
        handler(...args);
      };
      return this.on(event, onceHandler);
    }

    off(event: string, handler: Handler): void {
      const list = this.listeners.get(event);
      if (!list) return;
      this.listeners.set(
        event,
        list.filter((candidate) => candidate !== handler),
      );
    }

    removeAllListeners(): void {
      this.listeners.clear();
    }

    emit(event: string, ...args: any[]): void {
      const list = this.listeners.get(event);
      if (!list) return;
      for (const handler of [...list]) {
        handler(...args);
      }
    }
  }

  class MockWebSocketServer extends SimpleEmitter {
    static instances: MockWebSocketServer[] = [];

    public closed = false;
    constructor(public readonly options: { port: number }) {
      super();
      MockWebSocketServer.instances.push(this);
      queueMicrotask(() => this.emit('listening'));
    }

    close(cb?: (err?: Error | null) => void): void {
      this.closed = true;
      cb?.();
    }
  }

  class MockWebSocket extends SimpleEmitter {
    static instances: MockWebSocket[] = [];
    static failConnect = false;
    static OPEN = 1;

    public readonly sentPayloads: string[] = [];
    public readyState = MockWebSocket.OPEN;

    constructor(public readonly url: string) {
      super();
      MockWebSocket.instances.push(this);
      queueMicrotask(() => {
        if (MockWebSocket.failConnect) {
          this.emit('error', new Error('connect failed'));
          this.emit('close');
        } else {
          this.emit('open');
        }
      });
    }

    close(): void {
      queueMicrotask(() => this.emit('close'));
    }

    send(payload: string): void {
      this.sentPayloads.push(payload);
    }
  }

  return { MockWebSocketServer, MockWebSocket };
});

vi.mock('ws', () => ({
  WebSocketServer: mocks.MockWebSocketServer,
  WebSocket: mocks.MockWebSocket,
}));

import { HermesAdapterServer, parseIncomingPayload } from '../src/HermesAdapterServer.js';

describe('HermesAdapterServer lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.MockWebSocketServer.instances = [];
    mocks.MockWebSocket.instances = [];
    mocks.MockWebSocket.failConnect = false;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('cleans up the local server if the initial upstream Hermes connection fails', async () => {
    mocks.MockWebSocket.failConnect = true;
    const server = new HermesAdapterServer({ port: 9876, hermesWsUrl: 'ws://hermes.local' });

    await expect(server.start()).rejects.toThrow('connect failed');

    expect(mocks.MockWebSocketServer.instances).toHaveLength(1);
    expect(mocks.MockWebSocketServer.instances[0]?.closed).toBe(true);
    expect((server as any).wss).toBeNull();
    expect((server as any).hermesRetryTimer).toBeNull();
  });

  it('keeps only one reconnect timer active at a time', () => {
    const server = new HermesAdapterServer({ port: 9876 });
    const connectSpy = vi.spyOn(server as any, 'connectToHermes').mockResolvedValue(undefined);

    (server as any).scheduleHermesReconnect('ws://hermes.local');
    (server as any).scheduleHermesReconnect('ws://hermes.local');

    vi.runOnlyPendingTimers();

    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  it('preserves optional envelope metadata across parse and broadcast', async () => {
    const server = new HermesAdapterServer({ port: 9876 });
    await server.start();

    const wss = mocks.MockWebSocketServer.instances[0]!;
    const client = new mocks.MockWebSocket('ws://client');
    wss.emit('connection', client);

    const incoming = {
      version: 1,
      source: 'upstream-hermes',
      sequence: 9,
      timestamp: 1234,
      sessionId: 'session-123',
      utteranceId: 'utterance-456',
      event: { type: 'connected' as const },
    };

    const parsed = parseIncomingPayload(incoming);
    expect(parsed).toEqual(incoming);

    server.broadcast(parsed!);

    const sentMessages = client.sentPayloads.map((payload) => JSON.parse(payload));
    expect(sentMessages).toEqual(
      expect.arrayContaining([
        incoming,
        expect.objectContaining({
          kind: 'runtime_diagnostics',
          source: 'hermes-adapter',
          lastAcceptedEvent: incoming,
          sessionId: 'session-123',
          utteranceId: 'utterance-456',
        }),
      ]),
    );
  });

  it('pushes an initial diagnostics snapshot to newly connected clients', async () => {
    const server = new HermesAdapterServer({ port: 9876, hermesWsUrl: 'ws://hermes.local' });
    await server.start();

    const wss = mocks.MockWebSocketServer.instances[0]!;
    const client = new mocks.MockWebSocket('ws://client');
    wss.emit('connection', client);

    expect(client.sentPayloads).toHaveLength(1);
    expect(JSON.parse(client.sentPayloads[0]!)).toMatchObject({
      kind: 'runtime_diagnostics',
      source: 'hermes-adapter',
      connectionState: 'connected',
      reconnectAttempts: 0,
      droppedPayloadCount: 0,
    });
  });

  it('broadcasts a disconnected lifecycle reset when upstream Hermes drops mid-utterance', async () => {
    const server = new HermesAdapterServer({ port: 9876, hermesWsUrl: 'ws://hermes.local' });
    await server.start();

    const upstream = mocks.MockWebSocket.instances[0]!;
    const wss = mocks.MockWebSocketServer.instances[0]!;
    const client = new mocks.MockWebSocket('ws://client');
    wss.emit('connection', client);

    upstream.emit('message', Buffer.from(JSON.stringify({
      event: 'tts.start',
      sessionId: 'session-live',
      utteranceId: 'utt-live',
    })));
    upstream.emit('close');

    const sentMessages = client.sentPayloads.map((payload) => JSON.parse(payload));
    expect(sentMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        event: { type: 'speech_start' },
        sessionId: 'session-live',
        utteranceId: 'utt-live',
      }),
      expect.objectContaining({
        event: { type: 'disconnected' },
        sessionId: 'session-live',
      }),
      expect.objectContaining({
        kind: 'runtime_diagnostics',
        connectionState: 'reconnecting',
        lastAcceptedEvent: expect.objectContaining({
          event: { type: 'disconnected' },
        }),
      }),
    ]));
  });

  it('emits one disconnect reset and then an error when retries are exhausted', async () => {
    const server = new HermesAdapterServer({ port: 9876, hermesWsUrl: 'ws://hermes.local' });
    await server.start();

    const upstream = mocks.MockWebSocket.instances[0]!;
    const wss = mocks.MockWebSocketServer.instances[0]!;
    const client = new mocks.MockWebSocket('ws://client');
    wss.emit('connection', client);

    upstream.emit('message', Buffer.from(JSON.stringify({
      event: 'tts.start',
      sessionId: 'session-live',
      utteranceId: 'utt-live',
    })));

    mocks.MockWebSocket.failConnect = true;
    upstream.emit('close');
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await vi.runOnlyPendingTimersAsync();
    }

    const sentMessages = client.sentPayloads.map((payload) => JSON.parse(payload));
    const disconnects = sentMessages.filter((payload) => payload.event?.type === 'disconnected');
    expect(disconnects).toHaveLength(1);
    expect(server.getRuntimeDiagnostics()).toMatchObject({
      connectionState: 'error',
      reconnectAttempts: 5,
    });
  });
});



