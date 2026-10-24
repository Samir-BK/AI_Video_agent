"use client";

import { Building2, ExternalLink, ShieldCheck, Users } from "lucide-react";

import type { EntityCandidate, OutreachResult, Sufficiency } from "@/types/outreach";

interface ResearchPanelProps {
  result: OutreachResult;
  onPickCompany: (candidate: EntityCandidate) => void;
  disabled: boolean;
}

const SUFFICIENCY_STYLE: Record<Sufficiency, { label: string; className: string }> = {
  ready: { label: "Ready — enough verified facts", className: "bg-emerald-500/15 text-emerald-300" },
  weak: { label: "Weak — CEO email only, low confidence", className: "bg-amber-500/15 text-amber-300" },
  insufficient: {
    label: "Insufficient — do not send",
    className: "bg-rose-500/15 text-rose-300",
  },
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export default function ResearchPanel({ result, onPickCompany, disabled }: ResearchPanelProps) {
  const { entity, leaders, facts, sufficiency } = result;
  const style = SUFFICIENCY_STYLE[sufficiency];

  return (
    <section className="space-y-5 rounded-2xl border border-velho-line bg-velho-panel p-5">
      <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Building2 className="h-4 w-4 text-sky-300" /> Company
        </h2>
        {entity.candidate ? (
          <p className="text-sm text-zinc-200">
            {entity.candidate.name}{" "}
            <span className="text-velho-muted">({entity.candidate.businessId})</span>
            <span className="ml-2 rounded-full bg-zinc-700/40 px-2 py-0.5 text-xs text-zinc-300">
              {entity.confidence} confidence
            </span>
          </p>
        ) : (
          <p className="text-sm text-amber-200">No trade-register match.</p>
        )}
        <p className="text-xs text-velho-muted">{entity.note}</p>
        {entity.alternatives.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="text-xs text-velho-muted">Wrong company? Pick:</span>
            {entity.alternatives.map((candidate) => (
              <button
                key={candidate.businessId}
                type="button"
                disabled={disabled}
                onClick={() => onPickCompany(candidate)}
                className="rounded-full border border-velho-line px-2.5 py-1 text-xs text-zinc-200 hover:bg-velho-ink disabled:opacity-50"
              >
                {candidate.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-sky-300" />
        <span className={`rounded-full px-2.5 py-1 text-xs ${style.className}`}>{style.label}</span>
        <span className="text-xs text-velho-muted">
          {facts.length} verified · {result.rejectedFacts} rejected (quote not found)
        </span>
      </div>

      <div className="space-y-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <Users className="h-4 w-4 text-sky-300" /> Leadership
        </h2>
        <ul className="space-y-1 text-sm">
          {leaders.map((leader) => (
            <li key={leader.role} className="text-zinc-200">
              <span className="inline-block w-12 text-xs text-velho-muted">{leader.role}</span>
              {leader.name ? (
                <>
                  {leader.name} <span className="text-velho-muted">— {leader.title}</span>
                  {leader.evidence && (
                    <a
                      href={leader.evidence.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 text-xs text-sky-300"
                    >
                      source
                    </a>
                  )}
                </>
              ) : (
                <span className="text-velho-muted">not found</span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-zinc-100">Verified facts</h2>
        {facts.length === 0 ? (
          <p className="text-xs text-velho-muted">No verified facts.</p>
        ) : (
          <ul className="space-y-3">
            {facts.map((fact) => (
              <li key={fact.id} className="space-y-0.5 text-sm">
                <p className="text-zinc-200">
                  <span className="mr-2 rounded bg-zinc-700/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-300">
                    {fact.kind.replace("_", " ")}
                  </span>
                  {fact.text}
                </p>
                <p className="text-xs italic text-zinc-400">&ldquo;{fact.quote}&rdquo;</p>
                <a
                  href={fact.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-sky-300"
                >
                  {hostOf(fact.sourceUrl)} <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="text-xs text-zinc-400">
        <summary className="cursor-pointer text-zinc-300">Research log</summary>
        <ul className="mt-2 space-y-1">
          {result.researchLog.map((entry, index) => (
            <li key={`${entry.source}-${index}`}>
              <span className={entry.ok ? "text-emerald-300" : "text-amber-300"}>
                {entry.ok ? "✓" : "!"}
              </span>{" "}
              <span className="text-zinc-300">{entry.source}:</span> {entry.note}
            </li>
          ))}
          <li>LLM calls this run: {result.llmCalls}</li>
        </ul>
      </details>
    </section>
  );
}
