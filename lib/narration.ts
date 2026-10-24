import type { VideoScene, VoiceoverProvider } from "@/types/pipeline";

/**
 * Client-side narration track for the video.
 *
 * Each scene's voiceover is split into sentences and each sentence is voiced
 * by /api/voiceover (neural TTS). Short clips keep every provider under its
 * input limit and let playback start fast. When a scene begins, its sentences
 * play back to back, so the read sounds continuous.
 *
 * If a clip is missing (no key, timeout, offline), that sentence is spoken
 * with browser speechSynthesis instead, so the video is never silent.
 */

/** Same budget as the pipeline: never wait more than 6s on one clip. */
const CLIP_TIMEOUT_MS = 6000;

export interface NarrationCallbacks {
  /** Fires true while any voice is audible (used to duck the music bed). */
  onVoiceActive?: (active: boolean) => void;
}

type ClipState =
  | { status: "pending"; promise: Promise<void> }
  | { status: "ready"; url: string }
  | { status: "failed" };

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
  const preferred = ["premium", "enhanced", "google us english", "microsoft aria", "samantha", "daniel"];
  for (const name of preferred) {
    const match = pool.find((voice) => voice.name.toLowerCase().includes(name));
    if (match) return match;
  }
  return pool[0] ?? null;
};

export class NarrationTrack {
  private clips = new Map<string, ClipState>();
  private audio: HTMLAudioElement | null = null;
  /** Bumps on every play/stop so stale async playback aborts itself. */
  private generation = 0;
  private muted = false;
  private disposed = false;
  private neuralCount = 0;
  private provider: VoiceoverProvider | null = null;

  constructor(private readonly callbacks: NarrationCallbacks = {}) {}

  /** Provider of the most recent neural clip, or "browser" if none succeeded. */
  get activeProvider(): VoiceoverProvider | null {
    return this.provider;
  }

  /** Start fetching every sentence of every scene (call when the video mounts). */
  preload(scenes: VideoScene[]): Promise<void> {
    const sentences = scenes.flatMap((scene) => splitSentences(scene.voiceover));
    return Promise.all(sentences.map((sentence) => this.ensureClip(sentence))).then(
      () => undefined,
    );
  }

  private ensureClip(text: string): Promise<void> {
    const existing = this.clips.get(text);
    if (existing?.status === "pending") return existing.promise;
    if (existing) return Promise.resolve();

    const promise = this.fetchClip(text);
    this.clips.set(text, { status: "pending", promise });
    return promise;
  }

  private async fetchClip(text: string): Promise<void> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), CLIP_TIMEOUT_MS + 1500);
    try {
      const response = await fetch("/api/voiceover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      const type = response.headers.get("Content-Type") ?? "";
      if (!response.ok || !type.startsWith("audio/")) {
        if (this.neuralCount === 0) this.provider = "browser";
        this.clips.set(text, { status: "failed" });
        return;
      }
      const blob = await response.blob();
      if (this.disposed) return;
      this.neuralCount += 1;
      this.provider =
        (response.headers.get("X-Voiceover-Provider") as VoiceoverProvider | null) ?? "openai";
      this.clips.set(text, { status: "ready", url: URL.createObjectURL(blob) });
    } catch {
      if (this.neuralCount === 0) this.provider = "browser";
      this.clips.set(text, { status: "failed" });
    } finally {
      window.clearTimeout(timer);
    }
  }

  /**
   * Narrate one scene from the top. `skipSentences` lets a seek land partway
   * through a scene without replaying lines that already passed.
   */
  playScene(scene: VideoScene, skipSentences = 0): Promise<void> {
    this.stop();
    this.current = this.runScene(scene, skipSentences, this.generation);
    return this.current;
  }

  /**
   * Natural scene change: let the line in progress finish, then continue.
   * This avoids clipping the narrator mid-word at a scene boundary.
   */
  queueScene(scene: VideoScene): Promise<void> {
    const generation = this.generation;
    const previous = this.current;
    this.current = previous.then(() =>
      generation === this.generation
        ? this.runScene(scene, 0, generation)
        : undefined,
    );
    return this.current;
  }

  private current: Promise<void> = Promise.resolve();

  private async runScene(
    scene: VideoScene,
    skipSentences: number,
    generation: number,
  ): Promise<void> {
    if (this.muted) return;
    const sentences = splitSentences(scene.voiceover).slice(skipSentences);

    for (const sentence of sentences) {
      if (generation !== this.generation || this.disposed) return;
      await this.ensureClip(sentence);
      if (generation !== this.generation || this.disposed) return;

      const clip = this.clips.get(sentence);
      if (clip?.status === "ready") {
        await this.playClip(clip.url, generation);
      } else {
        await this.speakWithBrowser(sentence, generation);
      }
    }
    if (generation === this.generation) this.callbacks.onVoiceActive?.(false);
  }

  private playClip(url: string, generation: number): Promise<void> {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      audio.volume = 1;
      this.audio = audio;
      const done = () => {
        audio.onended = null;
        audio.onerror = null;
        if (this.audio === audio) this.audio = null;
        resolve();
      };
      audio.onended = done;
      audio.onerror = done;
      this.callbacks.onVoiceActive?.(true);
      audio.play().catch(done);
      // stop() pauses the element; resolve so the loop can exit.
      audio.onpause = () => {
        if (generation !== this.generation) done();
      };
    });
  }

  private speakWithBrowser(text: string, generation: number): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) {
        resolve();
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickBrowserVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = 1;
      utterance.pitch = 0.98;
      const finish = () => resolve();
      utterance.onend = finish;
      utterance.onerror = finish;
      if (generation !== this.generation) {
        resolve();
        return;
      }
      this.callbacks.onVoiceActive?.(true);
      window.speechSynthesis.speak(utterance);
    });
  }

  /** Silence everything immediately (pause, seek, scene change). */
  stop(): void {
    this.generation += 1;
    this.current = Promise.resolve();
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    this.callbacks.onVoiceActive?.(false);
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) this.stop();
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
    this.clips.forEach((clip) => {
      if (clip.status === "ready") URL.revokeObjectURL(clip.url);
    });
    this.clips.clear();
  }
}
