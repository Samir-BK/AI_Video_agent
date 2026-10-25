"use client";

import { CalendarCheck, ChevronDown, ExternalLink } from "lucide-react";

import VideoPlayer from "@/app/components/VideoPlayer";
import type {
  DiscoveryOutput,
  ProblemOutput,
  SolutionOutput,
  VideoScriptOutput,
} from "@/types/pipeline";
import type { CostEstimate, ExecRole, OutreachLanguage, SourcedFact } from "@/types/outreach";

interface VideoLandingProps {
  role: ExecRole;
  language: OutreachLanguage;
  companyName: string;
  discovery: DiscoveryOutput;
  problem: ProblemOutput;
  solution: SolutionOutput;
  videoScript: VideoScriptOutput;
  estimate: CostEstimate;
  facts: SourcedFact[];
  bookingUrl: string;
}

/** Page labels. The video itself (legacy player) is English-only for now. */
const COPY = {
  en: {
    madeFor: "Made for",
    fallbackHeadline: (company: string) => `A 45-second idea for ${company}`,
    statedGoal: "Your stated goal:",
    estimatedCost: "Estimated cost",
    perMonth: "/month",
    hoursPerMonth: "h/month",
    shareOfProfit: "Share of operating profit",
    shareNote: "Yearly estimate vs. last reported operating profit",
    teamHours: "Team hours to free up",
    manualHours: "Hours tied up in manual work",
    where: "Where",
    notHeadcount: "The goal is to free up your team's hours, not to add headcount.",
    book: "Book 15 minutes",
    sources: "Sources",
    footer: (company: string) =>
      `Velho · Built from public information about ${company}. Figures marked “assumption” are estimates.`,
  },
  fi: {
    madeFor: "Tehty yritykselle",
    fallbackHeadline: (company: string) => `45 sekunnin idea: ${company}`,
    statedGoal: "Julkaistu tavoitteenne:",
    estimatedCost: "Arvioitu kustannus",
    perMonth: "/kk",
    hoursPerMonth: "h/kk",
    shareOfProfit: "Osuus liikevoitosta",
    shareNote: "Vuosiarvio suhteessa viimeisimpään liikevoittoon",
    teamHours: "Vapautettavat tiimin tunnit",
    manualHours: "Manuaaliseen työhön kuluvat tunnit",
    where: "Missä",
    notHeadcount: "Tavoitteena on vapauttaa tiiminne tunteja, ei lisätä henkilöstöä.",
    book: "Varaa 15 minuuttia",
    sources: "Lähteet",
    footer: (company: string) =>
      `Velho · Koottu julkisista tiedoista (${company}). Merkinnällä ”oletus” olevat luvut ovat arvioita.`,
  },
} as const;

const eur = (amount: number, language: OutreachLanguage): string =>
  new Intl.NumberFormat(language === "fi" ? "fi-FI" : "en-IE", {
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
  language,
  companyName,
  discovery,
  problem,
  solution,
  videoScript,
  estimate,
  facts,
  bookingUrl,
}: VideoLandingProps) {
  const t = COPY[language];
  const goal = facts.find((fact) => fact.kind === "strategy_goal");

  const numbers: { label: string; value: string; note: string }[] =
    role === "CFO"
      ? [
          {
            label: t.estimatedCost,
            value: `${eur(estimate.eurPerMonth, language)}${t.perMonth}`,
            note: estimate.formula,
          },
          ...(estimate.shareOfOperatingProfitPct !== null
            ? [
                {
                  label: t.shareOfProfit,
                  value: `≈${estimate.shareOfOperatingProfitPct}%`,
                  note: t.shareNote,
                },
              ]
            : []),
        ]
      : [
          {
            label: role === "COO" ? t.teamHours : t.manualHours,
            value: `≈${estimate.hoursPerMonth} ${t.hoursPerMonth}`,
            note: estimate.formula,
          },
          { label: t.where, value: problem.title, note: problem.department },
        ];

  return (
    <main
      lang={language}
      className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:py-12"
    >
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-velho-muted">
          {t.madeFor} {companyName}
        </p>
        <h1 className="text-2xl font-semibold leading-tight text-zinc-50 sm:text-3xl">
          {videoScript.headline || t.fallbackHeadline(companyName)}
        </h1>
        {goal && (
          <p className="text-sm text-zinc-300">
            {t.statedGoal} <span className="text-zinc-100">{goal.text}</span>
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
        {solution.summary} {t.notHeadcount}
      </p>

      <a
        href={bookingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-4 text-base font-semibold text-white transition hover:bg-sky-400"
      >
        <CalendarCheck className="h-5 w-5" />
        {t.book}
      </a>

      {facts.length > 0 && (
        <details className="group rounded-xl border border-velho-line bg-velho-ink px-4 py-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between text-zinc-200">
            {t.sources} ({facts.length})
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

      <footer className="pt-2 text-xs text-velho-muted">{t.footer(companyName)}</footer>
    </main>
  );
}
