import { useEffect } from 'react';
import { soundManager } from './SoundManager';

export interface UseSfxReturn {
  playHover: () => void;
  playClick: () => void;
  playScan: () => void;
  setEnabled: (enabled: boolean) => void;
}

const STABLE_SFX: UseSfxReturn = Object.freeze({
  playHover: soundManager.playHover,
  playClick: soundManager.playClick,
  playScan: soundManager.playScan,
  setEnabled: soundManager.setEnabled,
});

/**
 * Hook to access SFX playback methods and controls.
 * Returns a stable reference object containing playHover, playClick, playScan, and setEnabled.
 */
export function useSfx(): UseSfxReturn {
  return STABLE_SFX;
}

/**
 * Convenience hook to set SFX enabled/disabled state on mount and prop changes.
 */
export function useSfxEnabled(enabled: boolean): void {
  useEffect(() => {
    soundManager.setEnabled(enabled);
  }, [enabled]);
}
