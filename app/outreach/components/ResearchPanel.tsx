"use client";

import { Building2, ExternalLink, ShieldCheck, Users } from "lucide-react";

import ShareChannelsButton from "@/app/outreach/components/ShareChannelsButton";
import type { EntityCandidate, OutreachResult, Sufficiency } from "@/types/outreach";
import { CORE_ROLES, ROLE_LABELS } from "@/types/outreach";
import { linkedinSearchUrl } from "@/lib/outreach/pure/linkedin";
import { SOCIAL_LABELS } from "@/lib/outreach/pure/socialShare";

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
  const companyName = entity.candidate?.name ?? result.domain;
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
        <ul className="space-y-1.5 text-sm">
          {/* CEO / COO / CFO always; other roles only when someone was found. */}
          {leaders
            .filter((leader) => CORE_ROLES.includes(leader.role) || leader.name)
            .map((leader) => (
              <li key={leader.role} className="text-zinc-200">
                <span className="inline-block w-28 text-xs text-velho-muted">
                  {ROLE_LABELS[leader.role]}
                </span>
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
                    <span className="ml-28 block text-xs text-velho-muted">
                      {leader.email.address ? (
                        leader.email.method === "guessed" ? (
                          <>
                            {leader.email.address} ·{" "}
                            <span
                              className="rounded-full bg-amber-500/15 px-1.5 text-amber-300"
                              title="No address format is published anywhere, so this uses the most common Finnish format (firstname.lastname@). The domain accepts mail, but this address may not exist."
                            >
                              guessed — unverified
                            </span>
                          </>
                        ) : (
                          `${leader.email.address} · ${
                            leader.email.method === "published"
                              ? "published by the company"
                              : "from the company's published address format"
                          }`
                        )
                      ) : (
                        "no work address found"
                      )}
                      {leader.linkedinUrl && (
                        <>
                          {" · "}
                          <a
                            href={leader.linkedinUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sky-300"
                          >
                            LinkedIn (linked on the company site)
                          </a>
                        </>
                      )}
                    </span>
                    <span className="ml-28 mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                      {!leader.linkedinUrl && leader.linkedinSuggestion && (
                        <a
                          href={leader.linkedinSuggestion}
                          target="_blank"
                          rel="noreferrer"
                          title="Found by web search: the name is in the profile title and the company in its title or snippet. People share names — check it before use."
                          className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-300"
                        >
                          LinkedIn? unverified — check before use
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {!leader.linkedinUrl && (
                        <a
                          href={linkedinSearchUrl(leader.name, companyName)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full border border-velho-line px-2 py-0.5 text-zinc-300 hover:bg-velho-ink"
                        >
                          Search on LinkedIn
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </span>
                  </>
                ) : (
                  <span className="text-velho-muted">not found</span>
                )}
              </li>
            ))}
        </ul>
      </div>

      {result.companySocials && result.companySocials.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-zinc-100">Official company accounts</h2>
          <div className="flex flex-wrap gap-2">
            {result.companySocials.map((link) => (
              <a
                key={link.url}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-full border border-velho-line px-2.5 py-1 text-xs text-zinc-200 hover:bg-velho-ink"
              >
                {SOCIAL_LABELS[link.platform]} · {link.url.replace(/^https?:\/\/(www\.)?/, "")}
                <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
          <ShareChannelsButton
            companyName={companyName}
            videoUrl={`/v/${encodeURIComponent(result.domain)}`}
            callToAction="Watch the 45-second walkthrough and book a 15-minute meeting."
            socials={result.companySocials}
          />
          <p className="text-xs text-velho-muted">
            Linked from the company&apos;s own website. Personal Instagram, Facebook and similar
            accounts are not looked up. The share button copies the video pitch and opens each
            official account — it cannot send DMs for you.
          </p>
        </div>
      )}

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
