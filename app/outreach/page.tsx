"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, KeyRound, Loader2, PlayCircle, Radar, Search } from "lucide-react";

import ResearchPanel from "@/app/outreach/components/ResearchPanel";
import RoleSwitcher from "@/app/outreach/components/RoleSwitcher";
import type {
  EntityCandidate,
  ExecRole,
  RoleEmailStatus,
  OutreachLanguage,
  OutreachProgressEvent,
  OutreachResult,
  OutreachStreamEvent,
} from "@/types/outreach";

/**
 * Outreach dashboard: research a company, review the verified facts, and get
 * role-personalized emails that link to the company's video page.
 * Separate from the main dashboard (app/page.tsx), which is left unchanged.
 */

const SAMPLE_DOMAINS = ["tamtron.fi", "nurminenlogistics.com", "sini.fi"];

const DOMAIN_LIKE =
  /^(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/.*)?$/i;

const looksLikeDomain = (value: string): boolean => DOMAIN_LIKE.test(value.trim());

function OutreachPage() {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [language, setLanguage] = useState<OutreachLanguage>("en");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<OutreachProgressEvent[]>([]);
  const [result, setResult] = useState<OutreachResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [views, setViews] = useState<Record<ExecRole, number>>({ CEO: 0, COO: 0, CFO: 0 });
  const [statuses, setStatuses] = useState<Record<string, RoleEmailStatus>>({});
  const [adminSecret, setAdminSecret] = useState("");
  const [dryRun, setDryRun] = useState(true);
  const [mailProvider, setMailProvider] = useState<"gmail" | "resend" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/outreach/send", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { dryRun?: boolean; provider?: "gmail" | "resend" | null } | null) => {
        if (cancelled || !payload) return;
        if (typeof payload.dryRun === "boolean") setDryRun(payload.dryRun);
        setMailProvider(payload.provider ?? null);
      })
      .catch(() => {
        // The send button still reports a clear error if the server is unreachable.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  const run = useCallback(
    async (target: string, businessId?: string, languageOverride?: OutreachLanguage) => {
      const cleaned = target.trim();
      if (!cleaned) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setRunning(true);
      setError(null);
      setProgress([]);
      if (!businessId) setResult(null);

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

  const pickCompany = (candidate: EntityCandidate) => {
    void run(result?.domain ?? domain, candidate.businessId);
  };

  // Hand-off from /outreach/search: ?domain=&businessId=&lang=&auto=1
  const searchParams = useSearchParams();
  const handledParams = useRef(false);
  useEffect(() => {
    if (handledParams.current) return;
    handledParams.current = true;

    // ?view=<domain>: reopen a stored run from history (no new research).
    const viewDomain = searchParams.get("view") ?? "";
    if (viewDomain) {
      setDomain(viewDomain);
      fetch(`/api/outreach/result?domain=${encodeURIComponent(viewDomain)}`)
        .then(async (response) => {
          const payload = (await response.json()) as { result?: OutreachResult; error?: string };
          if (payload.result) {
            setResult(payload.result);
            setLanguage(payload.result.language);
          } else {
            setError(payload.error ?? "Stored result not found");
          }
        })
        .catch(() => setError("Could not load the stored result."));
      return;
    }

    const paramDomain = searchParams.get("domain") ?? "";
    if (!paramDomain) return;
    const paramLanguage: OutreachLanguage = searchParams.get("lang") === "fi" ? "fi" : "en";
    const paramBusinessId = searchParams.get("businessId") ?? undefined;
    setDomain(paramDomain);
    setLanguage(paramLanguage);
    if (searchParams.get("auto") === "1") {
      void run(paramDomain, paramBusinessId, paramLanguage);
    }
  }, [searchParams, run]);

  /** A company name (not a domain) goes to the search page instead. */
  const submit = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned) return;
    if (looksLikeDomain(cleaned)) {
      void run(cleaned);
    } else {
      router.push(`/outreach/search?q=${encodeURIComponent(cleaned)}`);
    }
  };

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
          appear in an email. Send delivers the draft from your Gmail to your own inbox, so a
          pitch never contacts the company.
        </p>
        {mailProvider === null && (
          <p className="text-xs text-amber-200/90">
            Gmail is not connected yet. Add GMAIL_APP_PASSWORD to .env.local and restart the dev
            server, then Send to my inbox will deliver the draft.
          </p>
        )}
        <label className="mt-2 flex max-w-sm items-center gap-2 rounded-lg border border-velho-line bg-velho-ink px-3 py-2 text-xs text-zinc-300">
          <KeyRound className="h-3.5 w-3.5 shrink-0 text-velho-muted" />
          <input
            type="password"
            value={adminSecret}
            onChange={(event) => updateSecret(event.target.value)}
            placeholder="Admin secret (only when sending to the real recipient)"
            autoComplete="off"
            className="w-full bg-transparent outline-none placeholder:text-velho-muted"
          />
        </label>
        <a
          href="/outreach/search"
          className="inline-flex items-center gap-1 pt-1 text-sm text-sky-300 hover:text-sky-200"
        >
          <Search className="h-3.5 w-3.5" aria-hidden /> Don&apos;t know the domain? Search companies by name
        </a>
      </header>

      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          submit(domain);
        }}
      >
        <input
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          placeholder="company domain, e.g. tamtron.fi"
          className="flex-1 rounded-xl border border-velho-line bg-velho-ink px-4 py-3 text-sm text-zinc-100 outline-none focus:border-sky-500"
        />
        <select
          value={language}
          onChange={(event) => setLanguage(event.target.value as OutreachLanguage)}
          className="rounded-xl border border-velho-line bg-velho-ink px-3 py-3 text-sm text-zinc-100"
        >
          <option value="en">English</option>
          <option value="fi">Suomi</option>
        </select>
        <button
          type="submit"
          disabled={running || !domain.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          {running ? "Researching…" : "Research & write"}
        </button>
      </form>

      <div className="flex flex-wrap gap-2 text-xs">
        {SAMPLE_DOMAINS.map((sample) => (
          <button
            key={sample}
            type="button"
            disabled={running}
            onClick={() => {
              setDomain(sample);
              void run(sample);
            }}
            className="rounded-full border border-velho-line px-3 py-1 text-zinc-300 hover:bg-velho-ink disabled:opacity-50"
          >
            {sample}
          </button>
        ))}
      </div>

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
                dryRun={dryRun}
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
