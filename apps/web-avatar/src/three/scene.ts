import * as THREE from 'three';

export type CameraPreset = 'head' | 'bust' | 'wide';
export type EnvironmentPreset = 'none' | 'soft' | 'studio';

const CAMERA_CONFIGS: Record<CameraPreset, { pos: [number, number, number]; look: [number, number, number]; fov: number }> = {
  head:  { pos: [0, 0.22, 1.9],  look: [0, 0.12, 0], fov: 42 },
  bust:  { pos: [0, 0.15, 2.8],  look: [0, 0.05, 0], fov: 42 },
  wide:  { pos: [0, 0.0,  4.2],  look: [0, 0.0,  0], fov: 38 },
};

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly scene: THREE.Scene;

  private animationId: number | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly container: HTMLElement;
  private readonly ambientLight: THREE.AmbientLight;

  constructor(container: HTMLElement) {
    this.container = container;

    // Renderer — transparent so CSS background shows through
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);
    Object.assign(this.renderer.domElement.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
    });

    // Camera — default bust framing
    const { clientWidth: w, clientHeight: h } = container;
    const bust = CAMERA_CONFIGS.bust;
    this.camera = new THREE.PerspectiveCamera(bust.fov, w / h, 0.1, 50);
    this.camera.position.set(...bust.pos);
    this.camera.lookAt(...bust.look);

    // Scene
    this.scene = new THREE.Scene();

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
    const key = new THREE.DirectionalLight(0xfff4e0, 0.9);
    key.position.set(-1.5, 2.5, 2);
    const fill = new THREE.DirectionalLight(0xd0e8ff, 0.3);
    fill.position.set(2, 0.5, 1);
    this.scene.add(this.ambientLight, key, fill);

    // Resize observer
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.handleResize();
  }

  private handleResize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Start the render loop. `tick(delta)` is called every frame before render. */
  start(tick: (delta: number) => void): void {
    const clock = new THREE.Clock();
    const loop = (): void => {
      this.animationId = requestAnimationFrame(loop);
      const delta = Math.min(clock.getDelta(), 0.1);
      tick(delta);
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  stop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  destroy(): void {
    this.stop();
    this.resizeObserver.disconnect();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ── Config-driven setters ────────────────────────────────────────────────

  setBackgroundColor(color: string): void {
    this.scene.background = new THREE.Color(color);
  }

  setCameraPreset(preset: CameraPreset): void {
    const cfg = CAMERA_CONFIGS[preset];
    this.camera.position.set(...cfg.pos);
    this.camera.lookAt(...cfg.look);
    this.camera.fov = cfg.fov;
    this.camera.updateProjectionMatrix();
  }

  setEnvironmentPreset(preset: EnvironmentPreset): void {
    switch (preset) {
      case 'none':
        this.scene.fog = null;
        this.ambientLight.intensity = 0.55;
        break;
      case 'soft':
        this.scene.fog = new THREE.FogExp2(0x0a0a14, 0.06);
        this.ambientLight.intensity = 0.65;
        break;
      case 'studio':
        this.scene.fog = null;
        this.ambientLight.intensity = 0.85;
        break;
    }
  }
}
