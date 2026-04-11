import { describe, it, expect, beforeEach } from 'vitest';
import * as THREE from 'three';
import { ThreeAnimationController } from './threeAnimationController.js';
import type { AvatarMesh } from './avatarMesh.js';

// ── Minimal AvatarMesh mock ───────────────────────────────────────────────────

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

  const headGroup = new THREE.Group();

  return {
    state,
    group: new THREE.Group(),
    headGroup,
    eyeL: { scale: { y: 1 } },
    eyeR: { scale: { y: 1 } },
    setMouthAmplitude(v: number) { state.mouthAmplitude = v; },
    beginVisemeFrame() {
      state.visemes.clear();
    },
    setViseme(viseme: string, weight: number) { state.visemes.set(viseme, weight); },
    flushVisemeFrame() {
      // Sum viseme openness into mouth amplitude (mirror ProceduralAvatarMesh logic)
      const OPENNESS: Record<string, number> = {
        sil: 0, PP: 0.05, FF: 0.1, TH: 0.15, DD: 0.3, kk: 0.3,
        CH: 0.35, SS: 0.2, nn: 0.25, RR: 0.4, aa: 1.0, E: 0.65,
        ih: 0.55, oh: 0.85, ou: 0.7,
      };
      let total = 0;
      for (const [v, w] of state.visemes) {
        total += (OPENNESS[v] ?? 0.3) * w;
      }
      state.mouthAmplitude = Math.min(1, total);
      state.visemes.clear();
    },
    setSkinColor() {},
    setHeadColor(c) { state.headColor = c as string; state.isReset = false; },
    resetHeadColor() { state.isReset = true; },
    dispose() {},
  } as AvatarMesh & { state: MockState; flushVisemeFrame: () => void };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ThreeAnimationController — viseme pipeline (Layer 2)', () => {
  let mesh: ReturnType<typeof makeMockMesh>;
  let ctrl: ThreeAnimationController;

  beforeEach(() => {
    mesh = makeMockMesh();
    ctrl = new ThreeAnimationController(mesh);
    ctrl.onEnterState('speaking');
  });

  it('applyVisemeFrame sets viseme mode active', () => {
    ctrl.applyVisemeFrame({ timestamp: 0, visemes: [{ viseme: 'aa', weight: 1 }] });
    // setMouthAmplitude should NOT update mouth directly while viseme mode is active
    ctrl.setMouthAmplitude(0.9);
    // The mouth amplitude remains from the viseme frame (aa = 1.0 openness)
    expect(mesh.state.mouthAmplitude).toBe(1); // set by flushVisemeFrame
  });

  it('Layer 1 amplitude is suppressed while viseme mode is active', () => {
    ctrl.applyVisemeFrame({ timestamp: 0, visemes: [{ viseme: 'sil', weight: 1 }] });
    // sil = 0 openness, so mouth should be nearly closed
    const mouthAfterViseme = mesh.state.mouthAmplitude; // 0 from sil

    ctrl.setMouthAmplitude(0.9); // Layer 1 tries to set high amplitude
    // Mouth should NOT be updated to 0.9 — viseme mode suppresses it
    expect(mesh.state.mouthAmplitude).toBe(mouthAfterViseme);
  });

  it('Layer 1 resumes after VISEME_TIMEOUT (>100ms) without new frame', () => {
    ctrl.applyVisemeFrame({ timestamp: 0, visemes: [{ viseme: 'sil', weight: 1 }] });
    ctrl.setMouthAmplitude(0.8);

    // Advance 50ms — still in viseme mode
    ctrl.update(0.05);
    expect(mesh.state.mouthAmplitude).toBe(0); // sil, not overridden by 0.8

    // Advance another 60ms (total 110ms > 100ms threshold)
    ctrl.update(0.06);

    // Layer 1 should have resumed — setMouthAmplitude(0.8) is now applied
    expect(mesh.state.mouthAmplitude).toBeCloseTo(0.8);
  });

  it('receiving a new viseme frame resets the timeout', () => {
    ctrl.applyVisemeFrame({ timestamp: 0, visemes: [{ viseme: 'sil', weight: 1 }] });

    // Advance 80ms — still within timeout
    ctrl.update(0.08);

    // Send another frame — resets timer
    ctrl.applyVisemeFrame({ timestamp: 80, visemes: [{ viseme: 'aa', weight: 1 }] });

    // Advance 80ms from new frame — still within timeout
    ctrl.update(0.08);
    ctrl.setMouthAmplitude(0.2);

    // aa frame drove mouth to 1.0, and viseme mode is still active
    // so Layer 1's 0.2 should NOT apply
    expect(mesh.state.mouthAmplitude).toBe(1); // from aa viseme
  });

  it('Layer 1 works normally when no viseme frame has been received', () => {
    ctrl.setMouthAmplitude(0.6);
    expect(mesh.state.mouthAmplitude).toBe(0.6);

    ctrl.setMouthAmplitude(0.3);
    expect(mesh.state.mouthAmplitude).toBe(0.3);
  });

  it('multiple viseme weights in a frame are all applied', () => {
    ctrl.applyVisemeFrame({
      timestamp: 0,
      visemes: [
        { viseme: 'oh', weight: 0.5 },  // 0.85 * 0.5 = 0.425
        { viseme: 'nn', weight: 0.5 },  // 0.25 * 0.5 = 0.125
      ],
    });
    // total = 0.55 — below 1
    expect(mesh.state.mouthAmplitude).toBeCloseTo(0.55);
  });

  it('replaces the previous viseme frame instead of carrying it forward', () => {
    ctrl.applyVisemeFrame({ timestamp: 0, visemes: [{ viseme: 'aa', weight: 1 }] });
    expect(mesh.state.mouthAmplitude).toBe(1);

    ctrl.applyVisemeFrame({ timestamp: 16, visemes: [{ viseme: 'sil', weight: 1 }] });
    expect(mesh.state.mouthAmplitude).toBe(0);
  });
});

