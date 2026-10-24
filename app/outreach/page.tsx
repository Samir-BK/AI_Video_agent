"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, KeyRound, Loader2, PlayCircle, Radar } from "lucide-react";

import ResearchPanel from "@/app/outreach/components/ResearchPanel";
import RoleSwitcher from "@/app/outreach/components/RoleSwitcher";
import CompanyInput, { looksLikeDomain } from "@/app/outreach/components/search/CompanyInput";
import CriteriaSearch from "@/app/outreach/components/search/CriteriaSearch";
import HistorySearch from "@/app/outreach/components/search/HistorySearch";
import SelectedCompany from "@/app/outreach/components/search/SelectedCompany";
import type {
  CompanySummary,
  EntityCandidate,
  ExecRole,
  RoleEmailStatus,
  OutreachLanguage,
  OutreachProgressEvent,
  OutreachResult,
  OutreachStreamEvent,
} from "@/types/outreach";
import { emptyRoleCounts } from "@/types/outreach";

/**
 * Outreach dashboard: find a company (by domain, by name, by criteria, or in
 * history), review the verified facts, and get role-personalized emails that
 * link to the company's video page. Everything happens on this one page.
 * Separate from the main dashboard (app/page.tsx), which is left unchanged.
 */

// nurminenlogistics.com answers 403 to server requests, so Berner replaces it.
const SAMPLE_DOMAINS = ["tamtron.fi", "berner.fi", "sini.fi"];

type Tab = "research" | "criteria" | "history";

const TABS: { id: Tab; label: string }[] = [
  { id: "research", label: "Research a company" },
  { id: "criteria", label: "Find by criteria" },
  { id: "history", label: "History" },
];

