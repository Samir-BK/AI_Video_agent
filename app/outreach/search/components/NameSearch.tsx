"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Building2, Loader2, Search } from "lucide-react";

import type { CompanySearchResponse, CompanySuggestion } from "@/types/outreach";

interface NameSearchProps {
  initialQuery: string;
  onSelect: (company: CompanySuggestion) => void;
}

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;

const STATUS_LABEL: Record<CompanySuggestion["status"], string | null> = {
  active: null,
  liquidation: "in liquidation",
  bankruptcy: "bankrupt",
  ended: "dissolved",
};

const sinceLabel = (company: CompanySuggestion): string | null => {
  if (company.registeredBefore1978) return "registered before 1978";
  return company.registeredSince ? `since ${company.registeredSince.slice(0, 4)}` : null;
};

/**
 * Accessible combobox: debounced live suggestions from the trade register,
 * stale requests cancelled, full keyboard support (↑ ↓ Enter Esc).
 */
export default function NameSearch({ initialQuery, onSelect }: NameSearchProps) {
  const [query, setQuery] = useState(initialQuery);
  const [suggestions, setSuggestions] = useState<CompanySuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const abortRef = useRef<AbortController | null>(null);
  /** Set when the text changed because a suggestion was picked. */
  const pickedRef = useRef(false);

  useEffect(() => {
    const trimmed = query.trim();
    abortRef.current?.abort();
    if (pickedRef.current) {
      pickedRef.current = false;
      return;
    }
    if (trimmed.length < MIN_CHARS) {
      setSuggestions([]);
      setNote(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/outreach/search/companies?q=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as CompanySearchResponse;
        setSuggestions(payload.suggestions);
        setNote(
          payload.note ??
            (payload.suggestions.length === 0 ? `No companies found for “${trimmed}”` : null),
        );
        setActive(payload.suggestions.length > 0 ? 0 : -1);
        setOpen(true);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setNote("Trade register unreachable — try again in a moment.");
          setSuggestions([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const choose = (company: CompanySuggestion | undefined) => {
    if (!company) return;
    setOpen(false);
    pickedRef.current = true;
    setQuery(company.name);
    onSelect(company);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => Math.min(index + 1, suggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open) choose(suggestions[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const optionId = (index: number) => `${listId}-option-${index}`;
  const showList = open && suggestions.length > 0;

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Company name
      </label>
      <div className="flex items-center gap-2 rounded-xl border border-velho-line bg-velho-ink px-4 py-3 focus-within:border-sky-500">
        <Search className="h-4 w-4 shrink-0 text-velho-muted" aria-hidden />
        <input
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Company name, e.g. Berner"
          autoComplete="off"
          autoFocus
          className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-velho-muted"
        />
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-velho-muted" aria-label="Searching" />}
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching companies"
          className="absolute z-20 mt-2 max-h-96 w-full overflow-auto rounded-xl border border-velho-line bg-velho-panel py-1 shadow-xl"
        >
          {suggestions.map((company, index) => {
            const status = STATUS_LABEL[company.status];
            const since = sinceLabel(company);
            return (
              <li
                key={company.businessId}
                id={optionId(index)}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(company)}
                onMouseEnter={() => setActive(index)}
                className={`cursor-pointer px-4 py-2.5 text-sm ${
                  index === active ? "bg-sky-500/15" : ""
                } ${company.status !== "active" ? "opacity-60" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-velho-muted" aria-hidden />
                  <span className="font-medium text-zinc-100">{company.name}</span>
                  <span className="text-xs text-velho-muted">{company.businessId}</span>
                  {status && (
                    <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300">
                      {status}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 pl-5 text-xs text-zinc-400">
                  {[company.city, company.businessLine, since, company.website ? "website registered" : null]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {company.previousNames.length > 0 && (
                  <p className="pl-5 text-xs text-velho-muted">
                    formerly {company.previousNames.slice(0, 2).join(", ")}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {note && !loading && (
        <p className="mt-2 text-xs text-amber-200/90" role="status">
          {note}
        </p>
      )}
    </div>
  );
}
