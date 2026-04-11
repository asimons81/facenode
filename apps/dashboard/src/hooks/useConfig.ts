import { useState, useCallback } from 'react';
import { AvatarConfigSchema, defaultConfig } from '@facenode/avatar-core';
import type { AvatarConfig } from '@facenode/avatar-core';

const STORAGE_KEY = 'facenode:config';

function loadFromStorage(): AvatarConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = AvatarConfigSchema.safeParse(JSON.parse(raw));
      if (parsed.success) return parsed.data;
    }
  } catch {
    // ignore
  }
  return defaultConfig;
}

function saveToStorage(config: AvatarConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
}

export function useConfig() {
  const [config, setConfigState] = useState<AvatarConfig>(loadFromStorage);
  const [modelRevision, setModelRevision] = useState(0);

  const bumpModelRevisionIfNeeded = useCallback((prev: AvatarConfig, next: AvatarConfig) => {
    if (prev.avatarModel !== next.avatarModel || prev.gltfModelUrl !== next.gltfModelUrl) {
      setModelRevision((revision) => revision + 1);
    }
  }, []);

  const setConfig = useCallback((updater: Partial<AvatarConfig> | ((prev: AvatarConfig) => AvatarConfig)) => {
    setConfigState((prev) => {
      const next =
        typeof updater === 'function'
          ? updater(prev)
          : { ...prev, ...updater };
      saveToStorage(next);
      bumpModelRevisionIfNeeded(prev, next);
      return next;
    });
  }, [bumpModelRevisionIfNeeded]);

  const resetConfig = useCallback(() => {
    saveToStorage(defaultConfig);
    setConfigState(defaultConfig);
    setModelRevision((revision) => revision + 1);
  }, []);

  const exportConfig = useCallback(() => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'facenode-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [config]);

  const importConfig = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = AvatarConfigSchema.safeParse(JSON.parse(e.target?.result as string));
        if (parsed.success) {
          saveToStorage(parsed.data);
          setConfigState(parsed.data);
          setModelRevision((revision) => revision + 1);
        }
      } catch {
        // ignore invalid files
      }
    };
    reader.readAsText(file);
  }, []);

  return { config, modelRevision, setConfig, resetConfig, exportConfig, importConfig };
}
