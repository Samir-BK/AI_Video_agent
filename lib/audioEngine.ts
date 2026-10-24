import type { CartoonPhase } from "@/app/components/CartoonAnimator";

/**
 * Procedural audio engine for the 45-second video.
 *
 * The video needs a real soundtrack, but shipping media files would bloat the
 * repo and break the "instant fallback" rule if a request failed. Instead we
 * synthesise everything with the Web Audio API at runtime:
 *
 *   - a warm ambient chord bed that shifts mood per storyboard phase,
 *   - a sparse melodic motif so it reads as music rather than a drone,
 *   - short SFX for scene changes, the problem warning and the success landing.
 *
 * The narration itself stays on `speechSynthesis`; this engine just owns the
 * music and effects, and ducks the bed while the voice is speaking so the
 * voiceover is always intelligible.
 *
 * Everything is guarded: if Web Audio is unavailable the engine becomes a
 * no-op and the video still plays with narration only.
 */

export type AudioBedPhase = CartoonPhase;

export interface AudioEngineOptions {
  /** Called when the engine cannot produce sound in this browser. */
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

/* ------------------------------------------------------------------ */
/* Musical material                                                    */
/* ------------------------------------------------------------------ */

/** Semitone offsets used to build each phase's chord. */
const PHASE_CHORDS: Record<AudioBedPhase, number[]> = {
  // Intro: open, airy, optimistic.
  intro: [0, 7, 12, 19],
  // Problem: minor, tense, a little uneasy.
  problem: [0, 3, 7, 10],
  // Solution: bright major resolve, moving upward.
  solution: [0, 4, 7, 12],
};

/** Master gain per phase — the problem beat sits a touch darker and quieter. */
const PHASE_LEVEL: Record<AudioBedPhase, number> = {
  intro: 0.5,
  problem: 0.42,
  solution: 0.58,
};

/** Transposition per phase, in semitones, to shift the emotional centre. */
const PHASE_TRANSPOSE: Record<AudioBedPhase, number> = {
  intro: 0,
  problem: -2,
  solution: 3,
};

/** Midi note -> Hz. */
const midiToHz = (midi: number): number =>
  440 * Math.pow(2, (midi - 69) / 12);

/** A gentle root note the palette of chords is built from. */
const ROOT_MIDI = 50; // D3 — warm and unintrusive under speech.

const CHORD_LOOP_SEC = 24;
const PAD_GAIN = 0.5;

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */

export class VideoAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private duck: GainNode | null = null;

  private padVoices: { osc: OscillatorNode; gain: GainNode }[] = [];
  private bedTimer: number | null = null;
  private phase: AudioBedPhase = "intro";

  private started = false;
  private muted = false;

  private readonly masterLevel = 0.9;
  /** Target gain for the music bed; ducking multiplies down from this. */
  private readonly musicLevel = 1;
  private readonly duckedLevel = 0.22;

  /* ---------------- lifecycle ---------------- */

  /** Lazily create the context. Must be called from a user gesture. */
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

      // Light smoothing so pads bloom in and out instead of clicking.
      const sfx = ctx.createGain();
      sfx.gain.value = 0.9;
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

  /** Begin the bed (idempotent). Requires `ensureContext` to have succeeded. */
  start(): void {
    if (!this.ctx || !this.musicBus) return;
    if (this.started) return;
    this.started = true;
    this.renderBedLoop();

    // Re-arm the loop so the bed keeps moving without a scheduler thread.
    const loopMs = CHORD_LOOP_SEC * 1000;
    this.bedTimer = window.setInterval(() => {
      if (!this.started) return;
      this.renderBedLoop();
    }, loopMs);
  }

  /* ---------------- music ---------------- */

  /** One pass of the ambient bed: a slow chord swell plus a light motif. */
  private renderBedLoop(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;

    const start = ctx.currentTime + 0.02;
    const transpose = PHASE_TRANSPOSE[this.phase];
    const chord = PHASE_CHORDS[this.phase];
    const level = PAD_GAIN * PHASE_LEVEL[this.phase];

    // Sustained pad: each chord tone is a detuned triangle pair.
    chord.forEach((interval, index) => {
      const midi = ROOT_MIDI + interval + transpose;
      const hz = midiToHz(midi);
      const attack = 1.6 + index * 0.25;
      const release = 4 + index * 0.4;
      const hold = CHORD_LOOP_SEC - attack - release;

      this.startPadVoice(hz, start, attack, hold + release, level / chord.length, index);
    });

    // Sparse motif: a few bell-like notes, brighter in the solution phase.
    const motifBase = this.phase === "problem" ? ROOT_MIDI + 12 : ROOT_MIDI + 24;
    const motifPattern =
      this.phase === "problem" ? [0, 3, 5] : this.phase === "intro" ? [0, 4, 7] : [4, 7, 11];

    motifPattern.forEach((interval, index) => {
      const at = start + index * 3.2;
      if (at > start + CHORD_LOOP_SEC - 2) return;
      this.playBell(
        midiToHz(motifBase + interval + transpose),
        at,
        this.phase === "problem" ? 0.09 : 0.13,
      );
    });
  }

