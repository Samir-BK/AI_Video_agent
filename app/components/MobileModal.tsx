"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ShieldCheck, Sparkles, TrendingUp, X } from "lucide-react";

import { buildBookingUrl } from "@/lib/booking";

import CartoonAnimator, {
  type CartoonPhase,
} from "@/app/components/CartoonAnimator";
import type {
  DiscoveryOutput,
  EmailOutput,
  SolutionOutput,
  VideoScriptOutput,
} from "@/types/pipeline";

interface MobileModalProps {
  isOpen: boolean;
  onClose: () => void;
  discovery: DiscoveryOutput;
  solution: SolutionOutput;
  videoScript: VideoScriptOutput;
  email: EmailOutput;
}

/**
 * "CEO Mobile Preview" — renders the personalized video landing page inside
 * an iPhone frame so the operator can see exactly what the prospect sees
 * after tapping the link in the cold email.
 */
export default function MobileModal({
  isOpen,
  onClose,
  discovery,
  solution,
  videoScript,
  email,
}: MobileModalProps) {
  const [elapsed, setElapsed] = useState(0);

  const palette = discovery.brand.palette;
  const duration = videoScript.durationSec;

  /* Escape to close + body scroll lock while open. */
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, onClose]);

  /* Simulated playback progress inside the mock player. */
  useEffect(() => {
    if (!isOpen) {
      setElapsed(0);
      return;
    }
    const started = performance.now();
    const timer = setInterval(() => {
      const seconds = (performance.now() - started) / 1000;
      setElapsed(seconds % duration);
    }, 60);
    return () => clearInterval(timer);
  }, [isOpen, duration]);

  const activeScene =
    videoScript.scenes.find(
      (scene) => elapsed >= scene.startSec && elapsed < scene.endSec,
    ) ?? videoScript.scenes[videoScript.scenes.length - 1]!;

  const progress = Math.min(100, (elapsed / duration) * 100);

  const cartoonScenes = videoScript.cartoonScenes ?? [];
  // Derive the phase from the scene boundaries so the phone preview can never
  // drift out of sync with a retimed storyboard.
  const phase: CartoonPhase =
    activeScene.id <= 1 ? "intro" : activeScene.id === 2 ? "problem" : "solution";
  const phaseBeat =
    phase === "intro"
      ? null
      : (cartoonScenes.find((scene) =>
          phase === "problem"
            ? scene.type === "problem_animation"
            : scene.type === "solution_animation",
        ) ?? cartoonScenes[phase === "problem" ? 0 : 1] ?? null);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-md"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="CEO mobile preview"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex max-h-[94vh] flex-col items-center gap-4"
            onClick={(event) => event.stopPropagation()}
          >
            {/* Title + close */}
            <div className="flex w-full items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Sparkles
                  className="h-4 w-4"
                  strokeWidth={2}
                  style={{ color: palette.accent }}
                />
                <span className="text-[13px] font-semibold text-zinc-200">
                  CEO Mobile Preview
                </span>
                <span className="hidden rounded-full border border-velho-line px-2 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">
                  {email.videoUrl.replace(/^https?:\/\//, "")}
                </span>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close preview"
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-zinc-400 transition-colors hover:bg-white/[0.12] hover:text-zinc-100"
              >
                <X className="h-4 w-4" strokeWidth={2.25} />
              </button>
            </div>

            {/* iPhone frame */}
            <div className="velho-scroll overflow-y-auto">
              <div
                className="relative shrink-0 rounded-[46px] border-[10px] border-zinc-800 bg-zinc-800 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)]"
                style={{
                  width: 320,
                  // Keep the device frame fully visible on shorter viewports.
                  height: "min(660px, calc(94vh - 116px))",
                }}
              >
                {/* Notch */}
                <div className="absolute left-1/2 top-[10px] z-30 h-[26px] w-[110px] -translate-x-1/2 rounded-full bg-zinc-800" />

                {/* Screen */}
                <div className="relative h-full w-full overflow-hidden rounded-[36px] bg-velho-void">
                  {/* Status bar */}
                  <div className="relative z-20 flex items-center justify-between px-6 pb-1 pt-3 text-[10px] font-semibold text-white/80">
                    <span className="font-mono tabular-nums">9:41</span>
                    <div className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm bg-white/60" />
                      <span className="h-2 w-3 rounded-sm bg-white/60" />
                      <span className="h-2 w-4 rounded-sm bg-white/80" />
                    </div>
                  </div>

                  <div className="velho-scroll h-[calc(100%-28px)] overflow-y-auto">
                    {/* Hero video surface — the same dynamic cartoon the
                        desktop player renders, scoped to the phone frame. */}
                    <div className="relative aspect-[4/5] w-full overflow-hidden">
                      <AnimatePresence mode="wait">
                        <motion.div
                          key={phase}
                          initial={{ opacity: 0, scale: 1.02 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.99 }}
                          transition={{ duration: 0.4 }}
                          className="absolute inset-0"
                        >
                          <CartoonAnimator
                            phase={phase}
                            cartoonScene={phaseBeat}
                            category={videoScript.bottleneckCategory}
                            companyName={discovery.companyName}
                            domain={discovery.domain}
                            glyph={discovery.brand.glyph}
                            industry={discovery.industry}
                            palette={palette}
                            elapsedSec={elapsed}
                            paused={false}
                          />
                        </motion.div>
                      </AnimatePresence>

                      {/* Cinematic scrim so the overlay text stays legible */}
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

                      {/* Scene overlay text */}
                      <div className="absolute inset-x-0 bottom-0 p-4">
                        <AnimatePresence mode="wait">
                          <motion.div
                            key={activeScene.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -8 }}
                            transition={{ duration: 0.35 }}
                            className="rounded-xl bg-black/45 p-3 backdrop-blur-sm"
                          >
                            <p className="text-[10px] font-medium uppercase tracking-wider text-white/50">
                              {activeScene.title}
                            </p>
                            <p className="mt-1 text-[13px] font-bold leading-snug text-white">
                              {activeScene.overlays.find(
                                (overlay) => overlay.position === "center",
                              )?.text ?? videoScript.headline}
                            </p>
                          </motion.div>
                        </AnimatePresence>

                        {/* Progress bar */}
                        <div className="mt-2.5 h-[3px] w-full overflow-hidden rounded-full bg-white/15">
                          <div
                            className="h-full rounded-full transition-[width] duration-100 ease-linear"
                            style={{
                              width: `${progress}%`,
                              background: `linear-gradient(90deg, ${palette.secondary}, ${palette.accent})`,
                            }}
                          />
                        </div>
                        <p className="mt-1.5 text-right font-mono text-[9px] tabular-nums text-white/45">
                          0:{String(Math.floor(elapsed)).padStart(2, "0")} / 0:
                          {String(duration).padStart(2, "0")}
                        </p>
                      </div>
                    </div>

                    {/* Landing page body */}
                    <div className="space-y-3 p-4">
                      <div>
                        <p
                          className="text-[10px] font-semibold uppercase tracking-[0.16em]"
                          style={{ color: palette.accent }}
                        >
                          Prepared for {discovery.companyName}
                        </p>
                        <h3 className="mt-1.5 text-[16px] font-bold leading-snug text-zinc-100">
                          {videoScript.headline}
                        </h3>
                      </div>

                      {/* Outcome chips */}
                      <div className="flex flex-wrap gap-1.5">
                        {solution.steps.map((step) => (
                          <span
                            key={step.order}
                            className="rounded-md border px-2 py-0.5 text-[10px] text-zinc-300"
                            style={{
                              borderColor: `${palette.primary}33`,
                              backgroundColor: `${palette.primary}12`,
                            }}
                          >
                            {step.title}
                          </span>
                        ))}
                      </div>

                      {/* Headline metric */}
                      <div
                        className="flex items-center justify-between rounded-xl border p-3"
                        style={{
                          borderColor: `${palette.primary}33`,
                          backgroundColor: `${palette.primary}0f`,
                        }}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1 text-zinc-500">
                            <TrendingUp className="h-2.5 w-2.5" strokeWidth={2.5} />
                            <span className="text-[9px] font-medium uppercase tracking-wider">
                              Projected
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[11.5px] font-semibold text-zinc-100">
                            {solution.headlineMetric.value}
                          </p>
                        </div>
                        <span
                          className="shrink-0 rounded-lg px-2 py-0.5 font-mono text-[11px] font-bold"
                          style={{
                            backgroundColor: `${palette.primary}22`,
                            color: palette.accent,
                          }}
                        >
                          {solution.headlineMetric.delta}
                        </span>
                      </div>

                      {/* CTA */}
                      <a
                        href={buildBookingUrl(discovery.companyName, discovery.domain)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full rounded-xl py-2.5 text-center text-[12px] font-semibold text-zinc-900 transition-opacity hover:opacity-90"
                        style={{ backgroundColor: palette.accent }}
                      >
                        Book a 15-minute walkthrough
                      </a>

                      {/* Trust line */}
                      <p className="flex items-center justify-center gap-1.5 text-[9.5px] text-zinc-600">
                        <ShieldCheck className="h-3 w-3" strokeWidth={2} />
                        Built by Velho Applied Intelligence
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <p className="text-center text-[11px] text-zinc-500">
              This is the page {discovery.companyName}&apos;s CEO sees when they
              tap the link in the email.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
