import type { CartoonPhase } from "@/app/components/CartoonAnimator";

/**
 * Quiet underscore for the 45-second video.
 *
 * The old bed stacked a new chord + bell motif every loop and on every scene
 * change, so the score built up and talked over the narrator. This one keeps
 * three voices running for the whole play: a soft room-tone, a low drone, and
 * a faint fifth. Phase changes retune them. No bells, no looping stabs.
 *
 * Narration is a separate element. This engine only owns the score and the
 * short scene stings, and ducks itself while the voice is speaking.
 */

export type AudioBedPhase = CartoonPhase;

export interface AudioEngineOptions {
  onUnsupported?: () => void;
}

type AudioContextCtor = typeof AudioContext;

const resolveAudioContextCtor = (): AudioContextCtor | null => {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
};

const midiToHz = (midi: number): number =>
  440 * Math.pow(2, (midi - 69) / 12);

/** Soft roots: a low fifth, a little darker on the problem beat. */
const PHASE_TONES: Record<AudioBedPhase, { root: number; fifth: number; air: number }> = {
  intro: { root: midiToHz(45), fifth: midiToHz(52), air: midiToHz(69) },
  problem: { root: midiToHz(43), fifth: midiToHz(50), air: midiToHz(62) },
  solution: { root: midiToHz(47), fifth: midiToHz(54), air: midiToHz(71) },
  booking: { root: midiToHz(48), fifth: midiToHz(55), air: midiToHz(72) },
};

const PHASE_NOISE: Record<AudioBedPhase, number> = {
  intro: 0.018,
  problem: 0.014,
  solution: 0.016,
  booking: 0.013,
};

interface HeldVoice {
  osc: OscillatorNode;
  gain: GainNode;
}

