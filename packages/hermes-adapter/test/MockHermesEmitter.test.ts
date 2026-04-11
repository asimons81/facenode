import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockHermesEmitter } from '../src/MockHermesEmitter.js';

describe('MockHermesEmitter sleep cleanup', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('removes the abort listener when a sleep resolves normally', async () => {
    vi.useFakeTimers();
    const emitter = new MockHermesEmitter({ port: 9999 });
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, 'addEventListener');
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    const sleepPromise = (emitter as any).sleep(25, controller.signal);
    await vi.advanceTimersByTimeAsync(25);
    await sleepPromise;

    expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