function OutreachPage() {
  const [tab, setTab] = useState<Tab>("research");
  const [query, setQuery] = useState("");
  const [selectedCompany, setSelectedCompany] = useState<CompanySummary | null>(null);
  const [autoRunSelected, setAutoRunSelected] = useState(false);
  const [language, setLanguage] = useState<OutreachLanguage>("en");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<OutreachProgressEvent[]>([]);
  const [result, setResult] = useState<OutreachResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [views, setViews] = useState<Record<ExecRole, number>>(emptyRoleCounts());
  const [statuses, setStatuses] = useState<Record<string, RoleEmailStatus>>({});
  const [adminSecret, setAdminSecret] = useState("");

  // The admin secret lives only in this browser tab's session.
  useEffect(() => {
    try {
      setAdminSecret(sessionStorage.getItem("velho-admin-secret") ?? "");
    } catch {
      // Storage blocked: the operator can still type it each time.
    }
  }, []);

  const updateSecret = (value: string) => {
    setAdminSecret(value);
    try {
      sessionStorage.setItem("velho-admin-secret", value);
    } catch {
      // Ignore storage failures.
    }
  };

  // Poll video views and email statuses (sent / opted out) every 10 s.
  useEffect(() => {
    if (!result) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/outreach/views?domain=${encodeURIComponent(result.domain)}`,
          { cache: "no-store" },
        );
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as {
          views: Record<ExecRole, number>;
          statuses: Record<string, RoleEmailStatus>;
        };
        setViews(payload.views);
        setStatuses(payload.statuses);
      } catch {
        // Keep the last known numbers.
      }
    };
    void poll();
    const timer = setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [result]);

  const updateStatus = (token: string, status: RoleEmailStatus) =>
    setStatuses((prev) => ({ ...prev, [token]: status }));

  /**
   * Research a domain. `keepResult` is for re-runs of the same company with a
   * different register match; a new company always starts from a clean slate.
   */
  const run = useCallback(
    async (
      target: string,
      businessId?: string,
      languageOverride?: OutreachLanguage,
      keepResult = false,
    ) => {
      const cleaned = target.trim();
      if (!cleaned) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setTab("research");
      setRunning(true);
      setError(null);
      setProgress([]);
      if (!keepResult) setResult(null);

      try {
        const response = await fetch("/api/outreach", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain: cleaned,
            businessId,
            language: languageOverride ?? language,
          }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(payload?.error ?? `Request failed (${response.status})`);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const event = JSON.parse(line.slice(6)) as OutreachStreamEvent;
            if (event.type === "progress") setProgress((prev) => [...prev, event]);
            else if (event.type === "result") setResult(event.result);
            else setError(event.message);
          }
        }
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError("Connection lost while researching. Try again.");
        }
      } finally {
        setRunning(false);
      }
    },
    [language],
  );

  /** "Wrong company?" in the research panel: re-run with that business ID. */
  const pickCompany = (candidate: EntityCandidate) => {
    void run(result?.domain ?? query, candidate.businessId, undefined, true);
  };

  /** A domain typed into the smart input runs straight away. */
  const runDomain = (domain: string) => {
    setSelectedCompany(null);
    void run(domain);
  };

  /** A company picked by name: show its card (website check) first. */
  const selectByName = (company: CompanySummary) => {
    setResult(null);
    setProgress([]);
    setError(null);
    setAutoRunSelected(false);
    setSelectedCompany(company);
  };

  /** A company picked from the criteria list: back to research, start once verified. */
  const selectFromList = (company: CompanySummary) => {
    setTab("research");
    setQuery(company.name);
    setResult(null);
    setProgress([]);
    setError(null);
    setAutoRunSelected(true);
    setSelectedCompany(company);
  };

  const researchSelected = useCallback(
    (domain: string, businessId: string) => {
      void run(domain, businessId);
    },
    [run],
  );

  /** Reopen a stored run (history, or ?view=) without researching again. */
  const openStored = useCallback(async (domain: string) => {
    abortRef.current?.abort();
    setTab("research");
    setSelectedCompany(null);
    setProgress([]);
    setError(null);
    setQuery(domain);
    try {
      const response = await fetch(`/api/outreach/result?domain=${encodeURIComponent(domain)}`);
      const payload = (await response.json()) as { result?: OutreachResult; error?: string };
      if (payload.result) {
        setResult(payload.result);
        setLanguage(payload.result.language);
      } else {
        setResult(null);
        setError(payload.error ?? "Stored result not found");
      }
    } catch {
      setError("Could not load the stored result.");
    }
  }, []);

  // Deep links: ?view=<domain> reopens a stored run;
  // ?domain=&businessId=&lang=&auto=1 starts a run.
  const searchParams = useSearchParams();
  const handledParams = useRef(false);
  useEffect(() => {
    if (handledParams.current) return;
    handledParams.current = true;

    const viewDomain = searchParams.get("view") ?? "";
    if (viewDomain) {
      void openStored(viewDomain);
      return;
    }

    const paramDomain = searchParams.get("domain") ?? "";
    if (!paramDomain) return;
    const paramLanguage: OutreachLanguage = searchParams.get("lang") === "fi" ? "fi" : "en";
    const paramBusinessId = searchParams.get("businessId") ?? undefined;
    setQuery(paramDomain);
    setLanguage(paramLanguage);
    if (searchParams.get("auto") === "1") {
      void run(paramDomain, paramBusinessId, paramLanguage);
    }
  }, [searchParams, run, openStored]);

  const isDomain = looksLikeDomain(query);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="space-y-1">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-velho-muted">
          <Radar className="h-4 w-4" /> Velho Outreach
        </p>
        <h1 className="text-2xl font-semibold text-zinc-50">
          Role-personalized video emails
        </h1>
        <p className="text-sm text-zinc-400">
          Public, sourced facts only. Every quote is checked against its source before it can
          appear in an email. Emails are drafts: download or open them in your mail app.
          Sending needs an admin secret and runs as a dry run to a test inbox by default.
        </p>
        <label className="mt-2 flex max-w-sm items-center gap-2 rounded-lg border border-velho-line bg-velho-ink px-3 py-2 text-xs text-zinc-300">
          <KeyRound className="h-3.5 w-3.5 shrink-0 text-velho-muted" />
          <input
            type="password"
            value={adminSecret}
            onChange={(event) => updateSecret(event.target.value)}
            placeholder="Admin secret (only needed to send)"
            autoComplete="off"
            className="w-full bg-transparent outline-none placeholder:text-velho-muted"
          />
        </label>
      </header>

      <div role="tablist" aria-label="Outreach mode" className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            onClick={() => setTab(item.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
              tab === item.id
                ? "bg-sky-500 text-white"
                : "border border-velho-line text-zinc-200 hover:bg-velho-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Research tab ------------------------------------------------------ */}
      <section
        id="panel-research"
        role="tabpanel"
        aria-labelledby="tab-research"
        hidden={tab !== "research"}
        className="flex flex-col gap-6"
      >
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-start"
          onSubmit={(event) => {
            event.preventDefault();
            if (isDomain) runDomain(query.trim());
          }}
        >
          <CompanyInput
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              if (selectedCompany && value !== selectedCompany.name) setSelectedCompany(null);
            }}
            onSubmitDomain={runDomain}
            onSelectCompany={selectByName}
            disabled={running}
          />
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as OutreachLanguage)}
            aria-label="Email language"
            className="rounded-xl border border-velho-line bg-velho-ink px-3 py-3 text-sm text-zinc-100"
          >
            <option value="en">English</option>
            <option value="fi">Suomi</option>
          </select>
          <button
            type="submit"
            disabled={running || !isDomain}
            title={isDomain ? undefined : "Type a domain, or pick a company from the suggestions"}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            {running ? "Researching…" : "Research & write"}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-velho-muted">Try:</span>
          {SAMPLE_DOMAINS.map((sample) => (
            <button
              key={sample}
              type="button"
              disabled={running}
              onClick={() => {
                setQuery(sample);
                runDomain(sample);
              }}
              className="rounded-full border border-velho-line px-3 py-1 text-zinc-300 hover:bg-velho-ink disabled:opacity-50"
            >
              {sample}
            </button>
          ))}
          <span className="text-velho-muted">· or type a company name, e.g. Berner</span>
        </div>

        {selectedCompany && !result && (
          <SelectedCompany
            key={selectedCompany.businessId}
            company={selectedCompany}
            onResearch={researchSelected}
            autoRun={autoRunSelected}
            running={running}
          />
        )}

        {error && (
          <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </p>
        )}

        {progress.length > 0 && (
          <ol className="space-y-1 rounded-2xl border border-velho-line bg-velho-panel p-4 text-xs text-zinc-300">
            {progress.map((event, index) => (
              <li key={`${event.stage}-${index}`} className="flex gap-3">
                <span className="w-12 shrink-0 text-right font-mono text-velho-muted">
                  {(event.at / 1000).toFixed(1)}s
                </span>
                <span>{event.message}</span>
              </li>
            ))}
            {running && (
              <li className="flex items-center gap-2 pl-[3.75rem] text-velho-muted">
                <Loader2 className="h-3 w-3 animate-spin" /> working…
              </li>
            )}
          </ol>
        )}

        {result && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <ResearchPanel result={result} onPickCompany={pickCompany} disabled={running} />

            <div className="space-y-4">
              {result.usedFallback && (
                <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
                  Some parts used fallback content (no LLM key, timeout, or validation). They are
                  labelled below.
                </p>
              )}
              <div className="rounded-xl border border-velho-line bg-velho-ink px-4 py-3 text-xs text-zinc-300">
                Estimate shown to executives: {result.estimate.formula}
              </div>
              {result.emails.length === 0 ? (
                <p className="rounded-2xl border border-velho-line bg-velho-panel p-5 text-sm text-zinc-300">
                  No email written: there is not enough verified public information about this
                  company. Check the research log, or pick a different company match.
                </p>
              ) : (
                <RoleSwitcher
                  key={result.createdAt}
                  emails={result.emails}
                  leaders={result.leaders}
                  views={views}
                  statuses={statuses}
                  adminSecret={adminSecret}
                  onStatus={updateStatus}
                />
              )}
              <a
                href={`/v/${encodeURIComponent(result.domain)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-sm text-sky-300 hover:text-sky-200"
              >
                <PlayCircle className="h-4 w-4" /> Open the video page
              </a>
            </div>
          </div>
        )}
      </section>

      {/* Criteria tab: kept mounted so results survive switching tabs ----- */}
      <section
        id="panel-criteria"
        role="tabpanel"
        aria-labelledby="tab-criteria"
        hidden={tab !== "criteria"}
      >
        <CriteriaSearch onPick={selectFromList} />
      </section>

      {/* History tab ------------------------------------------------------- */}
      <section
        id="panel-history"
        role="tabpanel"
        aria-labelledby="tab-history"
        hidden={tab !== "history"}
      >
        <HistorySearch onOpen={(domain) => void openStored(domain)} refreshKey={result?.createdAt} />
      </section>

      <footer className="mt-auto pt-6 text-xs text-velho-muted">
        Company data: Finnish Patent and Registration Office (PRH), YTJ open data, licensed under{" "}
        <a
          href="https://creativecommons.org/licenses/by/4.0/"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-zinc-300"
        >
          CC BY 4.0
        </a>
        .
      </footer>
    </main>
  );
}

/** useSearchParams needs a Suspense boundary for static rendering. */
export default function OutreachPageWrapper() {
  return (
    <Suspense fallback={null}>
      <OutreachPage />
    </Suspense>
  );
}
