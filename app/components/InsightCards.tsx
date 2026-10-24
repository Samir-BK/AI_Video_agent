"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Clock,
  Layers,
  Plug,
  Target,
  TrendingDown,
} from "lucide-react";

import type {
  DiscoveryOutput,
  ProblemOutput,
  ProblemSeverity,
  SolutionOutput,
} from "@/types/pipeline";

/* ------------------------------------------------------------------ */
/* Shared shell                                                        */
/* ------------------------------------------------------------------ */

const cardMotion = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
};

interface CardShellProps {
  step: string;
  title: string;
  accent?: string;
  children: React.ReactNode;
}

function CardShell({ step, title, accent = "#38BDF8", children }: CardShellProps) {
  return (
    <motion.section
      {...cardMotion}
      className="overflow-hidden rounded-2xl border border-velho-line bg-velho-panel/60"
    >
      <header className="flex items-center gap-2.5 border-b border-velho-line px-4 py-3">
        <span
          className="flex h-5 w-5 items-center justify-center rounded-md font-mono text-[10px] font-bold"
          style={{
            backgroundColor: `${accent}1f`,
            color: accent,
          }}
        >
          {step}
        </span>
        <h2 className="text-[13px] font-semibold text-zinc-300">{title}</h2>
      </header>
      <div className="p-4">{children}</div>
    </motion.section>
  );
}

/** Small labelled key/value row. */
function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2.5">
      <span className="mt-[3px] shrink-0 text-zinc-600">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          {label}
        </p>
        <div className="mt-0.5 text-[12.5px] leading-relaxed text-zinc-300">
          {children}
        </div>
      </div>
    </div>
  );
}

