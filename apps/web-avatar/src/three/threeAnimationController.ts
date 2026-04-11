import type { AnimationController, VisemeFrame } from '@facenode/avatar-core';
import type { AvatarState } from '@facenode/avatar-core';
import type { AvatarMesh } from './avatarMesh.js';

// State-specific head tint colors
const COLOR_ERROR = 0xe05c5c;
const COLOR_DISCONNECTED = 0x555555;

type BlinkMode = 'slow' | 'normal' | 'fast';

// Blink intervals (min, max) in seconds per mode
const BLINK_INTERVALS: Record<BlinkMode, [number, number]> = {
  slow:   [4, 8],
  normal: [2, 6],
  fast:   [1, 3],
};

// How long (seconds) without a viseme frame before Layer 1 resumes
const VISEME_TIMEOUT = 0.1;

// ── Blink controller ──────────────────────────────────────────────────────────

class BlinkController {
  private timeUntilBlink: number;
  private blinkElapsed = -1;
  private static readonly DURATION = 0.14;

  constructor(
    private eyeL: { scale: { y: number } },
    private eyeR: { scale: { y: number } },
  ) {
    this.timeUntilBlink = this.randomInterval(2, 6);
  }

  /** Replace eye references when mesh is hot-swapped. */
  setEyes(eyeL: { scale: { y: number } }, eyeR: { scale: { y: number } }): void {
    this.eyeL = eyeL;
    this.eyeR = eyeR;
  }

  private randomInterval(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  update(delta: number, mode: BlinkMode): void {
    const [min, max] = BLINK_INTERVALS[mode];

    if (this.blinkElapsed < 0) {
      this.timeUntilBlink -= delta;
      if (this.timeUntilBlink <= 0) {
        this.blinkElapsed = 0;
      }
    } else {
      this.blinkElapsed += delta;
      if (this.blinkElapsed >= BlinkController.DURATION) {
        this.blinkElapsed = -1;
        this.timeUntilBlink = this.randomInterval(min, max);
      }
    }

    const scaleY =
      this.blinkElapsed < 0
        ? 1
        : 1 - Math.sin((this.blinkElapsed / BlinkController.DURATION) * Math.PI);

    this.eyeL.scale.y = scaleY;
    this.eyeR.scale.y = scaleY;
  }
}

// ── Main controller ───────────────────────────────────────────────────────────

export class ThreeAnimationController implements AnimationController {
  private state: AvatarState = 'disconnected';
  private elapsed = 0;
  private amplitude = 0;

  // Config-driven parameters
  private idleIntensity = 0.5;
  private blinkFrequency: BlinkMode = 'normal';

  // Layer 2 viseme state
  /** Time (seconds) since the last viseme frame was received. Negative = no frame yet. */
  private timeSinceVisemeFrame = -1;
  /** Whether Layer 2 is currently suppressing Layer 1 amplitude mouth control. */
  private visemeActive = false;

  private avatar: AvatarMesh;
  private readonly blink: BlinkController;

  constructor(avatar: AvatarMesh) {
    this.avatar = avatar;
    this.blink = new BlinkController(avatar.eyeL, avatar.eyeR);
  }

  // ── Mesh hot-swap ─────────────────────────────────────────────────────────

  setAvatarMesh(mesh: AvatarMesh): void {
    this.avatar = mesh;
    this.blink.setEyes(mesh.eyeL, mesh.eyeR);
    // Re-enter current state to apply color etc.
    this.avatar.onEnterState?.(this.state);
    this.onEnterState(this.state);
  }

  // ── AnimationController interface ─────────────────────────────────────────

  onEnterState(state: AvatarState): void {
    this.state = state;
    this.elapsed = 0;

    switch (state) {
      case 'error':
        this.avatar.setHeadColor(COLOR_ERROR);
        break;
      case 'disconnected':
        this.avatar.setHeadColor(COLOR_DISCONNECTED);
        break;
      default:
        this.avatar.resetHeadColor();
    }
  }

