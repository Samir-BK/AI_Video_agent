"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Github, Sparkles, Zap } from "lucide-react";

import DomainInput from "@/app/components/DomainInput";
import EmailPreview from "@/app/components/EmailPreview";
import {
  DiscoveryCard,
  ProblemCard,
  SolutionCard,
} from "@/app/components/InsightCards";
import MobileModal from "@/app/components/MobileModal";
import PipelineProgress from "@/app/components/PipelineProgress";
import VideoPlayer from "@/app/components/VideoPlayer";
import { buildMockPipelineOutputs, normalizeDomain } from "@/lib/mockData";
import type {
  PipelineResult,
  PipelineStepStatus,
} from "@/types/pipeline";
import {
  AGENT_DESCRIPTIONS,
  AGENT_LABELS,
  AGENT_ORDER,
  createAgentMeta,
} from "@/types/pipeline";

/** Mirror of the server's per-step envelopes, kept only for the "live" badge. */
const pendingSteps = (): PipelineStepStatus[] =>
  AGENT_ORDER.map((agent) => ({
    agent,
    label: AGENT_LABELS[agent],
    description: AGENT_DESCRIPTIONS[agent],
    status: "pending",
    durationMs: 0,
    note: "",
  }));

/** Walk the step list forward on a timer while the request is in flight. */
const advanceSteps = (
  steps: PipelineStepStatus[],
  activeIndex: number,
): PipelineStepStatus[] =>
  steps.map((step, index) => {
    if (index < activeIndex) {
      return {
        ...step,
        status: "complete",
        durationMs: step.durationMs || 900,
        note: step.note || "Completed",
      };
    }
    if (index === activeIndex) {
      return {
        ...step,
        status: "running",
        durationMs: 0,
        note: "Working…",
      };
    }
    return { ...step, status: "pending", durationMs: 0, note: "" };
  });

const STEP_INTERVAL_MS = 1100;

