"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Captions,
  CaptionsOff,
  CalendarClock,
  Mic,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";

import CartoonAnimator, {
  type CartoonPhase,
} from "@/app/components/CartoonAnimator";
import { VideoAudioEngine, type AudioBedPhase } from "@/lib/audioEngine";
import { buildBookingUrl } from "@/lib/booking";
import { NarrationTrack, splitSentences } from "@/lib/narration";
import type {
  BrandPalette,
  VoiceoverProvider,
  CartoonAnimationScene,
  DiscoveryOutput,
  ProblemOutput,
  SolutionOutput,
  VideoScriptOutput,
  VideoScene,
} from "@/types/pipeline";

interface VideoPlayerProps {
  script: VideoScriptOutput;
  discovery: DiscoveryOutput;
  problem: ProblemOutput;
  solution: SolutionOutput;
}

/** How often React state syncs with the animation clock (ms). */
const UI_SYNC_INTERVAL_MS = 60;

const DEFAULT_PALETTE: BrandPalette = {
  primary: "#38BDF8",
  secondary: "#0369A1",
  accent: "#7DD3FC",
};

const PROVIDER_LABELS: Record<VoiceoverProvider, string> = {
  elevenlabs: "ElevenLabs neural voice",
  openai: "OpenAI neural voice",
  groq: "Groq Orpheus voice",
  browser: "Browser voice (add a TTS key for neural)",
};

/**
 * Derive the cartoon phase from the scene boundaries themselves, so retiming
 * the storyboard never desyncs the visuals from the script.
 */
const phaseForSecond = (second: number, scenes: VideoScene[]): CartoonPhase => {
  const scene = scenes.find(
    (candidate) => second >= candidate.startSec && second < candidate.endSec,
  );
  if (!scene) return "solution";
  if (scene.id <= 1) return "intro";
  return scene.id === 2 ? "problem" : "solution";
};

/** Short role label for the current beat — the lower-third kicker. */
const sceneKickerLabel = (phase: CartoonPhase): string => {
  if (phase === "intro") return "Company Snapshot";
  if (phase === "problem") return "The Bottleneck";
  return "The Velho Fix";
};

/** One spoken line, timed, ready to render as a subtitle. */
interface CaptionCue {
  startSec: number;
  endSec: number;
  text: string;
}

/**
 * Split every scene's voiceover into sentence-sized subtitle cues, each timed
 * in proportion to its word count. This gives the video real broadcast-style
 * subtitles — one short line at a time — instead of dumping a paragraph on
 * screen.
 */
const buildCaptionCues = (scenes: VideoScene[]): CaptionCue[] => {
  const cues: CaptionCue[] = [];

  scenes.forEach((scene) => {
    const sentences = scene.voiceover
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    if (sentences.length === 0) return;

    const span = Math.max(scene.endSec - scene.startSec, 0.1);
    const wordCounts = sentences.map(
      (sentence) => sentence.split(/\s+/).filter(Boolean).length || 1,
    );
    const totalWords = wordCounts.reduce((sum, count) => sum + count, 0);

    let cursor = scene.startSec;
    sentences.forEach((sentence, index) => {
      const isLast = index === sentences.length - 1;
      const share = wordCounts[index]! / totalWords;
      const end = isLast ? scene.endSec : cursor + span * share;
      cues.push({ startSec: cursor, endSec: end, text: sentence });
      cursor = end;
    });
  });

  return cues;
};

