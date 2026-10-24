import type { VideoScene, VoiceoverProvider, VoiceoverWord } from "@/types/pipeline";
import {
  countSpokenWords,
  lockedCaptionCues,
  narrationPlaybackRate,
  type TimedCue,
} from "@/lib/voiceoverBudget";

/**
 * Client narration locked to the video clock.
 *
 * Each scene is one neural clip. Playback rate is chosen so that clip lasts
 * exactly as long as the scene, and the playhead is pulled back to the video
 * clock whenever it drifts. Captions use the same rate, so the line on screen
 * is the line being spoken, and the spoken line is the scene on screen.
 *
 * If neural audio never arrives, the whole remaining scene is one
 * speechSynthesis utterance fitted to the time left. One utterance avoids the
 * macOS bug where back-to-back utterances are dropped.
 */

const CLIP_TIMEOUT_MS = 45000;

const BROWSER_WORDS_PER_SEC = 2.55;

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export interface NarrationCallbacks {
  onVoiceActive?: (active: boolean) => void;
  /** Fired once a scene's clip is measured, with captions on the video clock. */
  onSceneCues?: (sceneId: number, cues: TimedCue[]) => void;
  /** Prefer a DOM <audio> so play() stays unlocked after the click. */
  player?: HTMLAudioElement | null;
}

type ClipState =
  | { status: "pending"; promise: Promise<void> }
  | { status: "ready"; url: string; duration: number; words: VoiceoverWord[] }
  | { status: "failed" };

interface ClipResponse {
  provider?: string;
  mime?: string;
  audio?: string;
  words?: VoiceoverWord[];
}

export const splitSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const pickBrowserVoice = (): SpeechSynthesisVoice | null => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const english = voices.filter((voice) => voice.lang.toLowerCase().startsWith("en"));
  const pool = english.length > 0 ? english : voices;
  const preferred = [
    "premium",
    "enhanced",
    "google us english",
    "microsoft aria",
    "samantha",
    "daniel",
  ];
  for (const name of preferred) {
    const match = pool.find((voice) => voice.name.toLowerCase().includes(name));
    if (match) return match;
  }
  return pool[0] ?? null;
};

const decodeAudio = (base64: string, mime: string): string => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mime || "audio/mpeg" }));
};

const measureDuration = (url: string, fallback: number): Promise<number> =>
  new Promise((resolve) => {
    const probe = new Audio();
    probe.preload = "metadata";
    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      probe.onloadedmetadata = null;
      probe.onerror = null;
      probe.src = "";
      resolve(value > 0.15 && Number.isFinite(value) ? value : fallback);
    };
    probe.onloadedmetadata = () => finish(probe.duration);
    probe.onerror = () => finish(fallback);
    setTimeout(() => finish(fallback), 2500);
    probe.src = url;
  });

export class NarrationTrack {
  private clips = new Map<number, ClipState>();
  private generation = 0;
  private muted = false;
  private disposed = false;
  private provider: VoiceoverProvider | null = null;
  private player: HTMLAudioElement | null = null;
  private playerUrl: string | null = null;
  private neuralScene = -1;
  private armToken = 0;
  private browserSceneId = -1;
  private wasPlaying = false;
  private lastVideoSec: number | null = null;
  private lastKick = 0;
  private clockRate = 1;
  private retries = new Map<number, number>();
  private controllers = new Set<AbortController>();