export default function HomePage() {
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [steps, setSteps] = useState<PipelineStepStatus[]>(pendingSteps);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeDomain, setActiveDomain] = useState<string>("");

  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);

  const clearTicker = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  useEffect(() => clearTicker, [clearTicker]);

  /**
   * Optimistically advance the tracker while the pipeline runs. The server
   * response replaces these states with the authoritative timings.
   */
  const startTicker = useCallback(() => {
    clearTicker();
    let index = 0;
    setSteps(advanceSteps(pendingSteps(), 0));

    tickRef.current = setInterval(() => {
      index += 1;
      if (index >= AGENT_ORDER.length) {
        // Hold on the final step until the real response lands.
        setSteps((prev) =>
          prev.map((step, i) =>
            i === AGENT_ORDER.length - 1 ? { ...step, status: "running" } : step,
          ),
        );
        return;
      }
      setSteps(advanceSteps(pendingSteps(), index));
    }, STEP_INTERVAL_MS);
  }, [clearTicker]);

  const handleGenerate = useCallback(
    async (rawDomain: string) => {
      const domain = normalizeDomain(rawDomain);
      if (!domain) return;

      setIsRunning(true);
      setError(null);
      setResult(null);
      setActiveDomain(domain);
      startTicker();

      // Pre-built locally so the offline safety net can render instantly.
      const instantPreview = buildMockPipelineOutputs(domain);

      try {
        const response = await fetch("/api/generate-outreach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain }),
        });

        const payload: unknown = await response.json();

        // The API returns { error, detail, fallback } when it degrades.
        const candidate = payload as {
          error?: string;
          detail?: string;
          fallback?: PipelineResult;
        } & Partial<PipelineResult>;

        const resolved =
          candidate.fallback && candidate.fallback.steps
            ? candidate.fallback
            : (payload as PipelineResult);

        if (!resolved?.steps) {
          throw new Error(candidate.error ?? "Malformed pipeline response");
        }

        clearTicker();
        setResult(resolved);
        setSteps(resolved.steps);
        setError(
          candidate.error
            ? "Pipeline degraded gracefully — showing instant fallback data."
            : null,
        );

        requestAnimationFrame(() => {
          resultsRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          });
        });
      } catch (fetchError) {
        // Client-side safety net: render the mock dashboard rather than an error.
        clearTicker();
        const now = new Date().toISOString();
        const offlineNote = "Client-side fallback (network unavailable)";
        const offlineMeta = createAgentMeta("mock", {
          durationMs: 0,
          note: offlineNote,
          warnings: [offlineNote],
        });
        const wrap = <T,>(data: T) => ({ data, meta: offlineMeta });

        const offlineResult: PipelineResult = {
          domain,
          startedAt: now,
          completedAt: now,
          totalDurationMs: 0,
          discovery: wrap(instantPreview.discovery),
          problem: wrap(instantPreview.problem),
          solution: wrap(instantPreview.solution),
          videoScript: wrap(instantPreview.videoScript),
          email: wrap(instantPreview.email),
          steps: pendingSteps().map((step) => ({
            ...step,
            status: "fallback" as const,
            durationMs: 0,
            note: "Instant mock data",
          })),
          usedFallback: true,
        };

        setResult(offlineResult);
        setSteps(offlineResult.steps);
        setError(
          fetchError instanceof Error && fetchError.message
            ? `Couldn't reach the pipeline — rendered instant fallback. (${fetchError.message})`
            : "Couldn't reach the pipeline — rendered instant fallback.",
        );
      } finally {
        clearTicker();
        setIsRunning(false);
      }
    },
    [clearTicker, startTicker],
  );

  const palette = result?.discovery.data.brand.palette;
  const accent = palette?.primary ?? "#38BDF8";
  const domainLabel = useMemo(
    () => result?.domain ?? activeDomain,
    [result, activeDomain],
  );

  return (
    // overflow-x-clip keeps decorative glows from creating a scrollbar without
    // turning the page into a scroll container (which would break position:sticky).
    <div className="relative min-h-screen overflow-x-clip">
      {/* Ambient backdrop */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="velho-grid absolute inset-0" />
        <div
          className="absolute left-1/2 top-[-16rem] h-[36rem] w-[36rem] -translate-x-1/2 rounded-full blur-[130px]"
          style={{
            background: `radial-gradient(circle, ${accent}26, transparent 68%)`,
            transition: "background 700ms ease",
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-velho-void to-transparent" />
      </div>

      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-velho-line/70 bg-velho-void/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-7 w-7 items-center justify-center rounded-lg border text-[11px] font-bold"
              style={{
                borderColor: `${accent}40`,
                backgroundColor: `${accent}14`,
                color: accent,
              }}
            >
              V
            </div>
            <div className="leading-tight">
              <p className="text-[13px] font-semibold text-zinc-100">
                Velho <span className="text-zinc-500">Outreach Engine</span>
              </p>
              <p className="text-[10px] text-zinc-600">
                Applied Intelligence · 5-agent pipeline
              </p>
            </div>
          </div>

          <div className="hidden items-center gap-2 text-[11px] text-zinc-500 sm:flex">
            <Zap className="h-3 w-3 text-amber-400" strokeWidth={2.5} />
            45-second personalized video per prospect
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-5 pb-20">
        {/* Hero */}
        <section className="pt-12 sm:pt-16">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto max-w-3xl text-center"
          >
            <span className="inline-flex items-center gap-1.5 rounded-full border border-velho-line bg-white/[0.02] px-3 py-1 text-[11px] font-medium text-zinc-400">
              <Sparkles className="h-3 w-3" strokeWidth={2.25} style={{ color: accent }} />
              Research → Insight → Video → Email, in one pass
            </span>

            <h1 className="mt-5 text-balance text-[clamp(1.9rem,5.4vw,3.4rem)] font-bold leading-[1.06] tracking-[-0.03em] text-zinc-50">
              Turn any domain into a
              <span className="relative mx-2 inline-block">
                <span className="relative z-10 bg-gradient-to-r from-sky-300 via-cyan-200 to-sky-400 bg-clip-text text-transparent">
                  personalized
                </span>
              </span>
              video pitch
            </h1>

            <p className="mx-auto mt-4 max-w-xl text-pretty text-[13.5px] leading-relaxed text-zinc-400 sm:text-[14.5px]">
              Five agents research the company, pinpoint an operational
              bottleneck, architect the fix, script a 45-second video, and write
              the CEO email. Enter a domain to run it.
            </p>

            <div className="mt-7">
              <DomainInput
                onSubmit={handleGenerate}
                isLoading={isRunning}
                error={error}
              />
            </div>
          </motion.div>
        </section>

        {/* Dashboard */}
        <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_392px]">
          {/* Left column */}
          <div className="min-w-0 space-y-5">
            <AnimatePresence mode="wait">
              {result ? (
                <motion.div
                  key={`video-${result.domain}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.4 }}
                  className="space-y-5"
                >
                  <VideoPlayer
                    script={result.videoScript.data}
                    discovery={result.discovery.data}
                    problem={result.problem.data}
                    solution={result.solution.data}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="video-placeholder"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex aspect-video items-center justify-center rounded-2xl border border-dashed border-velho-line bg-velho-panel/30"
                >
                  <div className="px-6 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-velho-line bg-white/[0.02]">
                      <Sparkles className="h-5 w-5 text-zinc-700" strokeWidth={1.75} />
                    </div>
                    <p className="mt-3 text-[13px] font-medium text-zinc-500">
                      Your video will render here
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-700">
                      Enter a domain above to start the 5-agent pipeline
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Agent insight cards */}
            {result && (
              <div className="grid gap-5 md:grid-cols-2">
                <DiscoveryCard discovery={result.discovery.data} />
                <ProblemCard problem={result.problem.data} />
                <div className="md:col-span-2">
                  <SolutionCard
                    solution={result.solution.data}
                    accent={result.discovery.data.brand.palette.accent}
                  />
                </div>
              </div>
            )}

            {/* Email */}
            <AnimatePresence>
              {result && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: 0.1 }}
                >
                  <EmailPreview
                    email={result.email.data}
                    onPreviewMobile={() => setMobileOpen(true)}
                    isFallback={result.email.meta.source !== "live"}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <div ref={resultsRef} />
          </div>

          {/* Right column: pipeline tracker */}
          <aside className="min-w-0 lg:sticky lg:top-[4.6rem] lg:self-start">
            <PipelineProgress
              steps={steps}
              isRunning={isRunning}
              usedFallback={result?.usedFallback}
            />

            {result && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.15 }}
                className="mt-4 rounded-2xl border border-velho-line bg-velho-panel/60 p-4"
              >
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  Run summary
                </h3>
                <dl className="mt-3 space-y-2 text-[12px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-zinc-600">Target</dt>
                    <dd className="truncate font-mono text-zinc-300">
                      {domainLabel}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-zinc-600">Company</dt>
                    <dd className="truncate text-right text-zinc-300">
                      {result.discovery.data.companyName}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-zinc-600">Bottleneck</dt>
                    <dd className="truncate text-right text-zinc-300">
                      {result.problem.data.title}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="text-zinc-600">Headline metric</dt>
                    <dd
                      className="shrink-0 font-mono font-semibold"
                      style={{ color: accent }}
                    >
                      {result.solution.data.headlineMetric.delta}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 border-t border-velho-line pt-2">
                    <dt className="text-zinc-600">Total time</dt>
                    <dd className="font-mono tabular-nums text-zinc-300">
                      {(result.totalDurationMs / 1000).toFixed(2)}s
                    </dd>
                  </div>
                </dl>

                <button
                  type="button"
                  onClick={() => setMobileOpen(true)}
                  className="mt-3 w-full rounded-lg border border-velho-line bg-white/[0.02] py-2 text-[11.5px] font-medium text-zinc-300 transition-colors hover:border-zinc-600 hover:bg-white/[0.05]"
                >
                  Preview landing page on mobile
                </button>
              </motion.div>
            )}

            <div className="mt-4 rounded-2xl border border-velho-line bg-velho-panel/40 p-4">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Stage safety
              </h3>
              <ul className="mt-2.5 space-y-1.5 text-[11.5px] leading-relaxed text-zinc-500">
                <li className="flex gap-2">
                  <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-emerald-400/70" />
                  Every agent is capped at a 6s deadline.
                </li>
                <li className="flex gap-2">
                  <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-emerald-400/70" />
                  Any failure degrades to deterministic mock data.
                </li>
                <li className="flex gap-2">
                  <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-emerald-400/70" />
                  The dashboard always renders — never a blank screen.
                </li>
              </ul>
            </div>
          </aside>
        </div>
      </main>

      <footer className="border-t border-velho-line/70">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-5 text-[11px] text-zinc-600">
          <p>
            Velho Applied Intelligence · Discovery → Problem → Solution → Video
            → Email
          </p>
          <span className="flex items-center gap-1.5">
            <Github className="h-3 w-3" strokeWidth={2} />
            Built for the hackathon
          </span>
        </div>
      </footer>

      {result && (
        <MobileModal
          isOpen={mobileOpen}
          onClose={() => setMobileOpen(false)}
          discovery={result.discovery.data}
          solution={result.solution.data}
          videoScript={result.videoScript.data}
          email={result.email.data}
        />
      )}
    </div>
  );
}