  private startPadVoice(
    hz: number,
    startAt: number,
    attack: number,
    holdSec: number,
    gain: number,
    detuneIndex: number,
  ): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;

    const osc = ctx.createOscillator();
    osc.type = detuneIndex % 2 === 0 ? "sine" : "triangle";
    osc.frequency.value = hz;
    osc.detune.value = (detuneIndex % 2 === 0 ? 1 : -1) * 4;

    const env = ctx.createGain();
    env.gain.value = 0;

    // Slow bloom in, long tail out — avoids any perceptible click.
    env.gain.setValueAtTime(0, startAt);
    env.gain.linearRampToValueAtTime(gain, startAt + attack);
    env.gain.setValueAtTime(gain, startAt + Math.max(attack, holdSec - 4));
    env.gain.linearRampToValueAtTime(0.0001, startAt + holdSec);

    osc.connect(env);
    env.connect(bus);
    osc.start(startAt);
    osc.stop(startAt + holdSec + 0.1);
    osc.onended = () => {
      env.disconnect();
      this.padVoices = this.padVoices.filter((voice) => voice.osc !== osc);
    };

    this.padVoices.push({ osc, gain: env });
  }

  private playBell(hz: number, at: number, gain: number): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;

    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = hz;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 1.8);

    osc.connect(env);
    env.connect(bus);
    osc.start(at);
    osc.stop(at + 2);
    osc.onended = () => env.disconnect();
  }

  /* ---------------- sound effects ---------------- */

  /**
   * Transition whoosh between storyboard beats. A filtered noise sweep reads as
   * motion without drawing attention to itself.
   */
  playTransition(): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    const duration = 0.75;
    const now = ctx.currentTime;

    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      // Fade the noise out so the sweep has a natural tail.
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(320, now);
    filter.frequency.exponentialRampToValueAtTime(2600, now + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(0.16, now + 0.12);
    env.gain.linearRampToValueAtTime(0, now + duration);

    source.connect(filter);
    filter.connect(env);
    env.connect(bus);
    source.start(now);
    source.stop(now + duration);
    source.onended = () => env.disconnect();
  }

  /** Short low "problem" thud — used as the bottleneck visual lands. */
  playProblemSting(): void {
    this.playTone({ fromHz: 196, toHz: 98, duration: 0.5, gain: 0.2, type: "sawtooth" });
  }

  /** Rising two-note success chime — used as the solution resolves. */
  playSuccessChime(): void {
    this.playTone({ fromHz: 587, toHz: 587, duration: 0.28, gain: 0.16, type: "sine" });
    window.setTimeout(() => {
      this.playTone({ fromHz: 880, toHz: 880, duration: 0.5, gain: 0.15, type: "sine" });
    }, 180);
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
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(1, config.toHz),
      now + config.duration,
    );

    const env = ctx.createGain();
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(config.gain, now + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, now + config.duration);

    osc.connect(env);
    env.connect(bus);
    osc.start(now);
    osc.stop(now + config.duration + 0.05);
    osc.onended = () => env.disconnect();
  }

  /* ---------------- mixing ---------------- */

  /** Cross-fade the bed to a new phase's harmony. */
  setPhase(phase: AudioBedPhase): void {
    if (phase === this.phase) return;
    this.phase = phase;
    this.renderBedLoop();
  }

  /**
   * Duck the music under the narration. `active` true pulls the bed down while
   * the voice speaks; false restores it.
   */
  setVoiceActive(active: boolean): void {
    const ctx = this.ctx;
    const duck = this.duck;
    if (!ctx || !duck) return;

    const now = ctx.currentTime;
    const target = active ? this.duckedLevel : this.musicLevel;
    duck.gain.cancelScheduledValues(now);
    duck.gain.setValueAtTime(Math.max(duck.gain.value, 0.0001), now);
    duck.gain.linearRampToValueAtTime(target, now + (active ? 0.25 : 0.6));
  }

  /** Mute/unmute the whole engine without tearing down the bed. */
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

  /** Stop music/SFX but keep the context alive for a resume. */
  stop(): void {
    this.started = false;
    if (this.bedTimer !== null) {
      window.clearInterval(this.bedTimer);
      this.bedTimer = null;
    }

    const ctx = this.ctx;
    if (ctx) {
      // Fade the bed out quickly so pausing does not cut mid-chord.
      this.setVoiceActive(false);
      const now = ctx.currentTime;
      this.padVoices.forEach((voice) => {
        try {
          voice.gain.gain.cancelScheduledValues(now);
          voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), now);
          voice.gain.gain.linearRampToValueAtTime(0.0001, now + 0.25);
          voice.osc.stop(now + 0.3);
        } catch {
          // Voice already stopped.
        }
      });
      this.padVoices = [];
    }
  }

  /** Tear everything down (unmount). */
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
