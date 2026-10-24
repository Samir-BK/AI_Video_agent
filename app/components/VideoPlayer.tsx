"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Captions,
  CaptionsOff,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";

import type {
  BrandPalette,
  DiscoveryOutput,
  VideoScriptOutput,
  VideoScene,
} from "@/types/pipeline";
import { hashString } from "@/lib/mockData";
import { renderScene, resizeCanvas } from "@/lib/sceneRenderer";

interface VideoPlayerProps {
  script: VideoScriptOutput;
  discovery: DiscoveryOutput;
}

/** How often React state syncs with the animation clock (ms). */
const UI_SYNC_INTERVAL_MS = 50;

const DEFAULT_PALETTE: BrandPalette = {
  primary: "#38BDF8",
  secondary: "#0369A1",
  accent: "#7DD3FC",
};

/** Pick a natural-sounding English voice when one is available. */
const selectVoice = (
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null => {
  const english = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith("en"),
  );
  const pool = english.length > 0 ? english : voices;

  const preferred = [
    "samantha",
    "google us english",
    "microsoft aria",
    "microsoft jenny",
    "alex",
    "daniel",
  ];

  for (const name of preferred) {
    const match = pool.find((voice) => voice.name.toLowerCase().includes(name));
    if (match) return match;
  }
  return pool[0] ?? null;
};

