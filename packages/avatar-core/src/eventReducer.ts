import type { AvatarEvent } from './events.js';
import type { AvatarState } from './stateMachine.js';

/**
 * Pure function — no side effects.
 *
 * Maps (current state, event) → next state following the transition table:
 *
 *   connected     → idle           (from any state)
 *   disconnected  → disconnected   (from any state)
 *   error         → error          (from any state)
 *   speech_chunk  → current        (amplitude-only event; no state change)
 *   viseme_frame  → current        (lip sync event; no state change)
 *
 *   listening_start  idle        → listening
 *   listening_end    listening   → idle
 *   thinking_start   idle|listening → thinking
 *   thinking_end     thinking    → idle
 *   speech_start     thinking|idle → speaking
 *   speech_end       speaking    → idle
 *
 * Invalid transitions return `current` unchanged.
 * The caller (AvatarStateMachine) is responsible for warning on invalid input.
 */
export function reduceEvent(current: AvatarState, event: AvatarEvent): AvatarState {
  switch (event.type) {
    case 'connected':
      return 'idle';

    case 'disconnected':
      return 'disconnected';

    case 'error':
      return 'error';

    // No-op events — never change state.
    case 'speech_chunk':
    case 'viseme_frame':
      return current;

    case 'listening_start':
      return current === 'idle' ? 'listening' : current;

    case 'listening_end':
      return current === 'listening' ? 'idle' : current;

    case 'thinking_start':
      return current === 'idle' || current === 'listening' ? 'thinking' : current;

    case 'thinking_end':
      return current === 'thinking' ? 'idle' : current;

    case 'speech_start':
      return current === 'thinking' || current === 'idle' ? 'speaking' : current;

    case 'speech_end':
      return current === 'speaking' ? 'idle' : current;
  }
}