  onExitState(_state: AvatarState): void {}

  setMouthAmplitude(value: number): void {
    this.amplitude = value;
    // Layer 2 active: don't drive mouth from amplitude directly
    if (!this.visemeActive) {
      this.avatar.setMouthAmplitude(value);
    }
  }

  applyVisemeFrame(frame: VisemeFrame): void {
    this.timeSinceVisemeFrame = 0;
    this.visemeActive = true;

    const mesh = this.avatar;
    mesh.beginVisemeFrame?.();

    for (const { viseme, weight } of frame.visemes) {
      mesh.setViseme(viseme, weight);
    }

    mesh.flushVisemeFrame?.();
  }

  // ── Config setters ────────────────────────────────────────────────────────

  setIdleIntensity(value: number): void {
    this.idleIntensity = Math.max(0, Math.min(1, value));
  }

  setBlinkFrequency(freq: BlinkMode): void {
    this.blinkFrequency = freq;
  }

  // ── Blink mode resolution ─────────────────────────────────────────────────

  private resolveBlinkMode(stateDefault: BlinkMode): BlinkMode {
    return this.blinkFrequency === 'normal' ? stateDefault : this.blinkFrequency;
  }

  // ── Per-frame update ──────────────────────────────────────────────────────

  update(delta: number): void {
    this.elapsed += delta;
    const t = this.elapsed;
    const hg = this.avatar.headGroup;
    const ii = this.idleIntensity;

    // Layer 2 timeout: if no viseme frame for >VISEME_TIMEOUT seconds, fall back to Layer 1
    if (this.timeSinceVisemeFrame >= 0) {
      this.timeSinceVisemeFrame += delta;
      if (this.timeSinceVisemeFrame > VISEME_TIMEOUT) {
        this.visemeActive = false;
        this.timeSinceVisemeFrame = -1;
        // Restore Layer 1 mouth amplitude immediately
        this.avatar.setMouthAmplitude(this.amplitude);
      }
    }

    switch (this.state) {
      case 'idle': {
        hg.position.y = Math.sin(t * 0.75) * 0.012 * ii;
        hg.rotation.x = 0;
        hg.rotation.z = Math.sin(t * 0.28) * 0.018 * ii;
        this.blink.update(delta, this.resolveBlinkMode('normal'));
        break;
      }

      case 'listening': {
        hg.position.y = Math.sin(t * 1.1) * 0.008 * ii;
        hg.rotation.x = (-0.07 + Math.sin(t * 0.55) * 0.018) * ii;
        hg.rotation.z = Math.sin(t * 1.4) * 0.012 * ii;
        this.blink.update(delta, this.resolveBlinkMode('fast'));
        break;
      }

      case 'thinking': {
        hg.position.y = Math.sin(t * 0.35) * 0.008 * ii;
        hg.rotation.x = Math.sin(t * 0.42) * 0.04 * ii;
        hg.rotation.z = Math.sin(t * 0.48) * 0.13;
        this.blink.update(delta, this.resolveBlinkMode('normal'));
        break;
      }

      case 'speaking': {
        const amp = this.amplitude;
        hg.position.y = Math.sin(t * 5.5) * 0.007 * (0.4 + amp);
        hg.rotation.x = Math.sin(t * 3.8) * 0.015 * (0.3 + amp);
        hg.rotation.z = Math.sin(t * 2.1) * 0.01 * ii;
        this.blink.update(delta, this.resolveBlinkMode('fast'));
        break;
      }

      case 'error':
      case 'disconnected': {
        hg.position.y += (0 - hg.position.y) * Math.min(1, delta * 5);
        hg.rotation.x += (0 - hg.rotation.x) * Math.min(1, delta * 5);
        hg.rotation.z += (0 - hg.rotation.z) * Math.min(1, delta * 5);
        break;
      }
    }
  }
}
