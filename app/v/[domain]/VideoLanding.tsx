"use client";

import { CalendarCheck, ChevronDown, ExternalLink, Info } from "lucide-react";

import VideoPlayer from "@/app/components/VideoPlayer";
import type {
  DiscoveryOutput,
  ProblemOutput,
  SolutionOutput,
  VideoScriptOutput,
} from "@/types/pipeline";
import type { CostEstimate, ExecRole, SourcedFact } from "@/types/outreach";

interface VideoLandingProps {
  role: ExecRole;
  companyName: string;
  discovery: DiscoveryOutput;
  problem: ProblemOutput;
  solution: SolutionOutput;
  videoScript: VideoScriptOutput;
  estimate: CostEstimate;
  facts: SourcedFact[];
  bookingUrl: string;
  /** True when no research is stored and the page shows sample content. */
  isPreview: boolean;
}

const eur = (amount: number): string =>
  new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export default function VideoLanding({
  role,
  companyName,
  discovery,
  problem,
  solution,
  videoScript,
  estimate,
  facts,
  bookingUrl,
  isPreview,
}: VideoLandingProps) {
  const goal = facts.find((fact) => fact.kind === "strategy_goal");

  const numbers: { label: string; value: string; note: string }[] =
    role === "CFO"
      ? [
          { label: "Estimated cost", value: `${eur(estimate.eurPerMonth)}/month`, note: estimate.formula },
          ...(estimate.shareOfOperatingProfitPct !== null
            ? [
                {
                  label: "Share of operating profit",
                  value: `≈${estimate.shareOfOperatingProfitPct}%`,
                  note: "Yearly estimate vs. last reported operating profit",
                },
              ]
            : []),
        ]
      : [
          {
            label: role === "COO" ? "Team hours to free up" : "Hours tied up in manual work",
            value: `≈${estimate.hoursPerMonth} h/month`,
            note: estimate.formula,
          },
          { label: "Where", value: problem.title, note: problem.department },
        ];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12">
      {isPreview && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Preview with sample content — no research has been run for this company yet.
          </span>
        </div>
      )}

      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-velho-muted">
          Made for {companyName}
        </p>
        <h1 className="text-2xl font-semibold leading-tight text-zinc-50 sm:text-3xl">
          {videoScript.headline || `A 45-second idea for ${companyName}`}
        </h1>
        {goal && (
          <p className="text-sm text-zinc-300">
            Your stated goal: <span className="text-zinc-100">{goal.text}</span>
          </p>
        )}
      </header>

      <section className="overflow-hidden rounded-2xl border border-velho-line bg-velho-panel">
        <VideoPlayer
          script={videoScript}
          discovery={discovery}
          problem={problem}
          solution={solution}
        />
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        {numbers.map((item) => (
          <div
            key={item.label}
            className="rounded-xl border border-velho-line bg-velho-ink px-4 py-3"
          >
            <p className="text-xs uppercase tracking-wider text-velho-muted">{item.label}</p>
            <p className="mt-1 text-lg font-semibold text-zinc-50">{item.value}</p>
            <p className="mt-1 text-xs text-zinc-400">{item.note}</p>
          </div>
        ))}
      </section>

      <p className="text-sm leading-relaxed text-zinc-300">
        {solution.summary} The goal is to free up your team&apos;s hours, not to add
        headcount.
      </p>

      <a
        href={bookingUrl}
        className="flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-4 text-base font-semibold text-white transition hover:bg-sky-400"
      >
        <CalendarCheck className="h-5 w-5" />
        Book 15 minutes
      </a>

      {facts.length > 0 && (
        <details className="group rounded-xl border border-velho-line bg-velho-ink px-4 py-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between text-zinc-200">
            Sources ({facts.length})
            <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
          </summary>
          <ul className="mt-3 space-y-3">
            {facts.map((fact) => (
              <li key={fact.id} className="space-y-1">
                <p className="text-zinc-200">{fact.text}</p>
                <p className="text-xs italic text-zinc-400">&ldquo;{fact.quote}&rdquo;</p>
                <a
                  href={fact.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200"
                >
                  {hostOf(fact.sourceUrl)} <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      <footer className="pt-2 text-xs text-velho-muted">
        Velho · Built from public information about {companyName}. Figures marked
        &ldquo;assumption&rdquo; are estimates.
      </footer>
    </main>
  );
}