/** Row of small tags. */
function TagRow({ items, accent }: { items: string[]; accent: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-md border px-2 py-0.5 text-[11px] text-zinc-300"
          style={{ borderColor: `${accent}33`, backgroundColor: `${accent}12` }}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 1 — Discovery                                                  */
/* ------------------------------------------------------------------ */

export function DiscoveryCard({
  discovery,
}: {
  discovery: DiscoveryOutput;
}) {
  const { palette } = discovery.brand;

  return (
    <CardShell step="01" title="Discovery" accent={palette.primary}>
      <div className="space-y-4">
        {/* Company header */}
        <div className="flex items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border text-lg"
            style={{
              borderColor: `${palette.primary}40`,
              backgroundColor: `${palette.primary}14`,
            }}
          >
            {discovery.brand.glyph}
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-[15px] font-semibold text-zinc-100">
              {discovery.companyName}
            </h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              <span className="font-mono">{discovery.domain}</span>
              <span className="mx-1.5 text-zinc-700">·</span>
              {discovery.industry}
              <span className="mx-1.5 text-zinc-700">·</span>
              {discovery.companySize} employees
            </p>
          </div>
        </div>

        {/* Tagline */}
        <p
          className="rounded-lg border-l-2 bg-white/[0.02] py-2 pl-3 pr-2 text-[12.5px] italic leading-relaxed text-zinc-300"
          style={{ borderColor: palette.primary }}
        >
          {discovery.tagline}
        </p>

        <Field
          icon={<Building2 className="h-3.5 w-3.5" strokeWidth={2} />}
          label="Business model"
        >
          {discovery.businessModel}
        </Field>

        <Field
          icon={<Layers className="h-3.5 w-3.5" strokeWidth={2} />}
          label="Offerings"
        >
          <TagRow items={discovery.offerings} accent={palette.primary} />
        </Field>

        <Field
          icon={<Target className="h-3.5 w-3.5" strokeWidth={2} />}
          label="Operational signals"
        >
          <ul className="space-y-1">
            {discovery.operationalSignals.map((signal) => (
              <li key={signal} className="flex gap-2">
                <span
                  className="mt-[6px] h-1 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: palette.accent }}
                />
                <span>{signal}</span>
              </li>
            ))}
          </ul>
        </Field>
      </div>
    </CardShell>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 — Problem                                                    */
/* ------------------------------------------------------------------ */

const severityStyles: Record<
  ProblemSeverity,
  { label: string; color: string }
> = {
  low: { label: "Low severity", color: "#38BDF8" },
  medium: { label: "Medium severity", color: "#FBBF24" },
  high: { label: "High severity", color: "#FB923C" },
  critical: { label: "Critical severity", color: "#F43F5E" },
};

export function ProblemCard({ problem }: { problem: ProblemOutput }) {
  const severity = severityStyles[problem.severity];

  return (
    <CardShell step="02" title="Problem" accent={severity.color}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[15px] font-semibold text-zinc-100">
            {problem.title}
          </h3>
          <span
            className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
            style={{
              borderColor: `${severity.color}40`,
              backgroundColor: `${severity.color}14`,
              color: severity.color,
            }}
          >
            <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.5} />
            {severity.label}
          </span>
        </div>

        <p className="text-[12.5px] leading-relaxed text-zinc-300">
          {problem.summary}
        </p>

        {/* Impact strip */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-velho-line bg-white/[0.02] p-3">
            <div className="flex items-center gap-1.5 text-zinc-600">
              <Clock className="h-3 w-3" strokeWidth={2.25} />
              <span className="text-[10px] font-medium uppercase tracking-wider">
                Hours lost / week
              </span>
            </div>
            <p className="mt-1 font-mono text-[19px] font-semibold tabular-nums text-zinc-100">
              {problem.impact.hoursLostPerWeek}
            </p>
          </div>

          <div className="rounded-xl border border-velho-line bg-white/[0.02] p-3">
            <div className="flex items-center gap-1.5 text-zinc-600">
              <TrendingDown className="h-3 w-3" strokeWidth={2.25} />
              <span className="text-[10px] font-medium uppercase tracking-wider">
                Estimated cost
              </span>
            </div>
            <p className="mt-1 text-[13px] font-semibold leading-snug text-zinc-100">
              {problem.impact.estimatedCost}
            </p>
          </div>
        </div>

        <Field
          icon={<Building2 className="h-3.5 w-3.5" strokeWidth={2} />}
          label="Department"
        >
          {problem.department}
        </Field>

        <Field
          icon={<AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />}
          label="Symptoms"
        >
          <ul className="space-y-1">
            {problem.symptoms.map((symptom) => (
              <li key={symptom} className="flex gap-2">
                <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-rose-400/70" />
                <span>{symptom}</span>
              </li>
            ))}
          </ul>
        </Field>

        <Field
          icon={<Plug className="h-3.5 w-3.5" strokeWidth={2} />}
          label="Broken systems"
        >
          <TagRow items={problem.brokenSystems} accent={severity.color} />
        </Field>

        <div className="rounded-lg border border-velho-line bg-white/[0.02] p-3">
          <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-600">
            Cost of inaction
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-400">
            {problem.impact.risk}
          </p>
        </div>
      </div>
    </CardShell>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 — Solution                                                   */
/* ------------------------------------------------------------------ */

export function SolutionCard({
  solution,
  accent,
}: {
  solution: SolutionOutput;
  accent: string;
}) {
  return (
    <CardShell step="03" title="Solution Architecture" accent={accent}>
      <div className="space-y-4">
        <div>
          <h3 className="text-[15px] font-semibold text-zinc-100">
            {solution.architectureName}
          </h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-300">
            {solution.summary}
          </p>
        </div>

        {/* Headline metric */}
        <div
          className="flex items-center justify-between gap-3 rounded-xl border p-3"
          style={{
            borderColor: `${accent}33`,
            backgroundColor: `${accent}0f`,
          }}
        >
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
              {solution.headlineMetric.label}
            </p>
            <p className="mt-0.5 truncate text-[13px] font-semibold text-zinc-100">
              {solution.headlineMetric.value}
            </p>
          </div>
          <span
            className="shrink-0 rounded-lg px-2.5 py-1 font-mono text-[12px] font-bold"
            style={{ backgroundColor: `${accent}22`, color: accent }}
          >
            {solution.headlineMetric.delta}
          </span>
        </div>

        {/* 3-step architecture */}
        <ol className="space-y-2">
          {solution.steps.map((step, index) => (
            <motion.li
              key={step.order}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3, delay: index * 0.08 }}
              className="relative rounded-xl border border-velho-line bg-white/[0.02] p-3"
            >
              <div className="flex items-center gap-2">
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold"
                  style={{ backgroundColor: `${accent}1f`, color: accent }}
                >
                  {step.order}
                </span>
                <h4 className="text-[13px] font-semibold text-zinc-100">
                  {step.title}
                </h4>
                <span className="ml-auto shrink-0 rounded-md border border-velho-line px-1.5 py-0.5 text-[10px] text-zinc-500">
                  {step.velhoCapability}
                </span>
              </div>

              <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">
                {step.description}
              </p>

              <div className="mt-2 flex items-center gap-1.5 text-[11.5px] font-medium">
                <ArrowRight
                  className="h-3 w-3 shrink-0"
                  strokeWidth={2.5}
                  style={{ color: accent }}
                />
                <span style={{ color: accent }}>{step.outcome}</span>
              </div>
            </motion.li>
          ))}
        </ol>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            icon={<Plug className="h-3.5 w-3.5" strokeWidth={2} />}
            label="Integrations"
          >
            <TagRow items={solution.integrations} accent={accent} />
          </Field>

          <Field
            icon={<Clock className="h-3.5 w-3.5" strokeWidth={2} />}
            label="Time to value"
          >
            {solution.timeToValue}
          </Field>
        </div>
      </div>
    </CardShell>
  );
}