  constructor(private readonly callbacks: NarrationCallbacks = {}) {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.getVoices();
    }
  }

  /**
   * Start the current scene from a user click. Speech and audio.play() must
   * happen here — a requestAnimationFrame later is no longer a user gesture,
   * and macOS Chrome drops it without an error.
   */
  begin(scene: VideoScene, atSec: number): void {
    this.unlock();
    this.wasPlaying = true;
    this.lastVideoSec = atSec;
    this.follow(atSec, scene, true);
  }

  /** Video clock rate (0.5–2). follow() applies it to the clip already playing. */
  setPlaybackSpeed(speed: number): void {
    this.clockRate = Number.isFinite(speed) && speed > 0 ? speed : 1;
  }

  get activeProvider(): VoiceoverProvider | null {
    return this.provider;
  }

  /** Voice scene 1 first, then the rest, so Play is not waiting on later beats. */
  async preload(scenes: VideoScene[]): Promise<void> {
    for (const scene of scenes) {
      if (this.disposed) return;
      await this.ensureScene(scene);
    }
  }

  /**
   * Keep the narrator on the video clock. Call this from the animation frame
   * while the video is playing; call `pause` when it stops.
   */
  follow(videoSec: number, scene: VideoScene, fromGesture = false): void {
    if (this.disposed || this.muted) {
      this.pauseOutput();
      return;
    }

    const jumped =
      this.wasPlaying &&
      this.lastVideoSec !== null &&
      Math.abs(videoSec - this.lastVideoSec) > 0.6;
    this.lastVideoSec = videoSec;
    this.wasPlaying = true;

    const span = Math.max(0.1, scene.endSec - scene.startSec);
    const local = Math.min(span, Math.max(0, videoSec - scene.startSec));
    const clip = this.clips.get(scene.id);
    if (clip?.status === "failed") this.retryScene(scene);

    if (clip?.status === "ready" && clip.duration > 0.15) {
      if (this.browserSceneId !== -1) {
        this.cancelBrowser();
        this.browserSceneId = -1;
      }
      const fit = narrationPlaybackRate(clip.duration, span);
      // Same mapping as the captions: scene-local seconds * fit = file time.
      const expected = Math.min(Math.max(0, clip.duration - 0.04), local * fit);
      this.playNeural(scene.id, clip, fit * this.clockRate, expected);
      return;
    }

    // The picture has moved on. Don't leave the previous scene's voice running.
    if (this.neuralScene !== -1 && this.neuralScene !== scene.id) this.silenceNeural();
    if (this.browserSceneId !== -1 && this.browserSceneId !== scene.id) {
      this.cancelBrowser();
      this.browserSceneId = -1;
    }

    // Don't wait for a network clip. If it isn't here, speak now — especially
    // from the Play click, which is the only moment the browser allows audio.
    if (this.browserSceneId === scene.id && !jumped && !fromGesture) return;

    this.silenceNeural();
    this.browserSceneId = scene.id;
    const fraction = local / span;
    const text = scriptFrom(scene.voiceover, fraction);
    if (!text) return;
    const remaining = Math.max(0.4, span - local);
    const estimated = countSpokenWords(text) / BROWSER_WORDS_PER_SEC;
    const rate = Math.min(1.8, Math.max(0.6, (estimated / remaining) * this.clockRate));
    this.speakBrowser(text, rate);
  }

  /** User pause, mute, or the end of the timeline. Keeps the clip loaded. */
  pause(): void {
    this.pauseOutput();
  }

  unlock(): void {
    const player = this.getPlayer();
    const token = this.armToken;
    if (!this.playerUrl) player.src = SILENT_WAV;
    player.muted = true;
    void player
      .play()
      .catch(() => undefined)
      .finally(() => {
        player.muted = false;
        // follow() may already have swapped in the scene clip. Don't pause it.
        if (this.armToken !== token) return;
        if (!this.wasPlaying) player.pause();
      });
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.resume();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.pauseOutput();
  }

  dispose(): void {
    this.generation += 1;
    this.disposed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
    this.silenceNeural();
    this.cancelBrowser();
    if (this.player) {
      this.player.onloadedmetadata = null;
      this.player.removeAttribute("src");
      this.player.load();
      this.player = null;
    }
    this.clips.forEach((clip) => {
      if (clip.status === "ready") URL.revokeObjectURL(clip.url);
    });
    this.clips.clear();
    this.callbacks.onVoiceActive?.(false);
  }

  private pauseOutput(): void {
    this.wasPlaying = false;
    this.browserSceneId = -1;
    this.silenceNeural();
    this.cancelBrowser();
    this.callbacks.onVoiceActive?.(false);
  }

  private silenceNeural(): void {
    if (this.player && !this.player.paused) this.player.pause();
  }

  private cancelBrowser(): void {
    this.generation += 1;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  private retryScene(scene: VideoScene): void {
    if ((this.retries.get(scene.id) ?? 0) >= 1) return;
    if (this.clips.get(scene.id)?.status === "pending") return;
    this.retries.set(scene.id, 1);
    this.clips.delete(scene.id);
    void this.ensureScene(scene);
  }

  private ensureScene(scene: VideoScene): Promise<void> {
    const existing = this.clips.get(scene.id);
    if (existing?.status === "pending") return existing.promise;
    if (existing) return Promise.resolve();

    const promise = this.fetchScene(scene);
    this.clips.set(scene.id, { status: "pending", promise });
    return promise;
  }

  private async fetchScene(scene: VideoScene): Promise<void> {
    const controller = new AbortController();
    this.controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), CLIP_TIMEOUT_MS);
    try {
      const response = await fetch("/api/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: scene.voiceover }),
        signal: controller.signal,
      });
      const body = (await response.json()) as ClipResponse;
      if (!response.ok || !body.audio || body.provider === "browser") {
        if (!this.provider) this.provider = "browser";
        this.clips.set(scene.id, { status: "failed" });
        return;
      }
      if (this.disposed) return;

      const url = decodeAudio(body.audio, body.mime ?? "audio/mpeg");
      const words = Array.isArray(body.words) ? body.words : [];
      const lastWord = words.length > 0 ? words[words.length - 1]!.end : 0;
      const estimated = lastWord > 0.15
        ? lastWord + 0.2
        : Math.max(0.8, countSpokenWords(scene.voiceover) / 2.4);
      const duration = await measureDuration(url, estimated);
      if (this.disposed) {
        URL.revokeObjectURL(url);
        return;
      }

      this.provider = (body.provider as VoiceoverProvider | undefined) ?? "edge";
      this.clips.set(scene.id, { status: "ready", url, duration, words });
      this.callbacks.onSceneCues?.(
        scene.id,
        lockedCaptionCues(
          scene.voiceover,
          scene.startSec,
          scene.endSec,
          duration,
          words,
        ),
      );
    } catch {
      if (!this.provider) this.provider = "browser";
      if (!this.disposed) this.clips.set(scene.id, { status: "failed" });
    } finally {
      clearTimeout(timer);
      this.controllers.delete(controller);
    }
  }

  private getPlayer(): HTMLAudioElement {
    if (this.callbacks.player) {
      this.player = this.callbacks.player;
      this.player.preload = "auto";
      this.player.preservesPitch = true;
      return this.player;
    }
    if (!this.player) {
      const audio = new Audio();
      audio.preload = "auto";
      audio.preservesPitch = true;
      this.player = audio;
    }
    return this.player;
  }

  private playNeural(
    sceneId: number,
    clip: Extract<ClipState, { status: "ready" }>,
    rate: number,
    expected: number,
  ): void {
    const audio = this.getPlayer();
    audio.muted = false;
    audio.volume = 1;

    const seek = (target: number) => {
      const dur = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : clip.duration;
      audio.currentTime = Math.min(Math.max(0, target), Math.max(0, dur - 0.04));
    };

    if (this.neuralScene !== sceneId || this.playerUrl !== clip.url) {
      this.neuralScene = sceneId;
      this.playerUrl = clip.url;
      const token = ++this.armToken;
      const start = () => {
        if (token !== this.armToken || this.disposed || this.muted) return;
        audio.playbackRate = rate;
        seek(expected);
        this.kick(audio, true);
      };
      audio.pause();
      audio.onloadedmetadata = start;
      audio.src = clip.url;
      if (audio.readyState >= 1) start();
      return;
    }

    audio.playbackRate = rate;
    const dur = Number.isFinite(audio.duration) && audio.duration > 0
      ? audio.duration
      : clip.duration;
    // The clip has finished and the scene still has a moment left. Stay
    // silent — restarting play() would speak the scene again from the top.
    if (audio.ended && expected >= dur - 0.2) {
      this.callbacks.onVoiceActive?.(false);
      return;
    }
    if (Math.abs(audio.currentTime - expected) > 0.3) seek(expected);
    if (audio.paused) this.kick(audio);
    else this.callbacks.onVoiceActive?.(true);
  }

  private kick(audio: HTMLAudioElement, force = false): void {
    const now = performance.now();
    if (!force && now - this.lastKick < 250) return;
    this.lastKick = now;
    this.callbacks.onVoiceActive?.(true);
    void audio.play().catch(() => {
      this.lastKick = 0;
    });
  }

  private speakBrowser(text: string, rate: number): void {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    this.cancelBrowser();
    const generation = this.generation;
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = pickBrowserVoice();
    if (voice) utterance.voice = voice;
    utterance.rate = rate;
    utterance.pitch = 0.98;
    utterance.volume = 1;
    utterance.onend = () => {
      if (generation === this.generation) this.callbacks.onVoiceActive?.(false);
    };
    utterance.onerror = () => {
      if (generation === this.generation) this.callbacks.onVoiceActive?.(false);
    };
    if (generation !== this.generation || this.disposed || this.muted) return;
    this.callbacks.onVoiceActive?.(true);
    window.speechSynthesis.speak(utterance);
  }
}

/** Remaining script from the sentence that covers `fraction` of the scene. */
const scriptFrom = (voiceover: string, fraction: number): string => {
  const sentences = splitSentences(voiceover);
  if (sentences.length === 0) return "";
  if (fraction <= 0.05) return sentences.join(" ");

  const counts = sentences.map((sentence) => countSpokenWords(sentence) || 1);
  const total = counts.reduce((sum, count) => sum + count, 0);
  let cursor = 0;
  for (let index = 0; index < sentences.length; index += 1) {
    const end = index === sentences.length - 1 ? 1 : cursor + counts[index]! / total;
    if (fraction < end) return sentences.slice(index).join(" ");
    cursor = end;
  }
  return sentences[sentences.length - 1]!;
};
