import { AvatarStateMachine } from '@facenode/avatar-core';
import type { AvatarEvent, AvatarState } from '@facenode/avatar-core';
import type { CameraPreset, EnvironmentPreset } from './three/scene.js';
import { SceneManager } from './three/scene.js';
import { ProceduralAvatarMesh, GltfAvatarMesh } from './three/avatarMesh.js';
import type { AvatarMesh } from './three/avatarMesh.js';
import { ThreeAnimationController } from './three/threeAnimationController.js';
import { AmplitudeAnalyzer } from './audio/amplitudeAnalyzer.js';

type EventListener = (event: AvatarEvent) => void;
type StateChangeListener = (next: AvatarState, prev: AvatarState) => void;

/**
 * Top-level controller. Owns all subsystems and wires them together.
 *
 * Public surface:
 *   dispatch(event)          — feed an AvatarEvent into the state machine
 *   setAudioSource(el)       — connect an HTMLAudioElement for real-time lip sync
 *   onStateChange(cb)        — subscribe to state transitions
 *   onEvent(cb)              — subscribe to dispatched events (e.g. for captions)
 *   currentState             — read the current AvatarState
 *   destroy()                — stop render loop, release GPU and audio resources
 *
 *   Config setters (all hot-apply to the live scene):
 *   setSkinColor / setBackgroundColor / setIdleIntensity / setBlinkFrequency /
 *   setSpeakingSensitivity / setCameraPreset / setEnvironmentPreset /
 *   setAvatarModel
 */
export class AvatarController {
  private readonly machine: AvatarStateMachine;
  private readonly scene: SceneManager;
  private avatar: AvatarMesh;
  private readonly animController: ThreeAnimationController;
  private readonly analyzer: AmplitudeAnalyzer;

  private readonly eventListeners = new Set<EventListener>();
  private readonly stateListeners = new Set<StateChangeListener>();

  // Simulated amplitude clock
  private simTime = 0;
  private lastEventAmplitude = 0;

  // TTS audio element — set when a speech_start event carries an audioUrl
  private ttsAudio: HTMLAudioElement | null = null;

  // Config state for re-application after mesh hot-swap
  private speakingSensitivity = 0.7;
  private currentSkinColor = '#c8956a';
  private avatarModelRequestId = 0;
  private destroyed = false;

