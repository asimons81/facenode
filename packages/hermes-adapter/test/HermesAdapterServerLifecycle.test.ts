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

    send(_payload: string): void {}
  }

  return { MockWebSocketServer, MockWebSocket };
});

vi.mock('ws', () => ({
  WebSocketServer: mocks.MockWebSocketServer,
  WebSocket: mocks.MockWebSocket,
}));

import { HermesAdapterServer } from '../src/HermesAdapterServer.js';

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
});
