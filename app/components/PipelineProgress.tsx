"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  BadgeCheck,
  Check,
  Circle,
  Loader2,
  ShieldAlert,
  Timer,
} from "lucide-react";

import type { PipelineStepStatus } from "@/types/pipeline";
import { AGENT_DESCRIPTIONS, AGENT_LABELS, AGENT_ORDER } from "@/types/pipeline";

interface PipelineProgressProps {
  /** Step states; falls back to a pending skeleton before a run starts. */
  steps: PipelineStepStatus[];
  isRunning: boolean;
  /** True when at least one step served fallback data. */
  usedFallback?: boolean;
}

const PENDING_STEPS: PipelineStepStatus[] = AGENT_ORDER.map((agent) => ({
  agent,
  label: AGENT_LABELS[agent],
  description: AGENT_DESCRIPTIONS[agent],
  status: "pending",
  durationMs: 0,
  note: "",
}));

const statusStyles = {
  pending: {
    ring: "border-velho-line bg-white/[0.02]",
    icon: "text-zinc-700",
    label: "text-zinc-500",
  },
  running: {
    ring: "border-sky-500/60 bg-sky-500/[0.08]",
    icon: "text-sky-400",
    label: "text-zinc-100",
  },
  complete: {
    ring: "border-emerald-500/40 bg-emerald-500/[0.06]",
    icon: "text-emerald-400",
    label: "text-zinc-200",
  },
  fallback: {
    ring: "border-amber-500/40 bg-amber-500/[0.06]",
    icon: "text-amber-400",
    label: "text-zinc-200",
  },
  error: {
    ring: "border-rose-500/40 bg-rose-500/[0.06]",
    icon: "text-rose-400",
    label: "text-zinc-200",
  },
} as const;

const StatusIcon = ({ status }: { status: PipelineStepStatus["status"] }) => {
  const cls = statusStyles[status].icon;
  switch (status) {
    case "running":
      return <Loader2 className={`h-3.5 w-3.5 animate-spin ${cls}`} strokeWidth={2.5} />;
    case "complete":
      return <Check className={`h-3.5 w-3.5 ${cls}`} strokeWidth={3} />;
    case "fallback":
      return <ShieldAlert className={`h-3.5 w-3.5 ${cls}`} strokeWidth={2.25} />;
    case "error":
      return <ShieldAlert className={`h-3.5 w-3.5 ${cls}`} strokeWidth={2.25} />;
    default:
      return <Circle className={`h-2.5 w-2.5 ${cls}`} strokeWidth={2.5} />;
  }
};

const statusLabel: Record<PipelineStepStatus["status"], string> = {
  pending: "Queued",
  running: "Running",
  complete: "Live",
  fallback: "Fallback",
  error: "Failed",
};

export default function PipelineProgress({
  steps,
  isRunning,
  usedFallback = false,
}: PipelineProgressProps) {
  const displaySteps = steps.length > 0 ? steps : PENDING_STEPS;
  const completed = displaySteps.filter(
    (step) => step.status === "complete" || step.status === "fallback",
  ).length;
  const progress = Math.round((completed / displaySteps.length) * 100);
  const totalMs = displaySteps.reduce((sum, step) => sum + step.durationMs, 0);

  return (
    <section className="rounded-2xl border border-velho-line bg-velho-panel/60 p-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-zinc-400">
            Pipeline
          </h2>
          {isRunning && (
            <span className="flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-sky-300">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-400" />
              </span>
              Live
            </span>
          )}
          {!isRunning && usedFallback && (
            <span className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300">
              <ShieldAlert className="h-2.5 w-2.5" strokeWidth={2.5} />
              Fallback used
            </span>
          )}
          {!isRunning && !usedFallback && completed === displaySteps.length && (
            <span className="flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
              <BadgeCheck className="h-2.5 w-2.5" strokeWidth={2.5} />
              All live
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 text-[11px] font-medium text-zinc-500">
          {totalMs > 0 && (
            <span className="flex items-center gap-1 font-mono">
              <Timer className="h-3 w-3" strokeWidth={2} />
              {(totalMs / 1000).toFixed(1)}s
            </span>
          )}
          <span className="font-mono">
            {completed}/{displaySteps.length}
          </span>
        </div>
      </header>

      {/* Progress rail */}
      <div className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-white/[0.05]">
        <motion.div
          className={`h-full rounded-full ${
            usedFallback && !isRunning
              ? "bg-gradient-to-r from-amber-400 to-amber-300"
              : "bg-gradient-to-r from-sky-500 to-cyan-300"
          }`}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      {/* Step list */}
      <ol className="mt-4 space-y-1.5">
        {displaySteps.map((step, index) => {
          const styles = statusStyles[step.status];
          return (
            <motion.li
              key={step.agent}
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: index * 0.04 }}
              className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-300 ${styles.ring}`}
            >
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                <StatusIcon status={step.status} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`text-[13px] font-medium ${styles.label}`}>
                    <span className="mr-1.5 font-mono text-[10px] text-zinc-600">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {step.label}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-zinc-600">
                    {step.status === "running"
                      ? "…"
                      : step.durationMs > 0
                        ? `${(step.durationMs / 1000).toFixed(1)}s`
                        : statusLabel[step.status]}
                  </span>
                </div>

                <AnimatePresence initial={false}>
                  {step.note && step.status !== "pending" ? (
                    <motion.p
                      key={step.note}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden text-[11px] leading-relaxed text-zinc-500"
                    >
                      {step.note}
                    </motion.p>
                  ) : (
                    <p className="truncate text-[11px] leading-relaxed text-zinc-600">
                      {step.description}
                    </p>
                  )}
                </AnimatePresence>
              </div>
            </motion.li>
          );
        })}
      </ol>
    </section>
  );
}