describe('ThreeAnimationController — mesh hot-swap', () => {
  it('setAvatarMesh replaces the mesh and blinkController targets', () => {
    const mesh1 = makeMockMesh();
    const ctrl = new ThreeAnimationController(mesh1);
    ctrl.onEnterState('idle');

    const mesh2 = makeMockMesh();
    ctrl.setAvatarMesh(mesh2);

    // Blink should now operate on mesh2 eyes
    // Advance enough for a blink to potentially happen — just check no crash
    for (let i = 0; i < 60; i++) {
      ctrl.update(1 / 60);
    }

    // After setAvatarMesh, the idle state should have been re-entered,
    // resetting head color on the new mesh
    expect(mesh2.state.isReset).toBe(true);
    expect(mesh1.state.isReset).toBe(true); // old mesh not further modified
  });
});

describe('ThreeAnimationController — state animations', () => {
  it('error state sets head color', () => {
    const mesh = makeMockMesh();
    const ctrl = new ThreeAnimationController(mesh);
    ctrl.onEnterState('error');
    expect(mesh.state.isReset).toBe(false);
    expect(mesh.state.headColor).toBe(0xe05c5c);
  });

  it('idle state resets head color', () => {
    const mesh = makeMockMesh();
    const ctrl = new ThreeAnimationController(mesh);
    ctrl.onEnterState('error');
    ctrl.onEnterState('idle');
    expect(mesh.state.isReset).toBe(true);
  });

  it('update() does not throw for any state', () => {
    const states = ['idle', 'listening', 'thinking', 'speaking', 'error', 'disconnected'] as const;
    for (const state of states) {
      const mesh = makeMockMesh();
      const ctrl = new ThreeAnimationController(mesh);
      ctrl.onEnterState(state);
      expect(() => ctrl.update(0.016)).not.toThrow();
    }
  });
});
