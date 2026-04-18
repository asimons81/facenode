import type { AvatarState } from './stateMachine.js';

/** Oculus OVR standard 15-viseme set. */
export const VISEMES = [
  'sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS', 'nn', 'RR',
  'aa', 'E', 'ih', 'oh', 'ou',
] as const;

/** Relative mouth openness per OVR viseme for fallback speech shaping. */
export const VISEME_OPENNESS: Record<(typeof VISEMES)[number], number> = {
  sil: 0,
  PP: 0.05,
  FF: 0.1,
  TH: 0.15,
  DD: 0.3,
  kk: 0.3,
  CH: 0.35,
  SS: 0.2,
  nn: 0.25,
  RR: 0.4,
  aa: 1,
  E: 0.65,
  ih: 0.55,
  oh: 0.85,
  ou: 0.7,
};

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
   * If no frame is received briefly, Layer 1 resumes automatically.
   */
  applyVisemeFrame(frame: VisemeFrame): void;
}
