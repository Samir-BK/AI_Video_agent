"use client";

import { useCallback, useRef, useState } from "react";
import { ArrowRight, Loader2, PlayCircle, Radar } from "lucide-react";

import ResearchPanel from "@/app/outreach/components/ResearchPanel";
import RoleSwitcher from "@/app/outreach/components/RoleSwitcher";
import type {
  EntityCandidate,
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

export default function OutreachPage() {
  const [domain, setDomain] = useState("");
  const [language, setLanguage] = useState<OutreachLanguage>("en");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<OutreachProgressEvent[]>([]);
  const [result, setResult] = useState<OutreachResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (target: string, businessId?: string) => {
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
          body: JSON.stringify({ domain: cleaned, businessId, language }),
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
          appear in an email. Nothing is sent from this page.
        </p>
      </header>

      <form
        className="flex flex-col gap-3 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void run(domain);
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
