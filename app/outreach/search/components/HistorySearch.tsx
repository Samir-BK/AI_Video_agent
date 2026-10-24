"use client";

import { useEffect, useState } from "react";
import { Eye, History, Loader2 } from "lucide-react";

import type { HistoryRow, RoleEmailStatus } from "@/types/outreach";

const STATUS_OPTIONS: { value: "" | RoleEmailStatus; label: string }[] = [
  { value: "", label: "Any status" },
  { value: "draft", label: "Draft" },
  { value: "no_address", label: "Draft · no address" },
  { value: "dry_run_sent", label: "Dry run sent" },
  { value: "sent", label: "Sent" },
  { value: "opted_out", label: "Opted out" },
];

const STATUS_STYLE: Record<RoleEmailStatus, string> = {
  draft: "bg-zinc-700/40 text-zinc-300",
  no_address: "bg-zinc-700/40 text-zinc-400",
  dry_run_sent: "bg-sky-500/15 text-sky-200",
  sent: "bg-emerald-500/15 text-emerald-300",
  opted_out: "bg-rose-500/15 text-rose-300",
  skipped: "bg-zinc-700/40 text-zinc-400",
};

/**
 * Companies already researched on this server. Opening a row shows the stored
 * result in /outreach without researching again.
 */
export default function HistorySearch() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | RoleEmailStatus>("");
  const [minViews, setMinViews] = useState(0);
  const [sort, setSort] = useState<"date" | "views">("date");
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ sort });
        if (q.trim()) params.set("q", q.trim());
        if (status) params.set("status", status);
        if (minViews > 0) params.set("minViews", String(minViews));
        const response = await fetch(`/api/outreach/search/history?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as { rows: HistoryRow[]; total: number };
        setRows(payload.rows);
        setTotal(payload.total);
      } catch (caught) {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError("Could not load the history.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, status, minViews, sort]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border border-velho-line bg-velho-panel p-4 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <label className="text-xs text-zinc-400">
          Company, domain or contact
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="e.g. wurth, berner.fi"
            className="mt-1 w-full rounded-lg border border-velho-line bg-velho-ink px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500"
          />
        </label>
        <label className="text-xs text-zinc-400">
          Email status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as "" | RoleEmailStatus)}
            className="mt-1 w-full rounded-lg border border-velho-line bg-velho-ink px-3 py-2 text-sm text-zinc-100"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-400">
          Min. video views
          <input
            type="number"
            min={0}
            value={minViews}
            onChange={(event) => setMinViews(Math.max(0, Number(event.target.value) || 0))}
            className="mt-1 w-full rounded-lg border border-velho-line bg-velho-ink px-3 py-2 text-sm text-zinc-100 outline-none focus:border-sky-500"
          />
        </label>
        <label className="text-xs text-zinc-400">
          Sort by
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as "date" | "views")}
            className="mt-1 w-full rounded-lg border border-velho-line bg-velho-ink px-3 py-2 text-sm text-zinc-100"
          >
            <option value="date">Newest first</option>
            <option value="views">Most viewed</option>
          </select>
        </label>
      </div>

      <p className="flex items-center gap-2 text-xs text-zinc-400" role="status">
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <History className="h-3.5 w-3.5" aria-hidden />}
        {rows.length} of {total} researched companies · stored on this server only
      </p>

      {error && <p className="text-sm text-rose-200">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-velho-line">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-velho-ink text-xs uppercase tracking-wider text-velho-muted">
            <tr>
              <th scope="col" className="px-3 py-2">Company</th>
              <th scope="col" className="px-3 py-2">Researched</th>
              <th scope="col" className="px-3 py-2">Emails</th>
              <th scope="col" className="px-3 py-2">Views</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-velho-line bg-velho-panel">
            {rows.map((row) => (
              <tr key={row.domain} className="align-top">
                <td className="px-3 py-3">
                  <p className="font-medium text-zinc-100">{row.companyName}</p>
                  <p className="text-xs text-velho-muted">
                    {row.domain}
                    {row.businessId ? ` · ${row.businessId}` : ""} · {row.sufficiency}
                  </p>
                </td>
                <td className="px-3 py-3 text-xs text-zinc-300">
                  {new Date(row.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
                  <span className="block text-velho-muted">{row.language === "fi" ? "Finnish" : "English"}</span>
                </td>
                <td className="px-3 py-3 text-xs">
                  {row.emails.length === 0 ? (
                    <span className="text-velho-muted">none written</span>
                  ) : (
                    <ul className="space-y-1">
                      {row.emails.map((email) => (
                        <li key={email.role} className="flex flex-wrap items-center gap-1">
                          <span className="w-8 text-zinc-300">{email.role}</span>
                          <span className={`rounded-full px-2 py-0.5 ${STATUS_STYLE[email.status]}`}>
                            {email.status.replace(/_/g, " ")}
                          </span>
                          {email.recipient && <span className="text-velho-muted">{email.recipient}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="px-3 py-3 text-xs text-zinc-300">
                  <span className="inline-flex items-center gap-1">
                    <Eye className="h-3 w-3" aria-hidden /> {row.totalViews}
                  </span>
                  <span className="block text-velho-muted">
                    CEO {row.views.CEO} · COO {row.views.COO} · CFO {row.views.CFO}
                  </span>
                </td>
                <td className="px-3 py-3">
                  <a
                    href={`/outreach?view=${encodeURIComponent(row.domain)}`}
                    className="whitespace-nowrap rounded-lg bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/25"
                  >
                    Open
                  </a>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-zinc-400">
                  {total === 0
                    ? "Nothing researched on this server yet."
                    : "No researched company matches these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