export class VideoAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private duck: GainNode | null = null;

  private root: HeldVoice | null = null;
  private fifth: HeldVoice | null = null;
  private air: HeldVoice | null = null;
  private noise: { source: AudioBufferSourceNode; filter: BiquadFilterNode; gain: GainNode } | null =
    null;

  private phase: AudioBedPhase = "intro";
  private started = false;
  private muted = false;

  private readonly masterLevel = 0.42;
  private readonly musicLevel = 1;
  private readonly duckedLevel = 0.1;

  async ensureContext(options: AudioEngineOptions = {}): Promise<boolean> {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return true;
    }

    const Ctor = resolveAudioContextCtor();
    if (!Ctor) {
      options.onUnsupported?.();
      return false;
    }

    try {
      const ctx = new Ctor();

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : this.masterLevel;
      master.connect(ctx.destination);

      const duck = ctx.createGain();
      duck.gain.value = this.duckedLevel;
      duck.connect(master);

      const music = ctx.createGain();
      music.gain.value = this.musicLevel;
      music.connect(duck);

      const sfx = ctx.createGain();
      sfx.gain.value = 0.35;
      sfx.connect(master);

      this.ctx = ctx;
      this.master = master;
      this.musicBus = music;
      this.sfxBus = sfx;
      this.duck = duck;

      if (ctx.state === "suspended") await ctx.resume();
      return true;
    } catch {
      options.onUnsupported?.();
      this.ctx = null;
      return false;
    }
  }

  get isReady(): boolean {
    return this.ctx !== null && this.started;
  }

  get isSupported(): boolean {
    return resolveAudioContextCtor() !== null;
  }

  get currentPhase(): AudioBedPhase {
    return this.phase;
  }

  start(): void {
    if (!this.ctx || !this.musicBus || this.started) return;
    this.started = true;
    this.armBed();
  }

  private armBed(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;

    const tones = PHASE_TONES[this.phase];
    this.root = this.holdSine(tones.root, 0.055);
    this.fifth = this.holdSine(tones.fifth, 0.032);
    this.air = this.holdTriangle(tones.air, 0.012);
    this.armNoise(PHASE_NOISE[this.phase]);
  }

  private holdSine(hz: number, gain: number): HeldVoice | null {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return null;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = hz;

    const env = ctx.createGain();
    const now = ctx.currentTime;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + 1.8);

    osc.connect(env);
    env.connect(bus);
    osc.start(now);
    return { osc, gain: env };
  }

  private holdTriangle(hz: number, gain: number): HeldVoice | null {
    const voice = this.holdSine(hz, gain);
    if (voice) voice.osc.type = "triangle";
    return voice;
  }

  private armNoise(gain: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;

    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      // Brown-ish noise: warmer than white, reads as room tone not static.
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      data[i] = last * 3.2;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 340;
    filter.Q.value = 0.5;

    const env = ctx.createGain();
    const now = ctx.currentTime;
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(gain, now + 2.2);

    source.connect(filter);
    filter.connect(env);
    env.connect(bus);
    source.start(now);
    this.noise = { source, filter, gain: env };
  }

  playTransition(): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    const duration = 0.45;
    const now = ctx.currentTime;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(280, now);
    filter.frequency.exponentialRampToValueAtTime(900, now + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.045, now + 0.08);
    env.gain.linearRampToValueAtTime(0, now + duration);

    source.connect(filter);
    filter.connect(env);
    env.connect(bus);
    source.start(now);
    source.stop(now + duration);
    source.onended = () => env.disconnect();
  }

  playProblemSting(): void {
    this.playTone({ fromHz: 110, toHz: 82, duration: 0.42, gain: 0.06, type: "sine" });
  }

  playSuccessChime(): void {
    this.playTone({ fromHz: 392, toHz: 392, duration: 0.35, gain: 0.045, type: "sine" });
  }

  private playTone(config: {
    fromHz: number;
    toHz: number;
    duration: number;
    gain: number;
    type: OscillatorType;
  }): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = config.type;
    osc.frequency.setValueAtTime(config.fromHz, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, config.toHz), now + config.duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(config.gain, now + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, now + config.duration);

    osc.connect(env);
    env.connect(bus);
    osc.start(now);
    osc.stop(now + config.duration + 0.05);
    osc.onended = () => env.disconnect();
  }

  setPhase(phase: AudioBedPhase): void {
    if (phase === this.phase) return;
    this.phase = phase;
    if (!this.started || !this.ctx) return;

    const tones = PHASE_TONES[phase] ?? PHASE_TONES.solution;
    const now = this.ctx.currentTime;
    this.glide(this.root, tones.root, now);
    this.glide(this.fifth, tones.fifth, now);
    this.glide(this.air, tones.air, now);
    if (this.noise) {
      this.noise.gain.gain.cancelScheduledValues(now);
      this.noise.gain.gain.setValueAtTime(this.noise.gain.gain.value, now);
      this.noise.gain.gain.linearRampToValueAtTime(
        PHASE_NOISE[phase] ?? PHASE_NOISE.solution,
        now + 1.4,
      );
    }
  }

  private glide(voice: HeldVoice | null, hz: number, now: number): void {
    if (!voice) return;
    voice.osc.frequency.cancelScheduledValues(now);
    voice.osc.frequency.setValueAtTime(voice.osc.frequency.value, now);
    voice.osc.frequency.exponentialRampToValueAtTime(Math.max(1, hz), now + 1.6);
  }

  setVoiceActive(active: boolean): void {
    const ctx = this.ctx;
    const duck = this.duck;
    if (!ctx || !duck) return;

    const now = ctx.currentTime;
    const target = active ? this.duckedLevel : this.musicLevel;
    duck.gain.cancelScheduledValues(now);
    duck.gain.setValueAtTime(Math.max(duck.gain.value, 0.0001), now);
    duck.gain.linearRampToValueAtTime(target, now + (active ? 0.2 : 0.8));
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), now);
    master.gain.linearRampToValueAtTime(muted ? 0.0001 : this.masterLevel, now + 0.2);
  }

  stop(): void {
    this.started = false;
    const ctx = this.ctx;
    if (ctx) {
      const now = ctx.currentTime;
      const fade = (voice: HeldVoice | null) => {
        if (!voice) return;
        try {
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
          voice.gain.gain.linearRampToValueAtTime(0.0001, now + 0.22);
          voice.osc.stop(now + 0.28);
        } catch {
          // already stopped
        }
      };
      fade(this.root);
      fade(this.fifth);
      fade(this.air);
      if (this.noise) {
        try {
          this.noise.gain.gain.cancelScheduledValues(now);
          this.noise.gain.gain.setValueAtTime(Math.max(this.noise.gain.gain.value, 0.0001), now);
          this.noise.gain.gain.linearRampToValueAtTime(0.0001, now + 0.22);
          this.noise.source.stop(now + 0.28);
        } catch {
          // already stopped
        }
      }
    }
    this.root = null;
    this.fifth = null;
    this.air = null;
    this.noise = null;
  }

  dispose(): void {
    this.stop();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.musicBus = null;
    this.sfxBus = null;
    this.duck = null;
    this.started = false;
    if (ctx) {
      void ctx.close().catch(() => undefined);
    }
  }
}
