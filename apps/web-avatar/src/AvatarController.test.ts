import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const mocks = vi.hoisted(() => {
  function createDeferred<T>(): Deferred<T> {
    let resolve!: Deferred<T>['resolve'];
    let reject!: Deferred<T>['reject'];
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  const sceneInstances: MockSceneManager[] = [];
  const proceduralMeshes: MockAvatarMesh[] = [];
  const gltfMeshes: MockGltfAvatarMesh[] = [];
  const animationControllers: MockThreeAnimationController[] = [];
  const amplitudeAnalyzers: MockAmplitudeAnalyzer[] = [];

  class MockSceneManager {
    readonly scene = {
      add: vi.fn(),
      remove: vi.fn(),
    };

    readonly start = vi.fn();
    readonly destroy = vi.fn();
    readonly setBackgroundColor = vi.fn();
    readonly setCameraPreset = vi.fn();
    readonly setEnvironmentPreset = vi.fn();

    constructor(_container: HTMLElement) {
      sceneInstances.push(this);
    }
  }

  class MockAvatarMesh {
    readonly group = { id: Symbol('group') };
    readonly headGroup = { position: { y: 0 }, rotation: { x: 0, z: 0 } };
    readonly eyeL = { scale: { y: 1 } };
    readonly eyeR = { scale: { y: 1 } };
    readonly setMouthAmplitude = vi.fn();
    readonly setViseme = vi.fn();
    readonly setSkinColor = vi.fn();
    readonly setHeadColor = vi.fn();
    readonly resetHeadColor = vi.fn();
    readonly dispose = vi.fn();
  }

  class MockProceduralAvatarMesh extends MockAvatarMesh {
    constructor() {
      super();
      proceduralMeshes.push(this);
    }
  }

  class MockGltfAvatarMesh extends MockAvatarMesh {
    readonly load = vi.fn((url: string) => {
      this.lastUrl = url;
      this.deferred = createDeferred<void>();
      return this.deferred.promise;
    });

    deferred: Deferred<void> | null = null;
    lastUrl: string | null = null;

    constructor() {
      super();
      gltfMeshes.push(this);
    }
  }

  class MockThreeAnimationController {
    readonly onExitState = vi.fn();
    readonly onEnterState = vi.fn();
    readonly setAvatarMesh = vi.fn();
    readonly setMouthAmplitude = vi.fn();
    readonly applyVisemeFrame = vi.fn();
    readonly update = vi.fn();
    readonly setIdleIntensity = vi.fn();
    readonly setBlinkFrequency = vi.fn();

    constructor(_avatar: MockAvatarMesh) {
      animationControllers.push(this);
    }
  }

  class MockAmplitudeAnalyzer {
    readonly disconnect = vi.fn();
    readonly connect = vi.fn();
    readonly getAmplitude = vi.fn(() => 0);
    readonly isConnected = false;

    constructor() {
      amplitudeAnalyzers.push(this);
    }
  }

  return {
    sceneInstances,
    proceduralMeshes,
    gltfMeshes,
    animationControllers,
    amplitudeAnalyzers,
    MockSceneManager,
    MockProceduralAvatarMesh,
    MockGltfAvatarMesh,
    MockThreeAnimationController,
    MockAmplitudeAnalyzer,
  };
});

vi.mock('./three/scene.js', () => ({
  SceneManager: mocks.MockSceneManager,
}));

vi.mock('./three/avatarMesh.js', () => ({
  ProceduralAvatarMesh: mocks.MockProceduralAvatarMesh,
  GltfAvatarMesh: mocks.MockGltfAvatarMesh,
}));

vi.mock('./three/threeAnimationController.js', () => ({
  ThreeAnimationController: mocks.MockThreeAnimationController,
}));

vi.mock('./audio/amplitudeAnalyzer.js', () => ({
  AmplitudeAnalyzer: mocks.MockAmplitudeAnalyzer,
}));

import { AvatarController } from './AvatarController.js';

const originalAudio = globalThis.Audio;

describe('AvatarController model hot-swap', () => {
  beforeEach(() => {
    mocks.sceneInstances.length = 0;
    mocks.proceduralMeshes.length = 0;
    mocks.gltfMeshes.length = 0;
    mocks.animationControllers.length = 0;
    mocks.amplitudeAnalyzers.length = 0;
    vi.clearAllMocks();
    class MockAudio {
      src = '';
      crossOrigin = '';
      play = vi.fn(() => Promise.resolve());
      pause = vi.fn();
    }
    globalThis.Audio = MockAudio as unknown as typeof Audio;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.Audio = originalAudio;
  });

  it('ignores stale async model completions when a newer request wins', async () => {
    const controller = new AvatarController({} as HTMLElement);
    const scene = mocks.sceneInstances[0]!;
    const initialAvatar = mocks.proceduralMeshes[0]!;

    const olderRequest = controller.setAvatarModel('gltf', 'old.glb');
    const newerRequest = controller.setAvatarModel('procedural');
    const replacementAvatar = mocks.proceduralMeshes[1]!;

    expect(mocks.gltfMeshes[0]?.lastUrl).toBe('old.glb');

    mocks.gltfMeshes[0]!.deferred!.resolve();
    await Promise.all([olderRequest, newerRequest]);

    expect(mocks.animationControllers[0]!.setAvatarMesh).toHaveBeenCalledTimes(1);
    expect(mocks.animationControllers[0]!.setAvatarMesh).toHaveBeenCalledWith(replacementAvatar);
    expect(scene.scene.remove).toHaveBeenCalledWith(initialAvatar.group);
    expect(scene.scene.add).toHaveBeenNthCalledWith(1, initialAvatar.group);
    expect(scene.scene.add).toHaveBeenNthCalledWith(2, replacementAvatar.group);
    expect(initialAvatar.dispose).toHaveBeenCalledTimes(1);
    expect(mocks.gltfMeshes[0]!.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not attach a stale async model after destroy', async () => {
    const controller = new AvatarController({} as HTMLElement);
    const scene = mocks.sceneInstances[0]!;

    const pendingRequest = controller.setAvatarModel('gltf', 'late.glb');
    controller.destroy();

    mocks.gltfMeshes[0]!.deferred!.resolve();
    await pendingRequest;

    expect(scene.destroy).toHaveBeenCalledTimes(1);
    expect(mocks.animationControllers[0]!.setAvatarMesh).not.toHaveBeenCalled();
    expect(scene.scene.add).toHaveBeenCalledTimes(1);
    expect(mocks.gltfMeshes[0]!.dispose).toHaveBeenCalledTimes(1);
  });

  it('disposes the active avatar when destroyed', () => {
    const controller = new AvatarController({} as HTMLElement);
    const scene = mocks.sceneInstances[0]!;
    const currentAvatar = mocks.proceduralMeshes[0]!;

    controller.destroy();

    expect(scene.scene.remove).toHaveBeenCalledWith(currentAvatar.group);
    expect(currentAvatar.dispose).toHaveBeenCalledTimes(1);
  });

  it('does not run audio or viseme side effects for invalid events while disconnected', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const controller = new AvatarController({} as HTMLElement);
    const animation = mocks.animationControllers[0]!;
    const analyzer = mocks.amplitudeAnalyzers[0]!;

    controller.dispatch({ type: 'speech_start', audioUrl: 'https://example.com/audio.mp3' });
    controller.dispatch({
      type: 'viseme_frame',
      timestamp: 0,
      visemes: [{ viseme: 'aa', weight: 1 }],
    });
    controller.dispatch({ type: 'speech_chunk', text: 'hello', amplitude: 0.5 });

    expect(analyzer.connect).not.toHaveBeenCalled();
    expect(analyzer.disconnect).not.toHaveBeenCalled();
    expect(animation.applyVisemeFrame).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