export default function VideoPlayer({
  script,
  discovery,
  problem,
  solution,
}: VideoPlayerProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);

  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  /** Elapsed ms at the moment the current play segment began. */
  const offsetRef = useRef<number>(0);
  const lastSyncRef = useRef<number>(0);
  const spokenSceneRef = useRef<number>(-1);
  const narrationRef = useRef<NarrationTrack | null>(null);
  const [voiceProvider, setVoiceProvider] = useState<VoiceoverProvider | null>(
    null,
  );
  const [voiceLoading, setVoiceLoading] = useState(true);

  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);
  const [audioUnsupported, setAudioUnsupported] = useState(false);
  const [audioActive, setAudioActive] = useState(false);

  const engineRef = useRef<VideoAudioEngine | null>(null);
  /** Last phase we fired a transition sting for, so we only fire on change. */
  const stungPhaseRef = useRef<CartoonPhase | null>(null);

  const palette = discovery.brand.palette ?? DEFAULT_PALETTE;
  const bookingHref = buildBookingUrl(discovery.companyName, discovery.domain);
  const category = script.bottleneckCategory;

  /** The two authored cartoon beats, in order: [problem, solution]. */
  const cartoonScenes = useMemo<CartoonAnimationScene[]>(
    () => script.cartoonScenes ?? [],
    [script.cartoonScenes],
  );
  const problemBeat = useMemo(
    () =>
      cartoonScenes.find((scene) => scene.type === "problem_animation") ??
      cartoonScenes[0] ??
      null,
    [cartoonScenes],
  );
  const solutionBeat = useMemo(
    () =>
      cartoonScenes.find((scene) => scene.type === "solution_animation") ??
      cartoonScenes[1] ??
      null,
    [cartoonScenes],
  );

  const durationMs = Math.max(script.durationSec, 1) * 1000;
  const scenes = script.scenes;
  const elapsedSec = elapsedMs / 1000;

  const phase = phaseForSecond(elapsedSec, scenes);

  const activeScene: VideoScene = useMemo(() => {
    const found = scenes.find(
      (scene) => elapsedSec >= scene.startSec && elapsedSec < scene.endSec,
    );
    return found ?? scenes[scenes.length - 1]!;
  }, [scenes, elapsedSec]);

  /** Sentence-level subtitles, timed across the whole storyboard. */
  const captionCues = useMemo(() => buildCaptionCues(scenes), [scenes]);

  /** The one subtitle line that should be on screen right now. */
  const activeCue = useMemo(
    () =>
      captionCues.find(
        (cue) => elapsedSec >= cue.startSec && elapsedSec < cue.endSec,
      ) ?? null,
    [captionCues, elapsedSec],
  );

  /* ---------------- Audio engine setup ---------------- */

  useEffect(() => {
    const engine = new VideoAudioEngine();
    engineRef.current = engine;
    if (!engine.isSupported) setAudioUnsupported(true);

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  /* ---------------- Neural voiceover setup ---------------- */

  useEffect(() => {
    setVoiceSupported(true);
    // Duck the music bed whenever the narrator is speaking.
    const track = new NarrationTrack({
      onVoiceActive: (active) => engineRef.current?.setVoiceActive(active),
    });
    narrationRef.current = track;

    // Voice every line up front so playback starts without a gap.
    setVoiceLoading(true);
    void track.preload(scenes).finally(() => {
      if (narrationRef.current !== track) return;
      setVoiceProvider(track.activeProvider ?? "browser");
      setVoiceLoading(false);
    });

    return () => {
      track.dispose();
      if (narrationRef.current === track) narrationRef.current = null;
    };
  }, [scenes]);

  /**
   * Narrate a scene. When playback lands mid-scene (seek), skip the lines
   * whose caption window already passed, so voice and subtitles stay in sync.
   */
  const speakScene = useCallback(
    (scene: VideoScene, atSec?: number) => {
      const track = narrationRef.current;
      if (!track || isMuted) return;
      let skip = 0;
      if (atSec !== undefined && atSec > scene.startSec + 0.25) {
        const cues = buildCaptionCues([scene]);
        skip = cues.filter((cue) => cue.endSec <= atSec).length;
        if (skip >= splitSentences(scene.voiceover).length) return;
      }
      void track.playScene(scene, skip);
    },
    [isMuted],
  );

  const stopSpeech = useCallback(() => {
    narrationRef.current?.stop();
    engineRef.current?.setVoiceActive(false);
  }, []);

  /* ---------------- Animation clock ---------------- */

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    startRef.current = performance.now();

    const loop = (now: number) => {
      const ms = offsetRef.current + (now - startRef.current);

      if (ms >= durationMs) {
        offsetRef.current = durationMs;
        setElapsedMs(durationMs);
        setIsPlaying(false);
        setHasEnded(true);
        // Let the narrator finish the closing call to action.
        return;
      }

      // The cartoon layer runs on CSS, so we only synchronize React state.
      if (now - lastSyncRef.current >= UI_SYNC_INTERVAL_MS) {
        lastSyncRef.current = now;
        setElapsedMs(ms);
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPlaying, durationMs, stopSpeech]);

  /* ---------------- Voiceover sync ---------------- */

  useEffect(() => {
    if (!isPlaying) return;
    if (spokenSceneRef.current === activeScene.id) return;

    const previous = spokenSceneRef.current;
    spokenSceneRef.current = activeScene.id;

    // Natural hand-off to the next scene: let the narrator finish the line.
    if (previous === activeScene.id - 1 && !isMuted) {
      void narrationRef.current?.queueScene(activeScene);
      return;
    }
    // Resume / seek / unmute can land mid-scene: pick narration up from there.
    const liveMs = offsetRef.current + (performance.now() - startRef.current);
    speakScene(activeScene, liveMs / 1000);
  }, [activeScene, isPlaying, isMuted, speakScene]);

  /* ---------------- Music + SFX sync ---------------- */

  /** Shift the ambient bed to match the storyboard phase. */
  useEffect(() => {
    if (!isPlaying) return;
    engineRef.current?.setPhase(phase as AudioBedPhase);
  }, [isPlaying, phase]);

  /**
   * Fire a one-shot sting as each beat lands: a tension hit when the problem
   * appears, a resolve chime when the solution takes over.
   */
  useEffect(() => {
    if (!isPlaying) {
      stungPhaseRef.current = null;
      return;
    }
    if (stungPhaseRef.current === phase) return;
    stungPhaseRef.current = phase;

    const engine = engineRef.current;
    if (!engine) return;

    if (phase === "problem") engine.playProblemSting();
    else if (phase === "solution") engine.playSuccessChime();
  }, [isPlaying, phase]);

  /* ---------------- Controls ---------------- */

  /**
   * Bring the soundtrack up. Must run inside a user gesture, which is why the
   * audio context is only created from a click handler.
   */
  const startAudio = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const ready = await engine.ensureContext({
      onUnsupported: () => setAudioUnsupported(true),
    });
    if (!ready) return;
    engine.setMuted(isMuted);
    engine.setPhase(phase as AudioBedPhase);
    engine.start();
    setAudioActive(true);
  }, [isMuted, phase]);

  const handlePlayPause = useCallback(() => {
    if (hasEnded) {
      // Replay from the top.
      offsetRef.current = 0;
      spokenSceneRef.current = -1;
      stungPhaseRef.current = null;
      setElapsedMs(0);
      setHasEnded(false);
      setIsPlaying(true);
      void startAudio();
      return;
    }

    setIsPlaying((prev) => {
      if (prev) {
        offsetRef.current =
          offsetRef.current + (performance.now() - startRef.current);
        stopSpeech();
        // Resume re-narrates from the paused sentence.
        spokenSceneRef.current = -1;
        engineRef.current?.stop();
        setAudioActive(false);
        return false;
      }
      void startAudio();
      return true;
    });
  }, [hasEnded, startAudio, stopSpeech]);

  const handleRestart = useCallback(() => {
    stopSpeech();
    offsetRef.current = 0;
    spokenSceneRef.current = -1;
    stungPhaseRef.current = null;
    setElapsedMs(0);
    setHasEnded(false);
    setIsPlaying(true);
    void startAudio();
  }, [startAudio, stopSpeech]);

  const handleSeek = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const ratio = Math.min(
        1,
        Math.max(0, (event.clientX - rect.left) / rect.width),
      );
      const target = ratio * durationMs;

      offsetRef.current = target;
      startRef.current = performance.now();
      lastSyncRef.current = 0;
      setElapsedMs(target);
      setHasEnded(false);

      // Force the voiceover to re-fire for whichever scene we landed in, and
      // resync the bed to the beat we jumped into.
      const targetSec = target / 1000;
      const landed = scenes.find(
        (scene) => targetSec >= scene.startSec && targetSec < scene.endSec,
      );
      spokenSceneRef.current = -1;
      stungPhaseRef.current = null;
      engineRef.current?.setPhase(phaseForSecond(targetSec, scenes) as AudioBedPhase);
      engineRef.current?.playTransition();
      if (isPlaying && landed) {
        spokenSceneRef.current = landed.id;
        speakScene(landed, targetSec);
      } else {
        stopSpeech();
      }
    },
    [durationMs, isPlaying, scenes, speakScene, stopSpeech],
  );

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      narrationRef.current?.setMuted(next);
      if (next) stopSpeech();
      // Unmuting picks the narration back up at the current sentence.
      else spokenSceneRef.current = -1;
      engineRef.current?.setMuted(next);
      return next;
    });
  }, [stopSpeech]);

  /* ---------------- Formatting ---------------- */

  const formatTime = (sec: number): string => {
    const whole = Math.max(0, Math.floor(sec));
    return `0:${String(whole).padStart(2, "0")}`;
  };

  const progressPercent = Math.min(100, (elapsedMs / durationMs) * 100);

  const sceneChipLabel = (sceneId: number): string => {
    if (sceneId === 1) return "Intro";
    if (sceneId === 2) return "Problem";
    return "Solution";
  };

  /**
   * The quantified hook for the beat — hours lost while the problem plays, the
   * book-me line while the solution resolves. Keeps exactly one supporting
   * number on screen at a time.
   */
  const bottomMeta = ((): string | null => {
    if (phase === "intro") return null;
    if (phase === "problem") {
      const impact = problem.impact;
      if (impact?.hoursLostPerWeek) return `${impact.hoursLostPerWeek} hrs/week lost`;
      const bottom = activeScene.overlays.find(
        (overlay) => overlay.position === "bottom",
      );
      return bottom?.text ?? null;
    }
    const bottom = activeScene.overlays.find(
      (overlay) => overlay.position === "bottom",
    );
    return bottom?.text ?? null;
  })();

  return (
    <section className="overflow-hidden rounded-2xl border border-velho-line bg-velho-panel/60">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-velho-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-[10px]">
            {discovery.brand.glyph}
          </span>
          <h2 className="truncate text-[13px] font-semibold text-zinc-300">
            45-Second Personalized Video
          </h2>
        </div>
        <span className="shrink-0 rounded-full border border-velho-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          {category.replace(/_/g, " ")} · {script.durationSec}s
        </span>
      </header>

      {/* Stage */}
      <div
        ref={shellRef}
        className="relative aspect-video w-full cursor-pointer overflow-hidden bg-velho-void"
        onClick={handlePlayPause}
      >
        {/* Dynamic cartoon layer — the actual video surface */}
        <AnimatePresence mode="wait">
          <motion.div
            key={phase}
            initial={{ opacity: 0, scale: 1.015 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.99 }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0"
          >
            <CartoonAnimator
              phase={phase}
              cartoonScene={
                phase === "problem"
                  ? problemBeat
                  : phase === "solution"
                    ? solutionBeat
                    : null
              }
              category={category}
              companyName={discovery.companyName}
              domain={discovery.domain}
              glyph={discovery.brand.glyph}
              industry={discovery.industry}
              palette={palette}
              elapsedSec={elapsedSec}
              paused={!isPlaying}
            />
          </motion.div>
        </AnimatePresence>

        {/*
          Cinematic scrims. These keep a broadcast look and guarantee legibility
          while leaving the middle of the frame (where the cartoon lives) clear.
        */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[22%] bg-gradient-to-b from-black/70 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-black/85 via-black/45 to-transparent"
        />

        {/*
          Top strip — identity rail only. No sentences up here: the story is told
          by the artwork, and narration belongs in the caption / voiceover.
        */}
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between gap-3 p-[3.5%]">
          <div className="flex items-center gap-2">
            <span className="text-[13px] leading-none">
              {discovery.brand.glyph}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-white/60">
              {discovery.companyName}
            </span>
          </div>
          <span className="rounded-full bg-black/35 px-2 py-0.5 font-mono text-[10px] tabular-nums text-white/55 backdrop-blur-sm">
            {formatTime(elapsedSec)} / {formatTime(script.durationSec)}
          </span>
        </div>

        {/*
          Lower third — the single, well-managed text zone. A kicker line plus a
          restrained headline replaces the old wall of competing prose.
        */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`lower-third-${activeScene.id}`}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="pointer-events-none absolute inset-x-0 bottom-0 p-[3.5%]"
          >
            <div className="flex items-end justify-between gap-4">
              <div className="min-w-0">
                {/* Kicker: the scene's role in the story */}
                <div className="mb-1.5 flex items-center gap-1.5">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      backgroundColor:
                        phase === "problem"
                          ? "#F43F5E"
                          : phase === "solution"
                            ? "#10B981"
                            : palette.accent,
                    }}
                  />
                  <span
                    className="text-[9.5px] font-bold uppercase tracking-[0.18em]"
                    style={{
                      color:
                        phase === "problem"
                          ? "#FDA4AF"
                          : phase === "solution"
                            ? "#6EE7B7"
                            : palette.accent,
                    }}
                  >
                    {sceneKickerLabel(phase)}
                  </span>
                </div>

                {/*
                  Subtitle line — the only sentence rendered on the video.
                  It advances in short, timed cues so it reads like real
                  captions rather than a headline competing with the cartoon.
                */}
                {showCaptions && activeCue ? (
                  <motion.p
                    key={activeCue.text}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.32 }}
                    className="max-w-[min(56ch,74%)] text-balance text-[clamp(0.72rem,1.75vw,1.02rem)] font-semibold leading-[1.35] tracking-[-0.005em] text-white"
                    style={{
                      textShadow: "0 2px 12px rgba(0,0,0,0.85)",
                    }}
                  >
                    {activeCue.text}
                  </motion.p>
                ) : null}
              </div>

              {/* Right meta: the quantified hook for this beat */}
              {bottomMeta ? (
                <motion.span
                  initial={{ opacity: 0, scale: 0.94 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                  className="shrink-0 rounded-lg border px-2.5 py-1 text-right text-[10px] font-bold backdrop-blur-sm"
                  style={{
                    borderColor: `${palette.accent}44`,
                    backgroundColor: `${palette.accent}18`,
                    color: palette.accent,
                  }}
                >
                  {bottomMeta}
                </motion.span>
              ) : null}
            </div>

            {/* Meeting CTA — only once the Velho solution has landed */}
            {phase === "solution" ? (
              <motion.a
                href={bookingHref}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.75 }}
                className="pointer-events-auto mt-2.5 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[11px] font-bold text-zinc-900 shadow-lg transition-transform hover:scale-[1.03]"
                style={{
                  background: `linear-gradient(135deg, ${palette.accent}, #6EE7B7)`,
                  boxShadow: `0 8px 26px -8px ${palette.accent}aa`,
                }}
              >
                <CalendarClock className="h-3.5 w-3.5" strokeWidth={2.5} />
                Book your 15-minute walkthrough — one click
              </motion.a>
            ) : null}
          </motion.div>
        </AnimatePresence>

        {/* Idle play affordance */}
        <AnimatePresence>
          {!isPlaying && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
            >
              <div className="flex flex-col items-center gap-3">
                <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-white/25 bg-white/10 backdrop-blur-md">
                  {hasEnded ? (
                    <RotateCcw className="h-6 w-6 text-white" strokeWidth={2} />
                  ) : (
                    <Play
                      className="ml-0.5 h-6 w-6 text-white"
                      strokeWidth={2}
                      fill="currentColor"
                    />
                  )}
                </div>
                <span className="text-[11px] font-medium uppercase tracking-wider text-white/60">
                  {hasEnded ? "Replay" : elapsedMs > 0 ? "Resume" : "Play video"}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>

      {/* Transport */}
      <div className="space-y-3 px-4 py-3">
        {/* Segmented progress bar — click to seek */}
        <div
          onClick={handleSeek}
          className="group relative flex h-4 cursor-pointer items-center gap-1"
          role="slider"
          aria-label="Video timeline"
          aria-valuemin={0}
          aria-valuemax={script.durationSec}
          aria-valuenow={Math.round(elapsedSec)}
          tabIndex={0}
        >
          {scenes.map((scene) => {
            const span = scene.endSec - scene.startSec;
            const sceneStartMs = scene.startSec * 1000;
            const fill = Math.min(
              1,
              Math.max(0, (elapsedMs - sceneStartMs) / (span * 1000)),
            );
            const isActive = activeScene.id === scene.id;

            return (
              <div
                key={scene.id}
                className="relative h-[5px] overflow-hidden rounded-full bg-white/[0.08] transition-all duration-200 group-hover:h-[7px]"
                style={{ flexGrow: span }}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-100 ease-linear"
                  style={{
                    width: `${fill * 100}%`,
                    background: isActive
                      ? `linear-gradient(90deg, ${palette.secondary}, ${palette.accent})`
                      : "rgba(255,255,255,0.35)",
                  }}
                />
              </div>
            );
          })}

          {/* Playhead */}
          <div
            className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-white bg-zinc-900 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
            style={{ left: `calc(${progressPercent}% - 6px)` }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePlayPause}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-zinc-200 transition-colors hover:bg-white/[0.12]"
            >
              {isPlaying ? (
                <Pause className="h-3.5 w-3.5" strokeWidth={2.25} fill="currentColor" />
              ) : (
                <Play className="ml-0.5 h-3.5 w-3.5" strokeWidth={2.25} fill="currentColor" />
              )}
            </button>

            <button
              type="button"
              onClick={handleRestart}
              aria-label="Restart video"
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-zinc-200"
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.25} />
            </button>

            <button
              type="button"
              onClick={toggleMute}
              disabled={!voiceSupported && audioUnsupported}
              aria-label={isMuted ? "Unmute audio" : "Mute audio"}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isMuted ? (
                <VolumeX className="h-3.5 w-3.5" strokeWidth={2.25} />
              ) : (
                <Volume2 className="h-3.5 w-3.5" strokeWidth={2.25} />
              )}
            </button>

            <button
              type="button"
              onClick={() => setShowCaptions((prev) => !prev)}
              aria-label={showCaptions ? "Hide captions" : "Show captions"}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-zinc-200"
            >
              {showCaptions ? (
                <Captions className="h-3.5 w-3.5" strokeWidth={2.25} />
              ) : (
                <CaptionsOff className="h-3.5 w-3.5" strokeWidth={2.25} />
              )}
            </button>
          </div>

          {/* Scene chips */}
          <div className="flex items-center gap-1.5">
            {scenes.map((scene) => (
              <button
                key={scene.id}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  offsetRef.current = scene.startSec * 1000;
                  startRef.current = performance.now();
                  lastSyncRef.current = 0;
                  setElapsedMs(scene.startSec * 1000);
                  setHasEnded(false);
                  stungPhaseRef.current = null;
                  // Narrate the chosen scene from its first line.
                  if (isPlaying) {
                    spokenSceneRef.current = scene.id;
                    speakScene(scene);
                  } else {
                    spokenSceneRef.current = -1;
                    stopSpeech();
                  }
                  // Snap the soundtrack to the beat we jumped to.
                  engineRef.current?.setPhase(
                    phaseForSecond(scene.startSec, scenes) as AudioBedPhase,
                  );
                  engineRef.current?.playTransition();
                }}
                className={`rounded-md px-2 py-1 font-mono text-[10px] transition-colors ${
                  activeScene.id === scene.id
                    ? "bg-white/[0.12] text-zinc-100"
                    : "text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300"
                }`}
                title={scene.title}
              >
                {sceneChipLabel(scene.id)}
                <span className="ml-1 hidden text-zinc-600 sm:inline">
                  {scene.startSec}-{scene.endSec}s
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Audio status + direction */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-velho-line pt-2.5 text-[11px] text-zinc-600">
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isPlaying && !isMuted
                  ? "animate-pulse bg-emerald-400"
                  : "bg-zinc-700"
              }`}
            />
            {isMuted ? (
              "Audio muted"
            ) : isPlaying ? (
              <span className="flex items-center gap-1.5">
                Voiceover + score playing
                {audioActive ? (
                  <span className="flex items-end gap-[2px]" aria-hidden>
                    {[0, 1, 2].map((bar) => (
                      <motion.span
                        key={bar}
                        className="w-[2px] rounded-full bg-emerald-400/80"
                        animate={{ height: [3, 9, 4, 10, 3] }}
                        transition={{
                          duration: 1.1,
                          repeat: Infinity,
                          delay: bar * 0.15,
                          ease: "easeInOut",
                        }}
                      />
                    ))}
                  </span>
                ) : null}
              </span>
            ) : audioUnsupported && !voiceSupported ? (
              "Audio unavailable in this browser"
            ) : audioActive ? (
              "Score + voiceover ready"
            ) : (
              "Press play to start narration + score"
            )}
          </span>
          <span className="flex items-center gap-1">
            <Mic className="h-3 w-3" strokeWidth={2} />
            {voiceLoading
              ? "Recording voiceover…"
              : PROVIDER_LABELS[voiceProvider ?? "browser"]}
          </span>
          <span className="hidden truncate sm:inline">
            Signal: {problem.title} → {solution.headlineMetric.delta}
          </span>
        </div>
      </div>
    </section>
  );
}
