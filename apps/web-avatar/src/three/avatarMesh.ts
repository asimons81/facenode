import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ── Public interface ──────────────────────────────────────────────────────────

/**
 * Common interface for all avatar mesh implementations.
 * The ThreeAnimationController works against this interface so that
 * swapping between procedural and glTF meshes requires no changes
 * to animation or scene code.
 */
export interface AvatarMesh {
  /** Root group — add to and remove from the scene. */
  readonly group: THREE.Group;
  /** Sub-group for head rotations and positional bobbing. */
  readonly headGroup: THREE.Group;
  /** Left eye blink proxy — scale.y: 1 = open, 0 = closed. */
  readonly eyeL: { scale: { y: number } };
  /** Right eye blink proxy — scale.y: 1 = open, 0 = closed. */
  readonly eyeR: { scale: { y: number } };

  setMouthAmplitude(value: number): void;
  setViseme(viseme: string, weight: number): void;
  beginVisemeFrame?(): void;
  flushVisemeFrame?(): void;
  setSkinColor(hex: string): void;
  setHeadColor(color: THREE.ColorRepresentation): void;
  resetHeadColor(): void;
  /** Called by ThreeAnimationController when the avatar state changes. */
  onEnterState?(state: string): void;
  dispose(): void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EYE_COLOR = new THREE.Color(0x111111);
const MOUTH_COLOR = new THREE.Color(0x200c0a);

// Mouth openness values per OVR viseme (0 = closed, 1 = fully open)
const VISEME_OPENNESS: Record<string, number> = {
  sil: 0.0, PP: 0.05, FF: 0.1, TH: 0.15,
  DD: 0.3,  kk: 0.3,  CH: 0.35, SS: 0.2,
  nn: 0.25, RR: 0.4,  aa: 1.0, E: 0.65,
  ih: 0.55, oh: 0.85, ou: 0.7,
};

function lambert(color: THREE.Color): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color });
}

// ── ProceduralAvatarMesh ──────────────────────────────────────────────────────

/**
 * Procedural placeholder avatar head built from Three.js primitives.
 *
 * Geometry:
 *   - Head:  SphereGeometry scaled into a slightly oval shape
 *   - Neck:  CylinderGeometry
 *   - Eyes:  two small dark spheres (blink via scale.y)
 *   - Mouth: flat ellipse with a morph target (closed → open)
 */
export class ProceduralAvatarMesh implements AvatarMesh {
  readonly group: THREE.Group;
  readonly headGroup: THREE.Group;
  readonly eyeL: THREE.Mesh;
  readonly eyeR: THREE.Mesh;

  private readonly headMesh: THREE.Mesh;
  private readonly neckMesh: THREE.Mesh;
  private readonly mouthMesh: THREE.Mesh;
  private readonly eyeGeometry: THREE.SphereGeometry;
  private readonly headMaterial: THREE.MeshLambertMaterial;
  private readonly neckMaterial: THREE.MeshLambertMaterial;
  private readonly eyeMaterial: THREE.MeshLambertMaterial;
  private readonly skinColor = new THREE.Color(0xc8956a);

  // Accumulated viseme openness between applyVisemeFrame() calls
  private visemeOpenness = 0;

  constructor() {
    this.group = new THREE.Group();
    this.headGroup = new THREE.Group();
    this.group.add(this.headGroup);

    // Head
    this.headMaterial = lambert(this.skinColor.clone());
    const headGeo = new THREE.SphereGeometry(0.5, 32, 24);
    this.headMesh = new THREE.Mesh(headGeo, this.headMaterial);
    this.headMesh.scale.set(1, 1.12, 0.92);
    this.headGroup.add(this.headMesh);

    // Neck
    const neckGeo = new THREE.CylinderGeometry(0.17, 0.21, 0.42, 16);
    this.neckMaterial = lambert(this.skinColor.clone());
    this.neckMesh = new THREE.Mesh(neckGeo, this.neckMaterial);
    this.neckMesh.position.set(0, -0.64, 0);
    this.group.add(this.neckMesh);

    // Eyes
    this.eyeGeometry = new THREE.SphereGeometry(0.07, 12, 8);
    this.eyeMaterial = lambert(EYE_COLOR.clone());
    this.eyeL = new THREE.Mesh(this.eyeGeometry, this.eyeMaterial);
    this.eyeL.position.set(-0.18, 0.14, 0.44);
    this.eyeR = new THREE.Mesh(this.eyeGeometry, this.eyeMaterial);
    this.eyeR.position.set(0.18, 0.14, 0.44);
    this.headGroup.add(this.eyeL, this.eyeR);

    // Mouth
    this.mouthMesh = this.buildMouth();
    this.mouthMesh.position.set(0, -0.18, 0.47);
    this.headGroup.add(this.mouthMesh);
  }

