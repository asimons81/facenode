import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HermesAdapterClient } from '../src/HermesAdapterClient.js';
import type { WsStatus } from '../src/HermesAdapterClient.js';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static throwOnCreate = false;

  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;

  constructor(public readonly url: string) {
    if (FakeWebSocket.throwOnCreate) {
      throw new Error('connect failed');
    }
    FakeWebSocket.instances.push(this);
  }

  close(): void {
    // no-op for tests; unexpected closes are driven manually via emitClose().
  }

  emitOpen(): void {
    this.onopen?.();
  }

  emitClose(): void {
    this.onclose?.();
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe('HermesAdapterClient disconnect lifecycle', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    FakeWebSocket.instances = [];
    FakeWebSocket.throwOnCreate = false;
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.WebSocket = originalWebSocket;
  });

  it('dispatches disconnected when an established socket closes unexpectedly', () => {
    const controller = { dispatch: vi.fn() };
    const client = new HermesAdapterClient({
      url: 'ws://localhost:3456',
      controller,
    });

    client.connect();
    const ws = FakeWebSocket.instances[0];
    expect(ws).toBeDefined();

    ws!.emitOpen();
    ws!.emitClose();

    expect(controller.dispatch).toHaveBeenCalledWith({ type: 'disconnected' });
  });

  it('dispatches disconnected before error when retries are exhausted', () => {
    FakeWebSocket.throwOnCreate = true;

    const controller = { dispatch: vi.fn() };
    const client = new HermesAdapterClient({
      url: 'ws://localhost:3456',
      controller,
    });

    client.connect();
    vi.runAllTimers();

    expect(controller.dispatch.mock.calls).toEqual([
      [{ type: 'disconnected' }],
      [
        {
          type: 'error',
          message:
            'WebSocket connection to ws://localhost:3456 failed after 5 retries.',
        },
      ],
    ]);
  });

  it('tears down the prior socket before a manual reconnect and notifies both status listeners', () => {
    const controller = { dispatch: vi.fn() };
    const optionStatuses: WsStatus[] = [];
    const listenerStatuses: WsStatus[] = [];
    const client = new HermesAdapterClient({
      url: 'ws://localhost:3456',
      controller,
      onStatusChange: (status) => optionStatuses.push(status),
    });
    client.onStatusChange((status) => listenerStatuses.push(status));

    client.connect();
    const first = FakeWebSocket.instances[0];
    expect(first).toBeDefined();
    first!.emitOpen();
    first!.emitClose();

    client.connect();
    const second = FakeWebSocket.instances[1];
    expect(second).toBeDefined();
    second!.emitOpen();

    vi.advanceTimersByTime(1000);

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(optionStatuses).toEqual(listenerStatuses);
    expect(optionStatuses).toEqual(['connecting', 'connected', 'connecting', 'connected']);
  });

  it('dispatches raw AvatarEvent payloads unchanged', () => {
    const controller = { dispatch: vi.fn() };
    const client = new HermesAdapterClient({
      url: 'ws://localhost:3456',
      controller,
    });

    client.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    ws.emitMessage({ type: 'thinking_start' });

    expect(controller.dispatch).toHaveBeenCalledWith({ type: 'thinking_start' });
  });

  it('unwraps runtime envelope payloads before dispatching to the controller', () => {
    const controller = { dispatch: vi.fn() };
    const diagnostics = vi.fn();
    const client = new HermesAdapterClient({
      url: 'ws://localhost:3456',
      controller,
      onRuntimeDiagnosticsChange: diagnostics,
    });

    client.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    ws.emitMessage({
      version: 1,
      source: 'hermes-adapter',
      sequence: 1,
      timestamp: 1234,
      event: { type: 'speech_end' },
    });

    expect(controller.dispatch).toHaveBeenCalledWith({ type: 'speech_end' });
    expect(diagnostics).toHaveBeenLastCalledWith(expect.objectContaining({
      lastAcceptedEvent: expect.objectContaining({
        sequence: 1,
        event: { type: 'speech_end' },
      }),
    }));
  });

  it('updates runtime diagnostics when the server sends a diagnostics snapshot', () => {
    const controller = { dispatch: vi.fn() };
    const client = new HermesAdapterClient({
      url: 'ws://localhost:3456',
      controller,
    });

    client.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();
    ws.emitMessage({
      kind: 'runtime_diagnostics',
      version: 1,
      source: 'hermes-adapter',
      updatedAt: 1234,
      connectionState: 'connected',
      reconnectAttempts: 2,
      droppedPayloadCount: 3,
      lastDropReason: 'invalid_hermes_payload',
      lastDropDetail: 'bad amplitude',
      sessionId: 'session-1',
      utteranceId: 'utt-1',
    });

    expect(client.runtimeDiagnostics).toMatchObject({
      source: 'hermes-adapter',
      connectionState: 'connected',
      reconnectAttempts: 2,
      droppedPayloadCount: 3,
      lastDropReason: 'invalid_hermes_payload',
      sessionId: 'session-1',
      utteranceId: 'utt-1',
    });
    expect(controller.dispatch).not.toHaveBeenCalled();
  });

  it('drops out-of-order runtime envelopes with an explicit drop reason', () => {
    const controller = { dispatch: vi.fn() };
    const client = new HermesAdapterClient({
      url: 'ws://localhost:3456',
      controller,
    });

    client.connect();
    const ws = FakeWebSocket.instances[0]!;
    ws.emitOpen();

    ws.emitMessage({
      version: 1,
      source: 'hermes-adapter',
      sequence: 4,
      timestamp: 1000,
      event: { type: 'speech_start' },
    });
    ws.emitMessage({
      version: 1,
      source: 'hermes-adapter',
      sequence: 3,
      timestamp: 900,
      event: { type: 'speech_chunk', amplitude: 0.2 },
    });

    expect(controller.dispatch.mock.calls).toEqual([
      [{ type: 'speech_start' }],
    ]);
    expect(client.runtimeDiagnostics).toMatchObject({
      droppedPayloadCount: 1,
      lastDropReason: 'out_of_order_runtime_event',
    });
  });
});
