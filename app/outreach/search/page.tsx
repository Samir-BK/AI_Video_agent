"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, Radar } from "lucide-react";

import CriteriaSearch from "@/app/outreach/search/components/CriteriaSearch";
import NameSearch from "@/app/outreach/search/components/NameSearch";
import SelectedCompany from "@/app/outreach/search/components/SelectedCompany";
import type { CompanySummary } from "@/types/outreach";

/**
 * Company search for the outreach flow. Every tab ends in the existing
 * per-company outreach (no batch runs). Company data only — no person search.
 */

type Tab = "name" | "criteria" | "history";

const TABS: { id: Tab; label: string; ready: boolean }[] = [
  { id: "name", label: "By name", ready: true },
  { id: "criteria", label: "By criteria", ready: true },
  { id: "history", label: "History", ready: false },
];

function SearchPage() {
  const params = useSearchParams();
  const initialQuery = params.get("q") ?? "";
  const [tab, setTab] = useState<Tab>("name");
  const [selected, setSelected] = useState<CompanySummary | null>(null);
  const selectedRef = useRef<HTMLDivElement | null>(null);

  /** A row picked from the criteria results opens its card below the table. */
  const pickFromList = (company: CompanySummary) => {
    setSelected(company);
    requestAnimationFrame(() =>
      selectedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setSelected(null);
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <header className="space-y-1">
        <a
          href="/outreach"
          className="inline-flex items-center gap-1 text-xs text-velho-muted hover:text-zinc-300"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Outreach
        </a>
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-velho-muted">
          <Radar className="h-4 w-4" aria-hidden /> Velho Outreach
        </p>
        <h1 className="text-2xl font-semibold text-zinc-50">Find a company</h1>
        <p className="text-sm text-zinc-400">
          Search the Finnish trade register, pick the right company, and run the outreach with its
          exact business ID.
        </p>
      </header>

      <div role="tablist" aria-label="Search mode" className="flex gap-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            disabled={!item.ready}
            onClick={() => switchTab(item.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 disabled:cursor-not-allowed disabled:opacity-40 ${
              tab === item.id
                ? "bg-sky-500 text-white"
                : "border border-velho-line text-zinc-200 hover:bg-velho-ink"
            }`}
          >
            {item.label}
            {!item.ready && <span className="ml-1 text-[10px] font-normal">(soon)</span>}
          </button>
        ))}
      </div>

      {tab === "name" && (
        <section
          id="panel-name"
          role="tabpanel"
          aria-labelledby="tab-name"
          className="space-y-4"
        >
          <NameSearch initialQuery={initialQuery} onSelect={setSelected} />
          {selected && <SelectedCompany key={selected.businessId} company={selected} />}
        </section>
      )}

      {tab === "criteria" && (
        <section
          id="panel-criteria"
          role="tabpanel"
          aria-labelledby="tab-criteria"
          className="space-y-4"
        >
          <CriteriaSearch onPick={pickFromList} />
          <div ref={selectedRef}>
            {selected && <SelectedCompany key={selected.businessId} company={selected} />}
          </div>
        </section>
      )}

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

export default function SearchPageWrapper() {
  return (
    <Suspense fallback={null}>
      <SearchPage />
    </Suspense>
  );
}