  constructor(container: HTMLElement) {
    this.machine = new AvatarStateMachine('disconnected');
    this.scene = new SceneManager(container);
    this.avatar = new ProceduralAvatarMesh();
    this.animController = new ThreeAnimationController(this.avatar);
    this.analyzer = new AmplitudeAnalyzer();

    this.scene.scene.add(this.avatar.group);

    this.machine.onChange((next, prev) => {
      this.animController.onExitState(prev);
      this.animController.onEnterState(next);
      this.stateListeners.forEach((cb) => cb(next, prev));
    });

    this.animController.onEnterState(this.machine.current);
    this.scene.start((delta) => this.tick(delta));
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private tick(delta: number): void {
    this.simTime += delta;

    let amplitude = 0;
    if (this.machine.current === 'speaking') {
      if (this.analyzer.isConnected) {
        amplitude = this.analyzer.getAmplitude() * this.speakingSensitivity;
      } else {
        const base = this.lastEventAmplitude > 0 ? this.lastEventAmplitude : 0.5;
        amplitude = base * this.speakingSensitivity *
          (0.6 + Math.sin(this.simTime * 8.5) * 0.4) *
          (0.85 + Math.sin(this.simTime * 2.3) * 0.15);
      }
    } else {
      this.lastEventAmplitude = 0;
    }

    this.animController.setMouthAmplitude(amplitude);
    this.animController.update(delta);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  get currentState(): AvatarState {
    return this.machine.current;
  }

  dispatch(event: AvatarEvent): void {
    const prevState = this.machine.current;
    const nextState = this.machine.transition(event);

    if (event.type === 'speech_chunk' && prevState === 'speaking' && event.amplitude !== undefined) {
      this.lastEventAmplitude = event.amplitude;
    }

    if (event.type === 'viseme_frame' && prevState === 'speaking') {
      this.animController.applyVisemeFrame(event);
    }

    // TTS audio playback — triggered by Hermes TTS relay via speech_start audioUrl
    if (event.type === 'speech_start' && prevState !== 'speaking' && nextState === 'speaking' && event.audioUrl) {
      this.ttsAudio?.pause();
      this.ttsAudio = null;
      this.analyzer.disconnect();

      const audio = new Audio();
      audio.src = event.audioUrl;
      audio.crossOrigin = 'anonymous';
      audio.play().catch((err) => {
        console.warn('[AvatarController] TTS audio play failed:', err);
      });
      this.ttsAudio = audio;
      this.analyzer.connect(audio);
    }

    if (event.type === 'speech_end' && prevState === 'speaking' && nextState === 'idle') {
      this.ttsAudio?.pause();
      this.ttsAudio = null;
      this.analyzer.disconnect();
    }

    this.eventListeners.forEach((cb) => cb(event));
  }

  setAudioSource(el: HTMLAudioElement): void {
    this.analyzer.connect(el);
  }

  onStateChange(cb: StateChangeListener): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  onEvent(cb: EventListener): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  // ── Config setters ────────────────────────────────────────────────────────

  setSkinColor(hex: string): void {
    this.currentSkinColor = hex;
    this.avatar.setSkinColor(hex);
  }

  setBackgroundColor(hex: string): void {
    this.scene.setBackgroundColor(hex);
  }

  setIdleIntensity(value: number): void {
    this.animController.setIdleIntensity(value);
  }

  setBlinkFrequency(freq: 'slow' | 'normal' | 'fast'): void {
    this.animController.setBlinkFrequency(freq);
  }

  setSpeakingSensitivity(value: number): void {
    this.speakingSensitivity = Math.max(0, Math.min(1, value));
  }

  setCameraPreset(preset: CameraPreset): void {
    this.scene.setCameraPreset(preset);
  }

  setEnvironmentPreset(preset: EnvironmentPreset): void {
    this.scene.setEnvironmentPreset(preset);
  }

  /**
   * Hot-swap the avatar mesh. For glTF, loads the model from `url`.
   * On load failure, automatically falls back to the procedural mesh.
   */
  async setAvatarModel(model: 'procedural' | 'gltf', url?: string): Promise<void> {
    if (this.destroyed) return;

    const requestId = ++this.avatarModelRequestId;

    let newMesh: AvatarMesh;

    if (model === 'gltf' && url) {
      const gltfMesh = new GltfAvatarMesh();
      try {
        await gltfMesh.load(url);
        newMesh = gltfMesh;
      } catch (err) {
        console.error('[AvatarController] glTF load failed — falling back to procedural:', err);
        gltfMesh.dispose();
        newMesh = new ProceduralAvatarMesh();
      }
    } else {
      newMesh = new ProceduralAvatarMesh();
    }

    if (this.destroyed || requestId !== this.avatarModelRequestId) {
      newMesh.dispose();
      return;
    }

    const previousAvatar = this.avatar;
    this.avatar = newMesh;
    this.animController.setAvatarMesh(newMesh);
    this.scene.scene.remove(previousAvatar.group);
    previousAvatar.dispose();
    this.scene.scene.add(newMesh.group);

    // Re-apply config that's mesh-specific
    newMesh.setSkinColor(this.currentSkinColor);
  }

  /** Stop render loop and release all resources. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.avatarModelRequestId += 1;
    this.ttsAudio?.pause();
    this.ttsAudio = null;
    this.analyzer.disconnect();
    this.scene.scene.remove(this.avatar.group);
    this.avatar.dispose();
    this.scene.destroy();
  }
}
