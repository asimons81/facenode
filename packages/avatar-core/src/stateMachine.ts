import type { AvatarEvent } from './events.js';
import { reduceEvent } from './eventReducer.js';

export type AvatarState =
  | 'idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'error'
  | 'disconnected';

type StateListener = () => void;
type ChangeListener = (next: AvatarState, prev: AvatarState) => void;

/**
 * Events that represent directed state transitions.
 * If one of these arrives but the state doesn't change, it means the
 * transition was invalid for the current state — log a warning.
 *
 * Universal events (connected, disconnected, error) and the no-op
 * amplitude event (speech_chunk) are excluded from warning checks.
 */
const DIRECTIONAL_EVENTS = new Set<AvatarEvent['type']>([
  'listening_start',
  'listening_end',
  'thinking_start',
  'thinking_end',
  'speech_start',
  'speech_end',
]);

export class AvatarStateMachine {
  #state: AvatarState;
  #stateListeners = new Map<AvatarState, Set<StateListener>>();
  #changeListeners = new Set<ChangeListener>();

  constructor(initial: AvatarState = 'disconnected') {
    this.#state = initial;
  }

  get current(): AvatarState {
    return this.#state;
  }

  /**
   * Apply an event to the state machine.
   * Invalid transitions are no-ops — a warning is emitted but no error thrown.
   * @returns The resulting state (may equal the current state on no-op).
   */
  transition(event: AvatarEvent): AvatarState {
    const next = reduceEvent(this.#state, event);

    if (next === this.#state) {
      if (DIRECTIONAL_EVENTS.has(event.type)) {
        console.warn(
          `[AvatarStateMachine] Ignored '${event.type}' — invalid from state '${this.#state}'`,
        );
      }
      return this.#state;
    }

    const prev = this.#state;
    this.#state = next;

    this.#stateListeners.get(next)?.forEach((cb) => cb());
    this.#changeListeners.forEach((cb) => cb(next, prev));

    return next;
  }

  /**
   * Subscribe to a specific state being entered.
   * @returns Unsubscribe function.
   */
  on(state: AvatarState, cb: StateListener): () => void {
    let listeners = this.#stateListeners.get(state);
    if (listeners === undefined) {
      listeners = new Set();
      this.#stateListeners.set(state, listeners);
    }
    listeners.add(cb);
    return () => {
      this.#stateListeners.get(state)?.delete(cb);
    };
  }

  /**
   * Subscribe to any state change.
   * @returns Unsubscribe function.
   */
  onChange(cb: ChangeListener): () => void {
    this.#changeListeners.add(cb);
    return () => {
      this.#changeListeners.delete(cb);
    };
  }
}
