import { z } from 'zod';

export const AvatarConfigSchema = z.object({
  // Connection
  wsUrl: z.string().default('ws://localhost:3456'),

  // Appearance
  skinColor: z.string().default('#c8956a'),
  accentColor: z.string().default('#4FB7A0'),
  backgroundColor: z.string().default('#0a0a0a'),
  environmentPreset: z.enum(['none', 'soft', 'studio']).default('none'),

  // Camera
  cameraPreset: z.enum(['head', 'bust', 'wide']).default('bust'),

  // Subtitles
  subtitlesEnabled: z.boolean().default(true),
  subtitleSize: z.enum(['sm', 'md', 'lg']).default('md'),

  // Animation
  idleIntensity: z.number().min(0).max(1).default(0.5),
  blinkFrequency: z.enum(['slow', 'normal', 'fast']).default('normal'),
  speakingSensitivity: z.number().min(0).max(1).default(0.7),

  // Avatar model
  avatarModel: z.enum(['procedural', 'gltf']).default('procedural'),
  gltfModelUrl: z.string().optional(),

  // HUD
  showStateLabel: z.boolean().default(true),
  showConnectionStatus: z.boolean().default(true),
});

export type AvatarConfig = z.infer<typeof AvatarConfigSchema>;

/** Fully-populated default config. Use as reset target. */
export const defaultConfig: AvatarConfig = AvatarConfigSchema.parse({});
