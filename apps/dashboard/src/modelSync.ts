import type { AvatarConfig } from '@facenode/avatar-core';
import type { AvatarController } from '@facenode/web-avatar';

export type AvatarModelLoadArgs = { model: 'procedural' | 'gltf'; url?: string } | null;

export function getAvatarModelLoadArgs(
  config: Pick<AvatarConfig, 'avatarModel' | 'gltfModelUrl'>,
): AvatarModelLoadArgs {
  if (config.avatarModel === 'gltf') {
    if (!config.gltfModelUrl) return null;
    return { model: 'gltf', url: config.gltfModelUrl };
  }

  return { model: 'procedural' };
}

export async function applyAvatarModelConfig(
  controller: AvatarController | null,
  config: Pick<AvatarConfig, 'avatarModel' | 'gltfModelUrl'>,
): Promise<void> {
  const args = getAvatarModelLoadArgs(config);
  if (!controller || !args) return;
  await controller.setAvatarModel(args.model, args.url);
}
