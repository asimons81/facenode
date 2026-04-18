import * as THREE from 'three';
import { VISEME_OPENNESS, type AnimationController, type VisemeFrame } from '@facenode/avatar-core';
import type { AvatarState } from '@facenode/avatar-core';
import type { AvatarMesh } from './avatarMesh.js';

const COLOR_ERROR = 0xe05c5c;
const COLOR_DISCONNECTED = 0x555555;

type BlinkMode = 'slow' | 'normal' | 'fast';

const BLINK_INTERVALS: Record<BlinkMode, [number, number]> = {
  slow: [4, 8],
  normal: [2, 6],
  fast: [1, 3],
};

const VISEME_TIMEOUT = 0.18;
const SPEECH_ATTACK = 18;
const SPEECH_RELEASE = 7;
const SPEECH_IDLE_RELEASE = 10;
const SPEECH_HOLD = 0.075;
const MIN_SPEECH_FLOOR = 0.06;

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

export class ThreeAnimationController implements AnimationController {
  private state: AvatarState = 'disconnected';
  private elapsed = 0;
  private inputAmplitude = 0;
  private renderedAmplitude = 0;
  private speechHoldRemaining = 0;
  private lastVisemeAmplitude = 0;

  private idleIntensity = 0.5;
  private blinkFrequency: BlinkMode = 'normal';

  private timeSinceVisemeFrame = -1;
  private visemeActive = false;

  private avatar: AvatarMesh;
  private readonly blink: BlinkController;

  constructor(avatar: AvatarMesh) {
    this.avatar = avatar;
    this.blink = new BlinkController(avatar.eyeL, avatar.eyeR);
  }

  setAvatarMesh(mesh: AvatarMesh): void {
    this.avatar = mesh;
    this.blink.setEyes(mesh.eyeL, mesh.eyeR);
    this.avatar.onEnterState?.(this.state);
    this.onEnterState(this.state);
  }

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
    this.inputAmplitude = THREE.MathUtils.clamp(value, 0, 1);
  }

  applyVisemeFrame(frame: VisemeFrame): void {
    this.timeSinceVisemeFrame = 0;
    this.visemeActive = true;
    this.lastVisemeAmplitude = this.computeFrameOpenness(frame);

    this.avatar.beginVisemeFrame?.();

    for (const { viseme, weight } of frame.visemes) {
      this.avatar.setViseme(viseme, weight);
    }

    this.avatar.flushVisemeFrame?.();
  }

  setIdleIntensity(value: number): void {
    this.idleIntensity = THREE.MathUtils.clamp(value, 0, 1);
  }

  setBlinkFrequency(freq: BlinkMode): void {
    this.blinkFrequency = freq;
  }

  private resolveBlinkMode(stateDefault: BlinkMode): BlinkMode {
    return this.blinkFrequency === 'normal' ? stateDefault : this.blinkFrequency;
  }

  private shapeSpeechAmplitude(value: number): number {
    if (value <= 0.001) return 0;
    const lifted = Math.pow(THREE.MathUtils.clamp(value, 0, 1), 0.72) * 0.92;
    return THREE.MathUtils.clamp(lifted < MIN_SPEECH_FLOOR ? MIN_SPEECH_FLOOR : lifted, 0, 1);
  }

  private computeFrameOpenness(frame: VisemeFrame): number {
    return THREE.MathUtils.clamp(
      frame.visemes.reduce((total, { viseme, weight }) => {
        return total + (VISEME_OPENNESS[viseme] ?? 0.3) * weight;
      }, 0),
      0,
      1,
    );
  }

  private updateSpeechEnvelope(delta: number): void {
    const target = this.state === 'speaking' ? this.shapeSpeechAmplitude(this.inputAmplitude) : 0;

    if (target > this.renderedAmplitude + 0.005) {
      this.speechHoldRemaining = SPEECH_HOLD;
      this.renderedAmplitude += (target - this.renderedAmplitude) * Math.min(1, delta * SPEECH_ATTACK);
      return;
    }

    if (target < this.renderedAmplitude) {
      if (this.state === 'speaking' && this.speechHoldRemaining > 0) {
        this.speechHoldRemaining = Math.max(0, this.speechHoldRemaining - delta);
        const holdFloor = Math.max(target, this.renderedAmplitude * 0.84);
        this.renderedAmplitude += (holdFloor - this.renderedAmplitude) * Math.min(1, delta * SPEECH_RELEASE);
        return;
      }

      const releaseRate = this.state === 'speaking' ? SPEECH_RELEASE : SPEECH_IDLE_RELEASE;
      this.renderedAmplitude += (target - this.renderedAmplitude) * Math.min(1, delta * releaseRate);
      return;
    }

    this.renderedAmplitude = target;
  }

  update(delta: number): void {
    this.elapsed += delta;
    const t = this.elapsed;
    const hg = this.avatar.headGroup;
    const ii = this.idleIntensity;

    this.updateSpeechEnvelope(delta);

    if (this.timeSinceVisemeFrame >= 0) {
      this.timeSinceVisemeFrame += delta;
      if (this.timeSinceVisemeFrame > VISEME_TIMEOUT) {
        this.visemeActive = false;
        this.timeSinceVisemeFrame = -1;
        this.avatar.clearVisemes?.();
        this.renderedAmplitude = Math.max(this.renderedAmplitude, this.lastVisemeAmplitude * 0.9);
      }
    }

    if (!this.visemeActive) {
      this.avatar.setMouthAmplitude(this.renderedAmplitude);
    }

    switch (this.state) {
      case 'idle':
        hg.position.y = Math.sin(t * 0.75) * 0.012 * ii;
        hg.rotation.x = 0;
        hg.rotation.z = Math.sin(t * 0.28) * 0.018 * ii;
        this.blink.update(delta, this.resolveBlinkMode('normal'));
        break;

      case 'listening':
        hg.position.y = Math.sin(t * 1.1) * 0.008 * ii;
        hg.rotation.x = (-0.07 + Math.sin(t * 0.55) * 0.018) * ii;
        hg.rotation.z = Math.sin(t * 1.4) * 0.012 * ii;
        this.blink.update(delta, this.resolveBlinkMode('fast'));
        break;

      case 'thinking':
        hg.position.y = Math.sin(t * 0.35) * 0.008 * ii;
        hg.rotation.x = Math.sin(t * 0.42) * 0.04 * ii;
        hg.rotation.z = Math.sin(t * 0.48) * 0.13;
        this.blink.update(delta, this.resolveBlinkMode('normal'));
        break;

      case 'speaking': {
        const amp = this.renderedAmplitude;
        hg.position.y = Math.sin(t * 5.5) * 0.007 * (0.4 + amp);
        hg.rotation.x = Math.sin(t * 3.8) * 0.015 * (0.3 + amp);
        hg.rotation.z = Math.sin(t * 2.1) * 0.01 * ii;
        this.blink.update(delta, this.resolveBlinkMode('fast'));
        break;
      }

      case 'error':
      case 'disconnected':
        hg.position.y += (0 - hg.position.y) * Math.min(1, delta * 5);
        hg.rotation.x += (0 - hg.rotation.x) * Math.min(1, delta * 5);
        hg.rotation.z += (0 - hg.rotation.z) * Math.min(1, delta * 5);
        break;
    }
  }
}
