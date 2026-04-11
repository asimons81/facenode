import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GltfAvatarMesh, ProceduralAvatarMesh } from './avatarMesh.js';

describe('ProceduralAvatarMesh disposal', () => {
  it('disposes all owned geometries and materials', () => {
    const mesh = new ProceduralAvatarMesh();
    const headGroup = mesh.headGroup;
    const neckMesh = mesh.group.children[1] as THREE.Mesh;
    const headMesh = headGroup.children[0] as THREE.Mesh;
    const eyeL = headGroup.children[1] as THREE.Mesh;
    const mouthMesh = headGroup.children[3] as THREE.Mesh;

    const disposeSpies = [
      vi.spyOn(headMesh.geometry, 'dispose'),
      vi.spyOn(neckMesh.geometry, 'dispose'),
      vi.spyOn(eyeL.geometry, 'dispose'),
      vi.spyOn(mouthMesh.geometry, 'dispose'),
      vi.spyOn(mouthMesh.material as THREE.Material, 'dispose'),
      vi.spyOn(headMesh.material as THREE.Material, 'dispose'),
      vi.spyOn(neckMesh.material as THREE.Material, 'dispose'),
      vi.spyOn(eyeL.material as THREE.Material, 'dispose'),
    ];

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
