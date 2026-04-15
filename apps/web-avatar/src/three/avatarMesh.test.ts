import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GltfAvatarMesh, ProceduralAvatarMesh } from './avatarMesh.js';

function findObject<T extends THREE.Object3D>(
  root: THREE.Object3D,
  name: string,
  type: new (...args: never[]) => T,
): T {
  const match = root.getObjectByName(name);
  expect(match).toBeInstanceOf(type);
  return match as T;
}

describe('ProceduralAvatarMesh disposal', () => {
  it('builds a layered face while preserving blink proxies and mouth morphs', () => {
    const mesh = new ProceduralAvatarMesh();

    const eyeL = findObject(mesh.headGroup, 'eyeL', THREE.Group);
    const eyeR = findObject(mesh.headGroup, 'eyeR', THREE.Group);
    const mouth = findObject(mesh.headGroup, 'mouth', THREE.Mesh);
    const nose = findObject(mesh.headGroup, 'nose', THREE.Mesh);
    const hair = findObject(mesh.headGroup, 'hair', THREE.Group);
    const shell = findObject(hair, 'hair-shell', THREE.Mesh);
    const fringe = findObject(hair, 'hair-fringe', THREE.Mesh);
    const browL = findObject(mesh.headGroup, 'browL', THREE.Mesh);
    const earL = findObject(mesh.headGroup, 'earL', THREE.Mesh);

    expect(eyeL.children.map((child) => child.name)).toEqual([
      'eyeL-socket',
      'eyeL-sclera',
      'eyeL-iris',
      'eyeL-pupil',
      'eyeL-catchlight',
      'eyeL-upperLid',
      'eyeL-upperLidRidge',
      'eyeL-lowerLidShadow',
    ]);
    expect(eyeR.children.map((child) => child.name)).toEqual([
      'eyeR-socket',
      'eyeR-sclera',
      'eyeR-iris',
      'eyeR-pupil',
      'eyeR-catchlight',
      'eyeR-upperLid',
      'eyeR-upperLidRidge',
      'eyeR-lowerLidShadow',
    ]);
    expect(hair.children.length).toBeGreaterThanOrEqual(3);
    expect(nose.position.z).toBeGreaterThan(0.4);
    expect(browL.position.y).toBeGreaterThan(eyeL.position.y);
    expect(earL.position.x).toBeLessThan(-0.4);
    expect(shell.position.y).toBeGreaterThan(0.15);
    expect(shell.position.z).toBeLessThan(0);
    expect(fringe.position.y).toBeGreaterThan(shell.position.y);
    expect((shell.material as THREE.MeshLambertMaterial).color.g).toBeLessThan(
      (shell.material as THREE.MeshLambertMaterial).color.r,
    );
    expect(mouth.morphTargetInfluences?.[0]).toBe(0);

    mesh.eyeL.scale.y = 0.35;
    mesh.eyeR.scale.y = 0.6;

    expect(mesh.eyeL.scale.y).toBe(0.35);
    expect(mesh.eyeR.scale.y).toBe(0.6);
    expect(findObject(eyeL, 'eyeL-upperLid', THREE.Mesh).position.y).toBeLessThan(0.03);
    expect(findObject(eyeL, 'eyeL-sclera', THREE.Mesh).scale.y).toBeLessThan(0.5);
    expect(findObject(eyeR, 'eyeR-upperLid', THREE.Mesh).position.y).toBeGreaterThan(0.02);
  });

  it('disposes all owned geometries and materials', () => {
    const mesh = new ProceduralAvatarMesh();
    const trackedDisposables = new Set<{ dispose: () => void }>();

    mesh.group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      trackedDisposables.add(obj.geometry);
      if (Array.isArray(obj.material)) {
        obj.material.forEach((material) => trackedDisposables.add(material));
      } else {
        trackedDisposables.add(obj.material);
      }
    });

    const disposeSpies = Array.from(trackedDisposables, (resource) =>
      vi.spyOn(resource, 'dispose'),
    );

    mesh.dispose();

    for (const spy of disposeSpies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
  });
});

describe('GltfAvatarMesh viseme and disposal behavior', () => {
  it('clears previous viseme morphs before applying a new frame', () => {
    const mesh = new GltfAvatarMesh();
    const mouthMesh = {
      morphTargetDictionary: { viseme_aa: 0, viseme_oh: 1, mouthOpen: 2 },
      morphTargetInfluences: [0.7, 0.6, 0.5],
    } as unknown as THREE.Mesh;

    (mesh as unknown as { mouthMesh: THREE.Mesh | null; mouthMorphIndex: number }).mouthMesh = mouthMesh;
    (mesh as unknown as { mouthMorphIndex: number }).mouthMorphIndex = 2;

    mesh.beginVisemeFrame?.();
    mesh.setViseme('aa', 1);
    mesh.setViseme('oh', 0.6);
    mesh.flushVisemeFrame?.();

    const influences = mouthMesh.morphTargetInfluences as number[];
    expect(influences[0]).toBe(1);
    expect(influences[1]).toBe(0.6);
    expect(influences[2]).toBe(0);

    mesh.beginVisemeFrame?.();
    mesh.setViseme('aa', 0.5);
    mesh.flushVisemeFrame?.();

    expect(influences[0]).toBe(0.5);
    expect(influences[1]).toBe(0);
    expect(influences[2]).toBe(0);
  });

  it('uses mouth-open fallback when no per-viseme morph target is present', () => {
    const mesh = new GltfAvatarMesh();
    const mouthMesh = {
      morphTargetDictionary: { mouthOpen: 0, jawOpen: 1 },
      morphTargetInfluences: [0.2, 0.4],
    } as unknown as THREE.Mesh;

    (mesh as unknown as { mouthMesh: THREE.Mesh | null; mouthMorphIndex: number }).mouthMesh = mouthMesh;
    (mesh as unknown as { mouthMorphIndex: number }).mouthMorphIndex = 0;

    mesh.beginVisemeFrame?.();
    mesh.setViseme('aa', 1);
    mesh.flushVisemeFrame?.();

    const influences = mouthMesh.morphTargetInfluences as number[];
    expect(influences[0]).toBe(1);
    expect(influences[1]).toBe(0.4);
  });

  it('disposes textures once even when multiple material slots reference them', () => {
    const mesh = new GltfAvatarMesh();
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial();
    (material as THREE.MeshStandardMaterial & { map?: THREE.Texture; normalMap?: THREE.Texture }).map = texture;
    (material as THREE.MeshStandardMaterial & { map?: THREE.Texture; normalMap?: THREE.Texture }).normalMap = texture;

    const geometry = new THREE.BoxGeometry();
    const meshObject = new THREE.Mesh(geometry, material);
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const materialDispose = vi.spyOn(material, 'dispose');
    const textureDispose = vi.spyOn(texture, 'dispose');

    mesh.group.add(meshObject);
    mesh.dispose();

    expect(geometryDispose).toHaveBeenCalledTimes(1);
    expect(materialDispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });
});
