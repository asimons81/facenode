import type { AvatarState } from './stateMachine.js';

/** Oculus OVR standard 15-viseme set. */
export const VISEMES = [
  'sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR',
  'aa', 'E', 'ih', 'oh', 'ou',
] as const;

export type Viseme = typeof VISEMES[number];

export interface VisemeFrame {
  timestamp: number;
  visemes: Array<{ viseme: Viseme; weight: number }>;
}

/**
 * Interface for animation controllers.
 * Implementations live in web-avatar (Three.js scene).
 * This package defines the contract only — no renderer code here.
 */
export interface AnimationController {
  /** Called when the avatar enters a new state. */
  onEnterState(state: AvatarState): void;

  /** Called when the avatar exits a state. */
  onExitState(state: AvatarState): void;

  /**
   * Layer 1 lip sync: amplitude-driven mouth animation.
   * @param value Normalised amplitude in [0, 1].
   */
  setMouthAmplitude(value: number): void;

  /**
   * Layer 2 lip sync: apply a viseme frame.
   * When called, suppresses Layer 1 amplitude-based mouth movement.
   * If no frame is received for >100 ms, Layer 1 resumes automatically.
   */
  applyVisemeFrame(frame: VisemeFrame): void;
}
