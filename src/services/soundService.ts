// Web Audio API Synthesized Audio Pings for Alerts

class SoundService {
  private audioCtx: AudioContext | null = null;

  private getAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtxClass) {
        this.audioCtx = new AudioCtxClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Plays a crisp, attention-grabbing alert chime for red candle drops
   */
  public playDropAlert(volume = 0.5): void {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.01, now);
      gainNode.gain.exponentialRampToValueAtTime(Math.min(1, Math.max(0.01, volume)), now + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      gainNode.connect(ctx.destination);

      // Dual oscillator for rich warning sound
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();

      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.frequency.exponentialRampToValueAtTime(440.00, now + 0.35); // drop to A4

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880.00, now); // A5
      osc2.frequency.exponentialRampToValueAtTime(587.33, now + 0.4);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1400, now);

      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gainNode);

      osc1.start(now);
      osc2.start(now + 0.05);

      osc1.stop(now + 0.55);
      osc2.stop(now + 0.55);
    } catch (e) {
      console.warn('Audio play failed:', e);
    }
  }
}

export const soundService = new SoundService();
