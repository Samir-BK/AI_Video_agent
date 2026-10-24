"use client";

import { useEffect, useState } from "react";
import { ArrowRight, CheckCircle2, ExternalLink, Globe, Loader2, TriangleAlert } from "lucide-react";

import type {
  CompanySummary,
  DomainResolution,
  OutreachLanguage,
} from "@/types/outreach";

interface SelectedCompanyProps {
  company: CompanySummary;
}

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

const cleanDomain = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0] ?? "";

const OUTCOME_LABEL: Record<DomainResolution["checks"][number]["outcome"], string> = {
  registered: "registered in PRH",
  verified: "verified on homepage",
  name_not_found: "site found, company name not on it",
  unreachable: "no response",
  no_dns: "does not exist",
};

/**
 * The picked company: register details, website resolution (registered or
 * verified — never a raw guess), and the hand-off to the outreach flow with
 * the exact business ID.
 */
export default function SelectedCompany({ company }: SelectedCompanyProps) {
  const [resolution, setResolution] = useState<DomainResolution | null>(null);
  const [resolving, setResolving] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [manualDomain, setManualDomain] = useState("");
  const [language, setLanguage] = useState<OutreachLanguage>("en");

  useEffect(() => {
    const controller = new AbortController();
    setResolving(true);
    setResolution(null);
    setError(null);
    fetch(`/api/outreach/search/resolve?businessId=${encodeURIComponent(company.businessId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = (await response.json()) as {
          resolution?: DomainResolution;
          error?: string;
        };
        if (payload.resolution) setResolution(payload.resolution);
        else setError(payload.error ?? "Could not check the website");
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError("Could not check the website (network error)");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setResolving(false);
      });
    return () => controller.abort();
  }, [company.businessId]);

  const manual = cleanDomain(manualDomain);
  const manualValid = DOMAIN_PATTERN.test(manual);
  const domain = resolution?.domain ?? (manualValid ? manual : null);

  const outreachHref = domain
    ? `/outreach?${new URLSearchParams({
        domain,
        businessId: company.businessId,
        lang: language,
        auto: "1",
      }).toString()}`
    : null;

  const inactive = company.status !== "active";

  return (
    <section className="space-y-4 rounded-2xl border border-velho-line bg-velho-panel p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-zinc-50">{company.name}</h2>
        <p className="text-xs text-zinc-400">
          {[
            company.businessId,
            company.city,
            company.businessLine,
            company.companyForm,
            company.registeredBefore1978
              ? "registered before 1978"
              : company.registeredSince
                ? `registered ${company.registeredSince}`
                : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {company.previousNames.length > 0 && (
          <p className="text-xs text-velho-muted">Formerly: {company.previousNames.join(", ")}</p>
        )}
        <a
          href={company.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200"
        >
          Trade register page <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      </div>

      {inactive && (
        <p className="flex items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          This company is {company.status === "ended" ? "dissolved" : `in ${company.status}`} — not a
          prospect.
        </p>
      )}

      <div className="space-y-2 rounded-xl border border-velho-line bg-velho-ink p-4 text-sm">
        <p className="flex items-center gap-2 font-medium text-zinc-200">
          <Globe className="h-4 w-4 text-sky-300" aria-hidden /> Website
        </p>
        {resolving ? (
          <p className="flex items-center gap-2 text-xs text-zinc-400" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Checking the registered
            website and verified domain candidates…
          </p>
        ) : resolution?.domain ? (
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-zinc-100">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />
              {resolution.domain}
              <span className="text-xs text-velho-muted">
                {resolution.method === "registered"
                  ? "registered in the trade register"
                  : "verified: the homepage names this company"}
              </span>
            </p>
            {resolution.evidence && (
              <p className="text-xs italic text-zinc-400">&ldquo;{resolution.evidence}&rdquo;</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-amber-200">
              {error ?? "Website not found. No candidate could be verified, so none is guessed."}
            </p>
            <label className="block text-xs text-zinc-400">
              Enter the website yourself
              <input
                value={manualDomain}
                onChange={(event) => setManualDomain(event.target.value)}
                placeholder="example.fi"
                className="mt-1 w-full rounded-lg border border-velho-line bg-velho-panel px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500"
              />
            </label>
          </div>
        )}
        {resolution && resolution.checks.length > 0 && (
          <details className="text-xs text-zinc-400">
            <summary className="cursor-pointer text-zinc-300">
              Checked {resolution.checks.length} candidate(s) in {(resolution.durationMs / 1000).toFixed(1)} s
            </summary>
            <ul className="mt-1 space-y-0.5">
              {resolution.checks.map((check) => (
                <li key={check.domain}>
                  {check.domain} — {OUTCOME_LABEL[check.outcome]}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value as OutreachLanguage)}
          aria-label="Email language"
          className="rounded-xl border border-velho-line bg-velho-ink px-3 py-3 text-sm text-zinc-100"
        >
          <option value="en">English</option>
          <option value="fi">Suomi</option>
        </select>
        {outreachHref && !inactive ? (
          <a
            href={outreachHref}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-400"
          >
            <ArrowRight className="h-4 w-4" aria-hidden /> Research &amp; write
          </a>
        ) : (
          <span className="text-xs text-velho-muted">
            {inactive
              ? "Outreach is disabled for inactive companies."
              : resolving
                ? "Waiting for the website check…"
                : "Add a website to continue."}
          </span>
        )}
      </div>
    </section>
  );
}
