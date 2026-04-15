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

const SCLERA_COLOR = new THREE.Color(0xe7f1ef);
const IRIS_COLOR = new THREE.Color(0x4fb7a0);
const PUPIL_COLOR = new THREE.Color(0x091215);
const BROW_COLOR = new THREE.Color(0x231915);
const HAIR_COLOR = new THREE.Color(0x2a1d18);
const MOUTH_COLOR = new THREE.Color(0x200c0a);
const CONTOUR_COLOR = new THREE.Color(0xa56f53);

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

type BlinkProxy = { scale: { y: number } };

type EyeRig = {
  root: THREE.Group;
  sclera: THREE.Mesh;
  iris: THREE.Mesh;
  pupil: THREE.Mesh;
  catchlight: THREE.Mesh;
  upperLid: THREE.Mesh;
  upperLidRidge: THREE.Mesh;
  lowerLidShadow: THREE.Mesh;
};

// ── ProceduralAvatarMesh ──────────────────────────────────────────────────────

/**
 * Procedural placeholder avatar head built from Three.js primitives.
 *
 * Geometry:
 *   - Head: stylized sphere with a slightly refined jaw and face profile
 *   - Neck: cylinder
 *   - Eyes: layered eye groups (sclera / iris / pupil) that still blink via scale.y
 *   - Face: brows, nose, ears, and a simple hair shell
 *   - Mouth: flat ellipse with a morph target (closed → open)
 */
export class ProceduralAvatarMesh implements AvatarMesh {
  readonly group: THREE.Group;
  readonly headGroup: THREE.Group;
  readonly eyeL: BlinkProxy;
  readonly eyeR: BlinkProxy;

  private readonly headMesh: THREE.Mesh;
  private readonly neckMesh: THREE.Mesh;
  private readonly mouthMesh: THREE.Mesh;
  private readonly skinMaterial: THREE.MeshLambertMaterial;
  private readonly contourMaterial: THREE.MeshLambertMaterial;
  private readonly skinColor = new THREE.Color(0xc8956a);
  private readonly eyeRigL: EyeRig;
  private readonly eyeRigR: EyeRig;

  // Accumulated viseme openness between applyVisemeFrame() calls
  private visemeOpenness = 0;

  constructor() {
    this.group = new THREE.Group();
    this.headGroup = new THREE.Group();
    this.group.add(this.headGroup);

    // Head
    this.skinMaterial = lambert(this.skinColor.clone());
    this.contourMaterial = lambert(CONTOUR_COLOR.clone());
    this.contourMaterial.color.copy(this.skinColor).multiplyScalar(0.84);
    const headGeo = this.buildHeadGeometry();
    this.headMesh = new THREE.Mesh(headGeo, this.skinMaterial);
    this.headMesh.name = 'head';
    this.headGroup.add(this.headMesh);

    // Neck
    const neckGeo = new THREE.CylinderGeometry(0.17, 0.21, 0.42, 16);
    this.neckMesh = new THREE.Mesh(neckGeo, this.skinMaterial);
    this.neckMesh.name = 'neck';
    this.neckMesh.position.set(0, -0.64, 0);
    this.group.add(this.neckMesh);

    // Eyes
    this.eyeRigL = this.buildEye('eyeL', -0.182);
    this.eyeRigR = this.buildEye('eyeR', 0.182);
    this.headGroup.add(this.eyeRigL.root, this.eyeRigR.root);
    this.eyeL = this.createBlinkProxy(this.eyeRigL);
    this.eyeR = this.createBlinkProxy(this.eyeRigR);

    // Brows / nose / ears / hair
    this.headGroup.add(
      this.buildBrow('browL', -0.182, 0.292, 0.452, -0.16),
      this.buildBrow('browR', 0.182, 0.292, 0.452, 0.16),
      this.buildNose(),
      this.buildEar('earL', -0.49),
      this.buildEar('earR', 0.49),
      this.buildContour('under-browL', -0.182, 0.225, 0.41, 0.16, 0.06, 0.07),
      this.buildContour('under-browR', 0.182, 0.225, 0.41, 0.16, 0.06, 0.07),
      this.buildContour('philtrum', 0, -0.105, 0.45, 0.055, 0.095, 0.03),
      this.buildHair(),
    );

    // Mouth
    this.mouthMesh = this.buildMouth();
    this.mouthMesh.name = 'mouth';
    this.mouthMesh.position.set(0, -0.205, 0.476);
    this.headGroup.add(this.mouthMesh);
  }