  private buildMouth(): THREE.Mesh {
    const segments = 20;
    const geo = new THREE.CircleGeometry(1, segments);
    const posAttr = geo.attributes['position'] as THREE.BufferAttribute;
    const count = posAttr.count;

    for (let i = 0; i < count; i++) {
      posAttr.setX(i, posAttr.getX(i) * 0.065);
      posAttr.setY(i, posAttr.getY(i) * 0.013);
    }
    posAttr.needsUpdate = true;

    const openArr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      openArr[i * 3] = x;
      openArr[i * 3 + 1] = y * 4.2;
      openArr[i * 3 + 2] = -Math.abs(y) * 0.3;
    }
    geo.morphAttributes['position'] = [new THREE.BufferAttribute(openArr, 3)];
    geo.computeBoundingSphere();

    const mat = new THREE.MeshLambertMaterial({ color: MOUTH_COLOR, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.morphTargetInfluences = [0];
    return mesh;
  }

  setMouthAmplitude(value: number): void {
    if (this.mouthMesh.morphTargetInfluences) {
      this.mouthMesh.morphTargetInfluences[0] = Math.max(0, Math.min(1, value));
    }
  }

  setViseme(viseme: string, weight: number): void {
    const openness = VISEME_OPENNESS[viseme] ?? 0.3;
    this.visemeOpenness += openness * weight;
  }

  beginVisemeFrame(): void {
    this.visemeOpenness = 0;
  }

  /** Call after all setViseme() calls for a frame to flush the accumulated value. */
  flushVisemeFrame(): void {
    this.setMouthAmplitude(Math.min(1, this.visemeOpenness));
    this.visemeOpenness = 0;
  }

  setSkinColor(hex: string): void {
    this.skinColor.set(hex);
    this.headMaterial.color.copy(this.skinColor);
    this.neckMaterial.color.copy(this.skinColor);
  }

  setHeadColor(color: THREE.ColorRepresentation): void {
    this.headMaterial.color.set(color);
  }

  resetHeadColor(): void {
    this.headMaterial.color.copy(this.skinColor);
  }

  dispose(): void {
    this.headMesh.geometry.dispose();
    this.neckMesh.geometry.dispose();
    this.mouthMesh.geometry.dispose();
    (this.mouthMesh.material as THREE.Material).dispose();
    this.eyeGeometry.dispose();
    this.headMaterial.dispose();
    this.neckMaterial.dispose();
    this.eyeMaterial.dispose();
  }
}

// ── GltfAvatarMesh ────────────────────────────────────────────────────────────

/**
 * glTF-based avatar mesh.
 *
 * Prefers per-viseme morph targets named `viseme_*` for lip sync.
 * If no viseme morph target is available for a frame, falls back to a
 * mouth-open morph target named `mouthOpen` (or `jawOpen` / `Jaw_Open`).
 * Eye blink is driven via morph targets named `eyeBlinkLeft` / `eyeBlinkRight`
 * (Ready Player Me / VRM naming).
 *
 * If a morph target isn't found the operation is silently skipped.
 * On load failure, `load()` rejects so `AvatarController.setAvatarModel()`
 * can catch and fall back to ProceduralAvatarMesh.
 */
export class GltfAvatarMesh implements AvatarMesh {
  readonly group: THREE.Group;
  readonly headGroup: THREE.Group;
  readonly eyeL: { scale: { y: number } };
  readonly eyeR: { scale: { y: number } };

  private mouthMesh: THREE.Mesh | null = null;
  private mouthMorphIndex = -1;
  private eyeLMesh: THREE.Mesh | null = null;
  private eyeRMesh: THREE.Mesh | null = null;
  private eyeLMorphIndex = -1;
  private eyeRMorphIndex = -1;
  private visemeFrameOpenness = 0;
  private visemeFrameMatchedTarget = false;
  private readonly activeVisemeMorphIndices = new Set<number>();

  constructor() {
    this.group = new THREE.Group();
    this.headGroup = this.group; // for glTF, the root IS the head group

    // Proxy objects: setting scale.y → drives blink morph target
    const self = this;
    this.eyeL = {
      scale: {
        get y(): number {
          if (self.eyeLMesh?.morphTargetInfluences && self.eyeLMorphIndex >= 0) {
            return 1 - (self.eyeLMesh.morphTargetInfluences[self.eyeLMorphIndex] ?? 0);
          }
          return 1;
        },
        set y(v: number) {
          if (self.eyeLMesh?.morphTargetInfluences && self.eyeLMorphIndex >= 0) {
            self.eyeLMesh.morphTargetInfluences[self.eyeLMorphIndex] = 1 - v;
          }
        },
      },
    };
    this.eyeR = {
      scale: {
        get y(): number {
          if (self.eyeRMesh?.morphTargetInfluences && self.eyeRMorphIndex >= 0) {
            return 1 - (self.eyeRMesh.morphTargetInfluences[self.eyeRMorphIndex] ?? 0);
          }
          return 1;
        },
        set y(v: number) {
          if (self.eyeRMesh?.morphTargetInfluences && self.eyeRMorphIndex >= 0) {
            self.eyeRMesh.morphTargetInfluences[self.eyeRMorphIndex] = 1 - v;
          }
        },
      },
    };
  }

