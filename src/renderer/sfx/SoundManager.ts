/**
 * @TODO SFX is wired up throughout the app but `setConfig` is never called,
 * so no sound URLs are configured and all play calls are silent no-ops.
 * This is intentional infrastructure for a future audio pack; activate by
 * calling `soundManager.setConfig({ hover: url, click: url, scan: url })`
 * at app startup (v4 review I-2).
 */
export type SfxEffect = 'hover' | 'click' | 'scan';

export interface SfxConfig {
  hover?: string;
  click?: string;
  scan?: string;
}

const VOLUMES: Record<SfxEffect, number> = {
  hover: 0.15,
  click: 0.3,
  scan: 0.4,
};

export class SoundManager {
  private static instance: SoundManager;
  private enabled: boolean = true;
  private config: SfxConfig = {};
  private cache: Map<SfxEffect, HTMLAudioElement> = new Map();
  private cachedSrcs: Map<SfxEffect, string> = new Map();
  private lastHoverTime: number = 0;
  private readonly HOVER_DEBOUNCE_MS = 50;

  private constructor() {}

  public static getInstance(): SoundManager {
    if (!SoundManager.instance) {
      SoundManager.instance = new SoundManager();
    }
    return SoundManager.instance;
  }

  public setEnabled = (enabled: boolean): void => {
    this.enabled = enabled;
  };

  public isEnabled = (): boolean => {
    return this.enabled;
  };

  public setConfig = (config: SfxConfig): void => {
    this.config = { ...this.config, ...config };
  };

  public getConfig = (): SfxConfig => {
    return { ...this.config };
  };

  /**
   * Play the given sound effect. This is a no-op when:
   * - `enabled` is false
   * - no URL is configured for the effect (via `setConfig`)
   * - audio playback fails silently (missing files, autoplay restrictions)
   * All errors are swallowed to avoid disrupting the UI.
   */
  private playEffect(effect: SfxEffect): void {
    if (!this.enabled) {
      return;
    }

    const src = this.config[effect];
    if (!src) {
      return;
    }

    try {
      let audio = this.cache.get(effect);

      if (!audio) {
        audio = new Audio(src);
        this.cache.set(effect, audio);
        this.cachedSrcs.set(effect, src);
      } else if (this.cachedSrcs.get(effect) !== src) {
        audio.src = src;
        this.cachedSrcs.set(effect, src);
      }

      audio.volume = VOLUMES[effect];
      audio.currentTime = 0;

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Silently ignore audio play errors (e.g. unplayable format, missing file, autoplay restrictions)
        });
      }
    } catch {
      // Silently swallow any synchronous audio API errors
    }
  }

  public playHover = (): void => {
    const now = Date.now();
    if (now - this.lastHoverTime < this.HOVER_DEBOUNCE_MS) {
      return;
    }
    this.lastHoverTime = now;
    this.playEffect('hover');
  };

  public playClick = (): void => {
    this.playEffect('click');
  };

  public playScan = (): void => {
    this.playEffect('scan');
  };
  /**
   * Release all cached audio elements and reset state.
   * Call when the SoundManager is no longer needed to free memory.
   */
  public dispose = (): void => {
    this.cache.forEach((audio) => {
      audio.pause();
      audio.src = "";
    });
    this.cache.clear();
    this.cachedSrcs.clear();
    this.config = {};
    this.enabled = true;
  };
}

export const soundManager = SoundManager.getInstance();
