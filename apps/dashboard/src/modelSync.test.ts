import { describe, expect, it, vi } from 'vitest';
import { applyAvatarModelConfig, getAvatarModelLoadArgs } from './modelSync.js';

describe('modelSync', () => {
  it('resolves glTF model load args from persisted config', () => {
    expect(
      getAvatarModelLoadArgs({ avatarModel: 'gltf', gltfModelUrl: 'https://example.com/avatar.glb' }),
    ).toEqual({ model: 'gltf', url: 'https://example.com/avatar.glb' });
  });

  it('resolves procedural model load args from persisted config', () => {
    expect(getAvatarModelLoadArgs({ avatarModel: 'procedural', gltfModelUrl: undefined })).toEqual({
      model: 'procedural',
    });
  });

  it('does not attempt a glTF load when no URL is available', async () => {
    const controller = { setAvatarModel: vi.fn() };

    await applyAvatarModelConfig(controller as never, {
      avatarModel: 'gltf',
      gltfModelUrl: undefined,
    });

    expect(controller.setAvatarModel).not.toHaveBeenCalled();
  });
});