  /** Load and initialise a glTF model from the given URL. Rejects on error. */
  async load(url: string): Promise<void> {
    const loader = new GLTFLoader();
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      loader.load(url, resolve, undefined, reject);
    });

    this.group.add(gltf.scene);

    // Walk the scene looking for skinned/regular meshes with morph targets
    gltf.scene.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || !obj.morphTargetDictionary) return;

      const dict = obj.morphTargetDictionary;

      // Mouth
      if (this.mouthMesh === null) {
        const idx = dict['mouthOpen'] ?? dict['jawOpen'] ?? dict['Jaw_Open'] ?? dict['viseme_aa'];
        if (idx !== undefined) {
          this.mouthMesh = obj;
          this.mouthMorphIndex = idx;
        }
      }

      // Eye blink (left)
      if (this.eyeLMesh === null) {
        const idx = dict['eyeBlinkLeft'] ?? dict['Eye_Blink_Left'] ?? dict['leftEyeBlink'];
        if (idx !== undefined) {
          this.eyeLMesh = obj;
          this.eyeLMorphIndex = idx;
        }
      }

      // Eye blink (right)
      if (this.eyeRMesh === null) {
        const idx = dict['eyeBlinkRight'] ?? dict['Eye_Blink_Right'] ?? dict['rightEyeBlink'];
        if (idx !== undefined) {
          this.eyeRMesh = obj;
          this.eyeRMorphIndex = idx;
        }
      }
    });

    if (this.mouthMesh === null) {
      console.warn('[GltfAvatarMesh] No mouth morph target found — lip sync will be inactive.');
    }
    if (this.eyeLMesh === null || this.eyeRMesh === null) {
      console.warn('[GltfAvatarMesh] Eye blink morph targets not found — blink animation inactive.');
    }
  }

  setMouthAmplitude(value: number): void {
    if (this.mouthMesh?.morphTargetInfluences && this.mouthMorphIndex >= 0) {
      this.mouthMesh.morphTargetInfluences[this.mouthMorphIndex] = Math.max(0, Math.min(1, value));
    }
  }

  beginVisemeFrame(): void {
    this.visemeFrameOpenness = 0;
    this.visemeFrameMatchedTarget = false;

    if (!this.mouthMesh?.morphTargetInfluences) return;

    if (this.mouthMorphIndex >= 0) {
      this.mouthMesh.morphTargetInfluences[this.mouthMorphIndex] = 0;
    }

    for (const idx of this.activeVisemeMorphIndices) {
      this.mouthMesh.morphTargetInfluences[idx] = 0;
    }
    this.activeVisemeMorphIndices.clear();
  }

  setViseme(viseme: string, weight: number): void {
    const openness = VISEME_OPENNESS[viseme] ?? 0.3;
    this.visemeFrameOpenness += openness * weight;

    if (!this.mouthMesh?.morphTargetDictionary || !this.mouthMesh.morphTargetInfluences) return;
    const idx = this.mouthMesh.morphTargetDictionary[`viseme_${viseme}`];
    if (idx !== undefined) {
      this.mouthMesh.morphTargetInfluences[idx] = Math.max(0, Math.min(1, weight));
      this.activeVisemeMorphIndices.add(idx);
      this.visemeFrameMatchedTarget = true;
    }
  }

  flushVisemeFrame(): void {
    if (
      !this.visemeFrameMatchedTarget &&
      this.mouthMesh?.morphTargetInfluences &&
      this.mouthMorphIndex >= 0
    ) {
      this.setMouthAmplitude(Math.min(1, this.visemeFrameOpenness));
    }

    this.visemeFrameOpenness = 0;
    this.visemeFrameMatchedTarget = false;
  }

  setSkinColor(_hex: string): void {
    console.warn('[GltfAvatarMesh] setSkinColor() is not supported — skin color is baked into the glTF material.');
  }

  setHeadColor(_color: THREE.ColorRepresentation): void {
    // no-op — glTF models don't support runtime color tinting here
  }

  resetHeadColor(): void {
    // no-op
  }

  dispose(): void {
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();

    this.group.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m: THREE.Material) => materials.add(m));
        } else {
          materials.add(obj.material as THREE.Material);
        }
      }
    });

    for (const material of materials) {
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value instanceof THREE.Texture) {
          textures.add(value);
        }
      }
    }

    for (const texture of textures) {
      texture.dispose();
    }

    for (const material of materials) {
      material.dispose();
    }
  }
}