export default function VideoPlayer({ script, discovery }: VideoPlayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  /** Elapsed ms at the moment the current play segment began. */
  const offsetRef = useRef<number>(0);
  const lastSyncRef = useRef<number>(0);
  const spokenSceneRef = useRef<number>(-1);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [hasEnded, setHasEnded] = useState(false);

  const palette = discovery.brand.palette ?? DEFAULT_PALETTE;
  const seed = useMemo(() => hashString(discovery.domain), [discovery.domain]);

  const durationMs = Math.max(script.durationSec, 1) * 1000;
  const scenes = script.scenes;
  const elapsedSec = elapsedMs / 1000;

  const activeScene: VideoScene = useMemo(() => {
    const found = scenes.find(
      (scene) => elapsedSec >= scene.startSec && elapsedSec < scene.endSec,
    );
    return found ?? scenes[scenes.length - 1]!;
  }, [scenes, elapsedSec]);

  const sceneProgress = useMemo(() => {
    const span = Math.max(activeScene.endSec - activeScene.startSec, 0.001);
    return Math.min(1, Math.max(0, (elapsedSec - activeScene.startSec) / span));
  }, [activeScene, elapsedSec]);

  /* ---------------- Speech synthesis setup ---------------- */

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    setVoiceSupported(true);

    const loadVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) voiceRef.current = selectVoice(voices);
    };

    loadVoices();
    window.speechSynthesis.addEventListener("voiceschanged", loadVoices);

    return () => {
      window.speechSynthesis.removeEventListener("voiceschanged", loadVoices);
      window.speechSynthesis.cancel();
    };
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      if (isMuted || !text.trim()) return;

      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.rate = 1.02;
      utterance.pitch = 1;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
    },
    [isMuted],
  );

  const stopSpeech = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
  }, []);

  /* ---------------- Animation loop ---------------- */

  const draw = useCallback(
    (ms: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const { w, h } = sizeRef.current;
      if (w === 0 || h === 0) return;

      const ctx = resizeCanvas(canvas, w, h);
      if (!ctx) return;

      const seconds = ms / 1000;
      const scene =
        scenes.find(
          (s) => seconds >= s.startSec && seconds < s.endSec,
        ) ?? scenes[scenes.length - 1]!;

      const span = Math.max(scene.endSec - scene.startSec, 0.001);
      const progress = Math.min(
        1,
        Math.max(0, (seconds - scene.startSec) / span),
      );

      renderScene({
        ctx,
        width: w,
        height: h,
        sceneId: scene.id,
        progress,
        timeMs: ms,
        palette,
        seed,
      });
    },
    [palette, scenes, seed],
  );

  /** Keep the canvas sized to its container. */
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const measure = () => {
      const rect = shell.getBoundingClientRect();
      sizeRef.current = { w: rect.width, h: rect.height };
      draw(offsetRef.current);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [draw]);

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
        stopSpeech();
        draw(durationMs);
        return;
      }

      draw(ms);

      // Throttle React state so the tree doesn't re-render at 60fps.
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
  }, [isPlaying, durationMs, draw, stopSpeech]);

  /* ---------------- Voiceover sync ---------------- */

  useEffect(() => {
    if (!isPlaying) return;
    if (spokenSceneRef.current === activeScene.id) return;

    spokenSceneRef.current = activeScene.id;
    speak(activeScene.voiceover);
  }, [activeScene, isPlaying, speak]);

  /* ---------------- Controls ---------------- */

  const handlePlayPause = useCallback(() => {
    if (hasEnded) {
      // Replay from the top.
      offsetRef.current = 0;
      spokenSceneRef.current = -1;
      setElapsedMs(0);
      setHasEnded(false);
      setIsPlaying(true);
      return;
    }

    setIsPlaying((prev) => {
      if (prev) {
        offsetRef.current = offsetRef.current + (performance.now() - startRef.current);
        stopSpeech();
        return false;
      }
      return true;
    });
  }, [hasEnded, stopSpeech]);

  const handleRestart = useCallback(() => {
    stopSpeech();
    offsetRef.current = 0;
    spokenSceneRef.current = -1;
    setElapsedMs(0);
    setHasEnded(false);
    setIsPlaying(true);
  }, [stopSpeech]);

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

      // Force the voiceover to re-fire for whichever scene we landed in.
      const targetSec = target / 1000;
      const landed = scenes.find(
        (s) => targetSec >= s.startSec && targetSec < s.endSec,
      );
      spokenSceneRef.current = -1;
      if (isPlaying && landed) {
        spokenSceneRef.current = landed.id;
        speak(landed.voiceover);
      }

      draw(target);
    },
    [durationMs, draw, isPlaying, scenes, speak],
  );

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      if (!prev) stopSpeech();
      return !prev;
    });
  }, [stopSpeech]);

  /* ---------------- Formatting ---------------- */

  const formatTime = (sec: number): string => {
    const whole = Math.max(0, Math.floor(sec));
    return `0:${String(whole).padStart(2, "0")}`;
  };

  const progressPercent = Math.min(100, (elapsedMs / durationMs) * 100);

  return (
    <section className="overflow-hidden rounded-2xl border border-velho-line bg-velho-panel/60">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-velho-line px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-white/[0.05] text-[10px]">
            {discovery.brand.glyph}
          </span>
          <h2 className="truncate text-[13px] font-semibold text-zinc-300">
            20-Second Personalized Video
          </h2>
        </div>
        <span className="shrink-0 rounded-full border border-velho-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
          {script.scenes.length} scenes · {script.durationSec}s
        </span>
      </header>

      {/* Stage */}
      <div
        ref={shellRef}
        className="relative aspect-video w-full cursor-pointer overflow-hidden bg-velho-void"
        onClick={handlePlayPause}
      >
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

        {/* Text overlays */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeScene.id}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="pointer-events-none absolute inset-0 flex flex-col justify-between p-[4.5%]"
          >
            {/* Top: company identity */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="text-base leading-none">
                  {discovery.brand.glyph}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/70">
                  {discovery.companyName}
                </span>
              </div>
              <span className="font-mono text-[10px] tabular-nums text-white/40">
                {formatTime(elapsedSec)} / {formatTime(script.durationSec)}
              </span>
            </div>

            {/* Center: the scene's headline overlay */}
            <div className="flex flex-col items-center text-center">
              {activeScene.overlays
                .filter((overlay) => overlay.position === "center")
                .map((overlay, index) => (
                  <motion.p
                    key={`${activeScene.id}-center-${index}`}
                    initial={{ opacity: 0, y: 14, filter: "blur(6px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{
                      duration: 0.6,
                      delay: 0.12 + index * 0.1,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className="max-w-[85%] text-balance text-[clamp(1.05rem,3.6vw,2.1rem)] font-bold leading-[1.12] tracking-[-0.02em] text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.6)]"
                    style={{
                      textShadow: `0 0 44px ${palette.primary}55`,
                    }}
                  >
                    {overlay.text}
                  </motion.p>
                ))}
            </div>

            {/* Bottom: supporting line */}
            <div className="flex flex-col items-center gap-1 text-center">
              {activeScene.overlays
                .filter((overlay) => overlay.position === "bottom")
                .map((overlay, index) => (
                  <motion.p
                    key={`${activeScene.id}-bottom-${index}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="max-w-[90%] text-[clamp(0.6rem,1.6vw,0.85rem)] font-medium text-white/80"
                  >
                    {overlay.text}
                  </motion.p>
                ))}
            </div>
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

        {/* Voiceover caption bar */}
        <AnimatePresence>
          {showCaptions && isPlaying && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              className="pointer-events-none absolute inset-x-[6%] bottom-[4.5%]"
            >
              <p className="mx-auto max-w-2xl rounded-lg bg-black/55 px-3 py-1.5 text-center text-[11px] leading-snug text-white/90 backdrop-blur-sm">
                {activeScene.voiceover}
              </p>
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
            const sceneEndMs = scene.endSec * 1000;
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
              disabled={!voiceSupported}
              aria-label={isMuted ? "Unmute voiceover" : "Mute voiceover"}
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
                  const rect =
                    event.currentTarget.parentElement?.getBoundingClientRect();
                  void rect;
                  offsetRef.current = scene.startSec * 1000;
                  startRef.current = performance.now();
                  lastSyncRef.current = 0;
                  setElapsedMs(scene.startSec * 1000);
                  setHasEnded(false);
                  spokenSceneRef.current = -1;
                  draw(scene.startSec * 1000);
                }}
                className={`rounded-md px-2 py-1 font-mono text-[10px] transition-colors ${
                  activeScene.id === scene.id
                    ? "bg-white/[0.12] text-zinc-100"
                    : "text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-300"
                }`}
                title={scene.title}
              >
                {scene.startSec}–{scene.endSec}s
              </button>
            ))}
          </div>
        </div>

        {/* Voiceover status + direction */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-velho-line pt-2.5 text-[11px] text-zinc-600">
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isPlaying && !isMuted && voiceSupported
                  ? "animate-pulse bg-emerald-400"
                  : "bg-zinc-700"
              }`}
            />
            {voiceSupported
              ? isMuted
                ? "Voiceover muted"
                : isPlaying
                  ? "Voiceover playing"
                  : "Voiceover ready"
              : "Speech synthesis unavailable in this browser"}
          </span>
          <span className="hidden truncate sm:inline">
            Direction: {script.voiceStyle}
          </span>
        </div>
      </div>
    </section>
  );
}
