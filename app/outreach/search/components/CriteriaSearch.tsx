"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Download, ExternalLink, Filter, Loader2 } from "lucide-react";

import { compareScored } from "@/lib/outreach/pure/searchScore";
import type {
  CompanySummary,
  CriteriaRequest,
  CriteriaResult,
  CriteriaStreamEvent,
  ScoredCompany,
} from "@/types/outreach";

interface Option {
  id: string;
  label: string;
}

const PAGE_SIZE = 25;
/** Must match ENRICH_TOP_N on the server. */
const TOP_N = 25;

/** Byte-order mark so Excel opens the UTF-8 CSV with ä/ö intact. */
const UTF8_BOM = String.fromCharCode(0xfeff);

/** CSV cell: quote everything, double inner quotes, block spreadsheet formulas. */
const csvCell = (value: string | number | null | undefined): string => {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

const exportCsv = (rows: ScoredCompany[]) => {
  const header = [
    "Score", "Company", "Business ID", "City", "Industry code", "Industry",
    "Registered", "Age (years)", "Website", "Open positions", "Manual-work positions", "Employees", "Employees source", "Why", "Register page",
  ];
  const lines = rows.map((row) =>
    [
      row.score,
      row.company.name,
      row.company.businessId,
      row.company.city,
      row.company.businessLineCode,
      row.company.businessLine,
      row.company.registeredBefore1978 ? "before 1978" : row.company.registeredSince,
      row.ageYears,
      row.enrichment?.domain?.domain ?? row.company.website,
      row.enrichment?.hiring.map((f) => f.quote).join("; "),
      row.enrichment?.manualHiring.map((f) => f.quote).join("; "),
      row.enrichment?.size?.employees,
      row.enrichment?.size ? row.enrichment.size.fact.sourceUrl + " (" + row.enrichment.size.fact.quote + ")" : "",
      row.reasons.map((r) => `${r.points > 0 ? "+" : ""}${r.points} ${r.reason}`).join("; "),
      row.company.sourceUrl,
    ]
      .map(csvCell)
      .join(","),
  );
  const blob = new Blob([`${UTF8_BOM}${[header.map(csvCell).join(","), ...lines].join("\r\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `velho-prospects-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
};

/**
 * Criteria search: industries, area, minimum age → ranked, explained list.
 * Each row hands off to the per-company flow (no batch runs).
 */
interface CriteriaSearchProps {
  /** Open the per-company card (website check + hand-off to outreach). */
  onPick: (company: CompanySummary) => void;
}

export default function CriteriaSearch({ onPick }: CriteriaSearchProps) {
  const [industries, setIndustries] = useState<Option[]>([]);
  const [regions, setRegions] = useState<Option[]>([]);
  const [selected, setSelected] = useState<string[]>(["logistics"]);
  const [customCode, setCustomCode] = useState("");
  const [region, setRegion] = useState("uusimaa");
  const [cities, setCities] = useState("");
  const [minAge, setMinAge] = useState(10);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<CriteriaResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [onlyHiring, setOnlyHiring] = useState(false);
  const [onlyKnownSize, setOnlyKnownSize] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichSummary, setEnrichSummary] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/outreach/search/criteria")
      .then((response) => response.json())
      .then((payload: { industries: Option[]; regions: Option[] }) => {
        setIndustries(payload.industries);
        setRegions(payload.regions);
      })
      .catch(() => setError("Could not load the search options."));
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const search = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    setResult(null);
    setPage(0);
    setProgress("Starting…");
    setEnriching(false);
    setEnrichSummary(null);

    const request: CriteriaRequest = {
      industries: [...selected, ...customCode.split(/[\s,]+/).filter(Boolean)],
      region: region || undefined,
      cities: cities.split(",").map((c) => c.trim()).filter(Boolean),
      minAgeYears: minAge,
      requireHiring: onlyHiring,
      onlyKnownSize,
    };

    try {
      const response = await fetch("/api/outreach/search/criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(payload?.error ?? `Search failed (${response.status})`);
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
          const event = JSON.parse(line.slice(6)) as CriteriaStreamEvent;
          if (event.type === "progress") setProgress(event.message);
          else if (event.type === "result") {
            setResult(event.result);
            setEnriching(event.result.companies.length > 0);
          } else if (event.type === "enriched") {
            // Update the row in place; re-rank once everything is checked.
            setResult((prev) =>
              prev
                ? {
                    ...prev,
                    companies: prev.companies.map((row) =>
                      row.company.businessId === event.businessId ? event.scored : row,
                    ),
                  }
                : prev,
            );
          } else if (event.type === "enrichment_done") {
            setEnriching(false);
            setResult((prev) =>
              prev ? { ...prev, companies: [...prev.companies].sort(compareScored) } : prev,
            );
            setEnrichSummary(
              `Checked ${event.done} companies in ${(event.durationMs / 1000).toFixed(1)} s` +
                (event.timedOut > 0 ? ` · ${event.timedOut} ran out of time` : ""),
            );
          } else if (event.type === "error") setError(event.message);
        }
      }
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        setError("Connection lost while searching. Try again.");
      }
    } finally {
      setRunning(false);
      setEnriching(false);
      setProgress(null);
    }
  };

  const checkedCount = (result?.companies ?? []).filter((row) => row.enrichment).length;
  const topIds = new Set((result?.companies ?? []).slice(0, TOP_N).map((row) => row.company.businessId));
  const isTop = (row: ScoredCompany) => topIds.has(row.company.businessId) && !row.enrichment;
  const filtering = onlyHiring || onlyKnownSize;
  // Hiring / size are only known for checked companies, so these filters
  // narrow the list to the checked rows.
  const rows = (result?.companies ?? []).filter(
    (row) =>
      (!onlyHiring || (row.enrichment?.hiring.length ?? 0) > 0) &&
      (!onlyKnownSize || Boolean(row.enrichment?.size)),
  );
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const visible = useMemo(() => rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [rows, page]);

  return (
    <div className="space-y-5">
      <form
        className="space-y-4 rounded-2xl border border-velho-line bg-velho-panel p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void search();
        }}
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-zinc-100">Industry</legend>
          <div className="flex flex-wrap gap-2">
            {industries.map((option) => (
              <label
                key={option.id}
                className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs focus-within:ring-2 focus-within:ring-sky-400 ${
                  selected.includes(option.id)
                    ? "border-sky-500 bg-sky-500/15 text-sky-100"
                    : "border-velho-line text-zinc-300"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  aria-label={option.label}
                  checked={selected.includes(option.id)}
                  onChange={() => toggle(option.id)}
                />
                {option.label}
              </label>
            ))}
          </div>
          <label className="block text-xs text-zinc-400">
            Or TOL 2025 codes (3–5 digits, comma-separated)
            <input
              value={customCode}
              onChange={(event) => setCustomCode(event.target.value)}
              placeholder="e.g. 46642, 25110"
              className="mt-1 w-full rounded-lg border border-velho-line bg-velho-ink px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500 sm:w-72"
            />
          </label>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs text-zinc-400">
            Region
            <select
              value={region}
              onChange={(event) => setRegion(event.target.value)}
              className="mt-1 w-full rounded-lg border border-velho-line bg-velho-ink px-3 py-2 text-sm text-zinc-100"
            >
              <option value="">Any (whole Finland)</option>
              {regions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-400">
            Extra towns (comma-separated)
            <input
              value={cities}
              onChange={(event) => setCities(event.target.value)}
              placeholder="e.g. Kuopio, Jyväskylä"
              className="mt-1 w-full rounded-lg border border-velho-line bg-velho-ink px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500"
            />
          </label>
          <label className="text-xs text-zinc-400">
            Minimum age (years)
            <input
              type="number"
              min={0}
              max={100}
              value={minAge}
              onChange={(event) => setMinAge(Number(event.target.value))}
              className="mt-1 w-full rounded-lg border border-velho-line bg-velho-ink px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-4 text-xs text-zinc-300">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlyHiring}
              aria-label="Only companies hiring now"
              onChange={(event) => setOnlyHiring(event.target.checked)}
              className="accent-sky-500"
            />
            Only companies hiring now
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={onlyKnownSize}
              aria-label="Only companies with a known size"
              onChange={(event) => setOnlyKnownSize(event.target.checked)}
              className="accent-sky-500"
            />
            Only companies with a known size
          </label>
          <span className="text-velho-muted">
            Website, job ads and size are checked for the top {TOP_N} results.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={running || (selected.length === 0 && !customCode.trim())}
            className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Filter className="h-4 w-4" aria-hidden />}
            {running ? "Searching…" : "Find companies"}
          </button>
          {progress && (
            <span className="text-xs text-zinc-400" role="status">
              {progress}
            </span>
          )}
        </div>
      </form>

      {error && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</p>
      )}

      {result && (
        <section className="space-y-3" aria-label="Search results">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
            <p>
              <span className="font-semibold text-zinc-100">{rows.length}</span> prospects from{" "}
              {result.scanned} matching companies · {result.queriesRun} register queries in{" "}
              {(result.durationMs / 1000).toFixed(1)} s{result.cached ? " (cached)" : ""}
              {enrichSummary ? ` · ${enrichSummary}` : ""}
              {filtering ? ` · filters show ${rows.length} of ${checkedCount} checked companies` : ""}
            </p>
            <button
              type="button"
              onClick={() => exportCsv(rows)}
              disabled={rows.length === 0}
              className="inline-flex items-center gap-2 rounded-lg border border-velho-line px-3 py-1.5 text-xs text-zinc-200 hover:bg-velho-ink disabled:opacity-40"
            >
              <Download className="h-3.5 w-3.5" aria-hidden /> Export CSV
            </button>
          </div>

          {(result.excluded.length > 0 || result.truncated) && (
            <div className="rounded-xl border border-velho-line bg-velho-ink px-4 py-2 text-xs text-zinc-400">
              {result.excluded.length > 0 && (
                <p>
                  Excluded:{" "}
                  {result.excluded.map((entry) => `${entry.count} ${entry.label.toLowerCase()}`).join(" · ")}
                </p>
              )}
              {result.truncated && (
                <p className="text-amber-200/90">
                  {result.truncatedBy === "candidates"
                    ? `Search stopped after the first ${result.scanned} matching companies`
                    : `Search stopped at the limit of ${result.queriesRun} register queries`}
                  {" "}(towns searched first: largest first). Narrow the industry or area to see the rest.
                </p>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-2xl border border-velho-line">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-velho-ink text-xs uppercase tracking-wider text-velho-muted">
                <tr>
                  <th scope="col" className="px-3 py-2">Score</th>
                  <th scope="col" className="px-3 py-2">Company</th>
                  <th scope="col" className="px-3 py-2">Industry</th>
                  <th scope="col" className="px-3 py-2">Age</th>
                  <th scope="col" className="px-3 py-2">Website</th>
                  <th scope="col" className="px-3 py-2">Signals</th>
                  <th scope="col" className="px-3 py-2">Why</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-velho-line bg-velho-panel">
                {visible.map((row) => (
                  <tr key={row.company.businessId} className="align-top">
                    <td className="px-3 py-3 font-semibold text-zinc-50">{row.score}</td>
                    <td className="px-3 py-3">
                      <p className="font-medium text-zinc-100">{row.company.name}</p>
                      <p className="text-xs text-velho-muted">
                        {row.company.businessId}
                        {row.company.city ? ` · ${row.company.city}` : ""}
                      </p>
                      <a
                        href={row.company.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-sky-300"
                      >
                        register <ExternalLink className="h-3 w-3" aria-hidden />
                      </a>
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-300">
                      {row.company.businessLine}
                      <span className="block text-velho-muted">{row.company.businessLineCode}</span>
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-300">
                      {row.company.registeredBefore1978 ? "before 1978" : row.ageYears !== null ? `${row.ageYears} y` : "—"}
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-300">
                      <WebsiteCell row={row} pending={enriching && isTop(row)} />
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-300">
                      <SignalsCell row={row} pending={enriching && isTop(row)} />
                    </td>
                    <td className="px-3 py-3 text-xs text-zinc-400">
                      <ul className="space-y-0.5">
                        {row.reasons.map((reason) => (
                          <li key={reason.reason}>
                            <span className={reason.points >= 0 ? "text-emerald-300" : "text-rose-300"}>
                              {reason.points >= 0 ? "+" : ""}
                              {reason.points}
                            </span>{" "}
                            {reason.reason}
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => onPick(row.company)}
                        className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/25"
                      >
                        Research &amp; write <ArrowRight className="h-3 w-3" aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center text-sm text-zinc-400">
                      No prospects match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <nav className="flex items-center justify-center gap-2 text-xs" aria-label="Result pages">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg border border-velho-line px-3 py-1.5 text-zinc-200 disabled:opacity-40"
              >
                Previous
              </button>
              <span className="text-zinc-400">
                Page {page + 1} of {pages}
              </span>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                disabled={page >= pages - 1}
                className="rounded-lg border border-velho-line px-3 py-1.5 text-zinc-200 disabled:opacity-40"
              >
                Next
              </button>
            </nav>
          )}

          <details className="text-xs text-zinc-400">
            <summary className="cursor-pointer text-zinc-300">Register queries ({result.log.length})</summary>
            <ul className="mt-2 space-y-0.5">
              {result.log.map((entry, index) => (
                <li key={`${entry.query}-${index}`}>
                  <span className={entry.ok ? "text-emerald-300" : "text-amber-300"}>{entry.ok ? "✓" : "!"}</span>{" "}
                  {entry.query}: {entry.results} matching · {entry.note} · {entry.durationMs} ms
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}

const METHOD_LABEL = { registered: "registered", verified_guess: "verified", none: "" } as const;

function WebsiteCell({ row, pending }: { row: ScoredCompany; pending: boolean }) {
  const enrichment = row.enrichment;
  if (pending) {
    return (
      <span className="inline-flex items-center gap-1 text-velho-muted">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> checking…
      </span>
    );
  }
  if (!enrichment) {
    return row.company.website ? (
      <span>{row.company.website}</span>
    ) : (
      <span className="text-velho-muted">not checked</span>
    );
  }
  if (enrichment.domain?.domain) {
    return (
      <span title={enrichment.domain.evidence ?? undefined}>
        {enrichment.domain.domain}
        <span className="block text-velho-muted">{METHOD_LABEL[enrichment.domain.method]}</span>
      </span>
    );
  }
  return (
    <span className="text-amber-200/80">
      {enrichment.websiteTimedOut || enrichment.status === "timed_out" ? "check timed out" : "not found"}
    </span>
  );
}

function SignalsCell({ row, pending }: { row: ScoredCompany; pending: boolean }) {
  const enrichment = row.enrichment;
  if (pending) return <span className="text-velho-muted">…</span>;
  if (!enrichment) return <span className="text-velho-muted">—</span>;
  const manual = new Set(enrichment.manualHiring.map((fact) => fact.id));
  return (
    <div className="space-y-1">
      {enrichment.hiring.length === 0 ? (
        <p className="text-velho-muted">no open positions</p>
      ) : (
        enrichment.hiring.slice(0, 3).map((fact) => (
          <a
            key={fact.id}
            href={fact.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className={`block hover:underline ${manual.has(fact.id) ? "text-emerald-300" : "text-zinc-300"}`}
          >
            {manual.has(fact.id) ? "● " : "○ "}
            {fact.quote}
          </a>
        ))
      )}
      {enrichment.size ? (
        <a
          href={enrichment.size.fact.sourceUrl}
          target="_blank"
          rel="noreferrer"
          title={`“${enrichment.size.fact.quote}”`}
          className="block text-zinc-300 hover:underline"
        >
          ~{enrichment.size.employees} employees
        </a>
      ) : (
        <p className="text-velho-muted">size unknown</p>
      )}
    </div>
  );
}
