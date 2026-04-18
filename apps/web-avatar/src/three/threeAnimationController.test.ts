import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ThreeAnimationController } from './threeAnimationController.js';
import type { AvatarMesh } from './avatarMesh.js';

interface MockState {
  mouthAmplitude: number;
  visemes: Map<string, number>;
  headColor: number | string | null;
  isReset: boolean;
}

function makeMockMesh(): AvatarMesh & { state: MockState } {
  const state: MockState = {
    mouthAmplitude: 0,
    visemes: new Map(),
    headColor: null,
    isReset: true,
  };

  return {
    state,
    group: new THREE.Group(),
    headGroup: new THREE.Group(),
    eyeL: { scale: { y: 1 } },
    eyeR: { scale: { y: 1 } },
    setMouthAmplitude(value: number) {
      state.mouthAmplitude = value;
    },
    beginVisemeFrame() {
      state.visemes.clear();
    },
    setViseme(viseme: string, weight: number) {
      state.visemes.set(viseme, weight);
    },
    flushVisemeFrame() {
      const openness: Record<string, number> = {
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

      let total = 0;
      for (const [viseme, weight] of state.visemes) {
        total += (openness[viseme] ?? 0.3) * weight;
      }

      state.mouthAmplitude = Math.min(1, total);
      state.visemes.clear();
    },
    clearVisemes() {
      state.visemes.clear();
    },
    setSkinColor() {},
    setHeadColor(color) {
      state.headColor = color as string;
      state.isReset = false;
    },
    resetHeadColor() {
      state.isReset = true;
    },
    dispose() {},
  } as AvatarMesh & { state: MockState };
}

describe('ThreeAnimationController viseme pipeline', () => {
  let mesh: ReturnType<typeof makeMockMesh>;
  let ctrl: ThreeAnimationController;

  beforeEach(() => {
    mesh = makeMockMesh();
    ctrl = new ThreeAnimationController(mesh);
    ctrl.onEnterState('speaking');
  });

  it('suppresses Layer 1 while a viseme frame is active', () => {
    ctrl.applyVisemeFrame({ timestamp: 0, visemes: [{ viseme: 'aa', weight: 1 }] });
    ctrl.setMouthAmplitude(0.2);
    expect(mesh.state.mouthAmplitude).toBe(1);
  });

  it('resumes Layer 1 after the viseme timeout with a shaped mouth target', () => {
    ctrl.applyVisemeFrame({ timestamp: 0, visemes: [{ viseme: 'sil', weight: 1 }] });
    ctrl.setMouthAmplitude(0.8);

    ctrl.update(0.05);
    expect(mesh.state.mouthAmplitude).toBe(0);

    ctrl.update(0.14);
    expect(mesh.state.mouthAmplitude).toBeGreaterThan(0.7);
    expect(mesh.state.mouthAmplitude).toBeLessThanOrEqual(1);
  });

  it('resets the timeout when a new viseme frame arrives', () => {
    ctrl.applyVisemeFrame({ timestamp: 0, visemes: [{ viseme: 'sil', weight: 1 }] });
    ctrl.update(0.08);
    ctrl.applyVisemeFrame({ timestamp: 80, visemes: [{ viseme: 'aa', weight: 1 }] });
    ctrl.update(0.08);
    ctrl.setMouthAmplitude(0.2);

    expect(mesh.state.mouthAmplitude).toBe(1);
  });

  it('holds and releases speech amplitude instead of snapping shut immediately', () => {
    ctrl.setMouthAmplitude(0.8);
    ctrl.update(0.05);
    const openAmplitude = mesh.state.mouthAmplitude;

    ctrl.setMouthAmplitude(0);
    ctrl.update(0.02);
    const heldAmplitude = mesh.state.mouthAmplitude;
    ctrl.update(0.18);
    const releasedAmplitude = mesh.state.mouthAmplitude;

    expect(openAmplitude).toBeGreaterThan(0.7);
    expect(heldAmplitude).toBeGreaterThan(0.45);
    expect(releasedAmplitude).toBeLessThan(heldAmplitude);
  });

  it('shapes Layer 1 amplitude even without visemes', () => {
    ctrl.setMouthAmplitude(0.6);
    ctrl.update(0.05);
    expect(mesh.state.mouthAmplitude).toBeGreaterThan(0.5);
    expect(mesh.state.mouthAmplitude).toBeLessThan(0.65);
  });
});

describe('ThreeAnimationController state handling', () => {
  it('rebinds blink targets on mesh hot-swap', () => {
    const mesh1 = makeMockMesh();
    const ctrl = new ThreeAnimationController(mesh1);
    ctrl.onEnterState('idle');

    const mesh2 = makeMockMesh();
    ctrl.setAvatarMesh(mesh2);

    for (let i = 0; i < 60; i++) {
      ctrl.update(1 / 60);
    }

    expect(mesh2.state.isReset).toBe(true);
    expect(mesh1.state.isReset).toBe(true);
  });

  it('sets the error head color', () => {
    const mesh = makeMockMesh();
    const ctrl = new ThreeAnimationController(mesh);
    ctrl.onEnterState('error');

    expect(mesh.state.isReset).toBe(false);
    expect(mesh.state.headColor).toBe(0xe05c5c);
  });

  it('updates safely in every avatar state', () => {
    const states = ['idle', 'listening', 'thinking', 'speaking', 'error', 'disconnected'] as const;

    for (const state of states) {
      const mesh = makeMockMesh();
      const ctrl = new ThreeAnimationController(mesh);
      ctrl.onEnterState(state);
      expect(() => ctrl.update(0.016)).not.toThrow();
    }
  });
});