  private buildHeadGeometry(): THREE.SphereGeometry {
    const geo = new THREE.SphereGeometry(0.5, 40, 28);
    const pos = geo.attributes['position'] as THREE.BufferAttribute;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const yNorm = y / 0.5;
      const jawBlend = THREE.MathUtils.clamp((0.1 - yNorm) / 1.1, 0, 1);
      const cheekBlend = THREE.MathUtils.clamp(1 - Math.abs(yNorm - 0.05) * 1.4, 0, 1);

      pos.setXYZ(
        i,
        x * (0.95 - jawBlend * 0.14 + cheekBlend * 0.03),
        y * 1.12,
        z * (0.9 + cheekBlend * 0.08),
      );
    }

    pos.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }

  private buildEye(name: string, x: number): EyeRig {
    const eyeGroup = new THREE.Group();
    eyeGroup.name = name;
    eyeGroup.position.set(x, 0.15, 0.398);

    const socket = new THREE.Mesh(
      new THREE.SphereGeometry(0.104, 18, 12),
      this.contourMaterial,
    );
    socket.name = `${name}-socket`;
    socket.scale.set(1.02, 0.78, 0.32);
    socket.position.set(0, 0.01, 0.012);

    const sclera = new THREE.Mesh(
      new THREE.SphereGeometry(0.087, 18, 12),
      lambert(SCLERA_COLOR.clone()),
    );
    sclera.name = `${name}-sclera`;
    sclera.scale.set(1.02, 0.82, 0.48);
    sclera.position.z = 0.04;

    const iris = new THREE.Mesh(
      new THREE.CircleGeometry(0.034, 20),
      lambert(IRIS_COLOR.clone()),
    );
    iris.name = `${name}-iris`;
    iris.position.z = 0.092;

    const pupil = new THREE.Mesh(
      new THREE.CircleGeometry(0.015, 16),
      lambert(PUPIL_COLOR.clone()),
    );
    pupil.name = `${name}-pupil`;
    pupil.position.z = 0.096;

    const catchlight = new THREE.Mesh(
      new THREE.CircleGeometry(0.006, 12),
      lambert(SCLERA_COLOR.clone()),
    );
    catchlight.name = `${name}-catchlight`;
    catchlight.position.set(0.012, 0.012, 0.1);

    const upperLid = new THREE.Mesh(
      new THREE.SphereGeometry(0.096, 18, 12),
      this.skinMaterial,
    );
    upperLid.name = `${name}-upperLid`;
    upperLid.scale.set(1.04, 0.42, 0.22);
    upperLid.position.set(0, 0.058, 0.075);

    const upperLidRidge = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.012, 0.15, 12),
      this.contourMaterial,
    );
    upperLidRidge.name = `${name}-upperLidRidge`;
    upperLidRidge.rotation.z = Math.PI / 2;
    upperLidRidge.rotation.x = -0.16;
    upperLidRidge.position.set(0, 0.086, 0.062);
    upperLidRidge.scale.z = 0.72;

    const lowerLidShadow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.007, 0.009, 0.118, 10),
      this.contourMaterial,
    );
    lowerLidShadow.name = `${name}-lowerLidShadow`;
    lowerLidShadow.rotation.z = Math.PI / 2;
    lowerLidShadow.rotation.x = -0.1;
    lowerLidShadow.position.set(0, -0.058, 0.055);
    lowerLidShadow.scale.z = 0.66;

    eyeGroup.add(socket, sclera, iris, pupil, catchlight, upperLid, upperLidRidge, lowerLidShadow);
    this.applyBlinkToEye({
      root: eyeGroup,
      sclera,
      iris,
      pupil,
      catchlight,
      upperLid,
      upperLidRidge,
      lowerLidShadow,
    }, 1);
    return {
      root: eyeGroup,
      sclera,
      iris,
      pupil,
      catchlight,
      upperLid,
      upperLidRidge,
      lowerLidShadow,
    };
  }

  private createBlinkProxy(eye: EyeRig): BlinkProxy {
    let openness = 1;
    const self = this;
    return {
      scale: {
        get y(): number {
          return openness;
        },
        set y(value: number) {
          openness = THREE.MathUtils.clamp(value, 0, 1);
          self.applyBlinkToEye(eye, openness);
        },
      },
    };
  }

  private applyBlinkToEye(eye: EyeRig, openness: number): void {
    const closure = 1 - openness;
    eye.sclera.scale.y = 0.22 + openness * 0.6;
    eye.iris.scale.y = 0.72 + openness * 0.28;
    eye.pupil.scale.y = 0.72 + openness * 0.28;
    eye.catchlight.visible = openness > 0.12;
    eye.iris.position.y = -closure * 0.01;
    eye.pupil.position.y = -closure * 0.012;
    eye.catchlight.position.y = 0.012 - closure * 0.014;
    eye.upperLid.position.y = 0.058 - closure * 0.074;
    eye.upperLid.scale.y = 0.42 + closure * 0.26;
    eye.upperLidRidge.position.y = 0.086 - closure * 0.043;
    eye.lowerLidShadow.position.y = -0.058 + closure * 0.01;
  }

  private buildBrow(name: string, x: number, y: number, z: number, roll: number): THREE.Mesh {
    const brow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.024, 0.17, 10),
      lambert(BROW_COLOR.clone()),
    );
    brow.name = name;
    brow.position.set(x, y, z);
    brow.rotation.z = Math.PI / 2 + roll;
    brow.rotation.x = -0.18;
    brow.scale.z = 0.8;
    return brow;
  }

  private buildNose(): THREE.Mesh {
    const nose = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 16, 12),
      this.skinMaterial,
    );
    nose.name = 'nose';
    nose.position.set(0, -0.015, 0.462);
    nose.scale.set(0.31, 0.7, 0.26);
    return nose;
  }

  private buildEar(name: string, x: number): THREE.Mesh {
    const ear = new THREE.Mesh(
      new THREE.SphereGeometry(0.094, 16, 12),
      this.skinMaterial,
    );
    ear.name = name;
    ear.position.set(x, 0.03, 0.015);
    ear.scale.set(0.42, 0.76, 0.28);
    return ear;
  }

  private buildHair(): THREE.Group {
    const hairGroup = new THREE.Group();
    hairGroup.name = 'hair';

    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 32, 22, 0, Math.PI * 2, 0, Math.PI * 0.48),
      lambert(HAIR_COLOR.clone()),
    );
    shell.name = 'hair-shell';
    shell.position.set(0, 0.18, -0.055);
    shell.scale.set(0.98, 0.98, 0.9);

    const fringe = new THREE.Mesh(
      new THREE.BoxGeometry(0.21, 0.055, 0.1),
      lambert(HAIR_COLOR.clone()),
    );
    fringe.name = 'hair-fringe';
    fringe.position.set(0, 0.27, 0.16);
    fringe.rotation.x = -0.06;

    const sideL = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 14, 10),
      lambert(HAIR_COLOR.clone()),
    );
    sideL.name = 'hair-sideL';
    sideL.position.set(-0.34, 0.16, 0.03);
    sideL.scale.set(0.48, 0.82, 0.42);

    const sideR = sideL.clone();
    sideR.name = 'hair-sideR';
    sideR.position.x *= -1;

    hairGroup.add(shell, fringe, sideL, sideR);
    return hairGroup;
  }

  private buildContour(
    name: string,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
  ): THREE.Mesh {
    const contour = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 14, 10),
      this.contourMaterial,
    );
    contour.name = name;
    contour.position.set(x, y, z);
    contour.scale.set(sx, sy, sz);
    return contour;
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
    this.skinMaterial.color.copy(this.skinColor);
    this.contourMaterial.color.copy(this.skinColor).multiplyScalar(0.84);
  }

  setHeadColor(color: THREE.ColorRepresentation): void {
    this.skinMaterial.color.set(color);
    this.contourMaterial.color.set(color).multiplyScalar(0.84);
  }

  resetHeadColor(): void {
    this.skinMaterial.color.copy(this.skinColor);
    this.contourMaterial.color.copy(this.skinColor).multiplyScalar(0.84);
  }

  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();

    this.group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      geometries.add(obj.geometry);
      if (Array.isArray(obj.material)) {
        obj.material.forEach((material) => materials.add(material));
      } else {
        materials.add(obj.material);
      }
    });

    for (const geometry of geometries) {
      geometry.dispose();
    }

    for (const material of materials) {
      material.dispose();
    }
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
