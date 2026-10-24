import "server-only";

import { toCompanySummary, type PrhCompanyRecord } from "@/lib/outreach/pure/searchPrh";
import type { CompanySummary } from "@/types/outreach";

/**
 * PRH / YTJ open-data search client used by the search page.
 *
 * Politeness and resilience: at most 3 requests in flight and ~5 per second,
 * one retry on 429 / 5xx, a per-request deadline, and an in-memory TTL cache.
 * Data licence: CC BY 4.0 — the UI shows the attribution.
 */

const API = "https://avoindata.prh.fi/opendata-ytj-api/v3/companies";
const REQUEST_TIMEOUT_MS = 8000;
const MAX_IN_FLIGHT = 3;
const MIN_GAP_MS = 200;
export const PRH_PAGE_SIZE = 100;

export interface PrhPage {
  ok: boolean;
  totalResults: number;
  companies: CompanySummary[];
  /** Human-readable reason when ok is false. */
  error?: string;
  durationMs: number;
}

/* ---------------------------- rate limiter ---------------------------- */

let inFlight = 0;
let lastStart = 0;
const waiters: (() => void)[] = [];

const acquire = async (): Promise<void> => {
  if (inFlight >= MAX_IN_FLIGHT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  inFlight += 1;
  const wait = lastStart + MIN_GAP_MS - Date.now();
  lastStart = Math.max(Date.now(), lastStart + MIN_GAP_MS);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
};

const release = (): void => {
  inFlight -= 1;
  waiters.shift()?.();
};

/* -------------------------------- cache ------------------------------- */

interface CacheEntry {
  expires: number;
  value: PrhPage;
}

const cacheStore = globalThis as typeof globalThis & { __velhoPrhCache?: Map<string, CacheEntry> };
const cache = (cacheStore.__velhoPrhCache ??= new Map<string, CacheEntry>());

/* ------------------------------- requests ----------------------------- */

const fetchOnce = async (url: string): Promise<Response | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "VelhoOutreach/1.0" },
      signal: controller.signal,
      cache: "no-store",
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * One page of companies for the given query parameters (e.g. { name },
 * { location, mainBusinessLine, registrationDateEnd }). Never throws.
 */
export const queryPrh = async (
  params: Record<string, string | undefined>,
  page = 1,
  ttlMs = 10 * 60 * 1000,
): Promise<PrhPage> => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  if (page > 1) search.set("page", String(page));
  const url = `${API}?${search.toString()}`;

  const cached = cache.get(url);
  if (cached && cached.expires > Date.now()) return cached.value;

  const startedAt = Date.now();
  await acquire();
  try {
    let response = await fetchOnce(url);
    if (response && (response.status === 429 || response.status >= 500)) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      response = await fetchOnce(url);
    }

    if (!response || !response.ok) {
      return {
        ok: false,
        totalResults: 0,
        companies: [],
        error: !response
          ? "Trade register unreachable"
          : response.status === 429
            ? "Trade register is rate-limiting requests — try again shortly"
            : `Trade register returned ${response.status}`,
        durationMs: Date.now() - startedAt,
      };
    }

    const payload = (await response.json().catch(() => null)) as {
      totalResults?: number;
      companies?: PrhCompanyRecord[];
    } | null;

    const value: PrhPage = {
      ok: payload !== null,
      totalResults: payload?.totalResults ?? 0,
      companies: (payload?.companies ?? [])
        .map(toCompanySummary)
        .filter((c): c is CompanySummary => c !== null),
      error: payload === null ? "Trade register returned an unreadable response" : undefined,
      durationMs: Date.now() - startedAt,
    };
    if (value.ok) cache.set(url, { expires: Date.now() + ttlMs, value });
    return value;
  } finally {
    release();
  }
};

export const getCompanyById = async (businessId: string): Promise<CompanySummary | null> => {
  const page = await queryPrh({ businessId });
  return page.companies.find((c) => c.businessId === businessId) ?? null;
};
