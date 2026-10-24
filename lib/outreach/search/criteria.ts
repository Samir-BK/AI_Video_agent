import "server-only";

import {
  DEFAULT_MIN_AGE_YEARS,
  ageInYears,
  applyExclusions,
  codeMatches,
  expandIndustries,
  expandTowns,
  registrationDateEnd,
} from "@/lib/outreach/pure/searchFilters";
import { compareScored, scoreCompany } from "@/lib/outreach/pure/searchScore";
import { PRH_PAGE_SIZE, queryPrh } from "@/lib/outreach/search/prhSearch";
import type {
  CompanySummary,
  CriteriaRequest,
  CriteriaResult,
  CriteriaSearchLogEntry,
  ScoredCompany,
} from "@/types/outreach";

/**
 * Criteria search over the trade register.
 *
 * Plan: every (town × industry code) pair is one PRH query, largest towns
 * first. A request budget keeps it polite and fast; when the budget runs out
 * the result says so (`truncated`). Results are post-filtered by code prefix
 * (the API matches substrings), de-duplicated, cleaned of non-prospects,
 * scored with explanations and cached for 30 minutes.
 */

export const MAX_QUERIES = 24;
export const MAX_CANDIDATES = 300;
const MAX_PAGES_PER_QUERY = 2;
const BATCH = 3;
const CACHE_TTL_MS = 30 * 60 * 1000;

interface PlannedQuery {
  code: string;
  town: string | undefined;
  page: number;
}

const cacheStore = globalThis as typeof globalThis & {
  __velhoCriteriaCache?: Map<string, { expires: number; value: CriteriaResult }>;
};
const cache = (cacheStore.__velhoCriteriaCache ??= new Map());

/** Canonical form of a request, used as cache key and echoed in the result. */
export const normalizeRequest = (request: CriteriaRequest): CriteriaRequest => ({
  industries: [...new Set(request.industries.map((i) => i.trim()).filter(Boolean))].sort(),
  region: request.region?.trim() || undefined,
  cities: [...new Set((request.cities ?? []).map((c) => c.trim()).filter(Boolean))].sort(),
  minAgeYears: request.minAgeYears ?? DEFAULT_MIN_AGE_YEARS,
  requireHiring: Boolean(request.requireHiring),
  onlyKnownSize: Boolean(request.onlyKnownSize),
});

const queryLabel = (q: PlannedQuery): string =>
  `${q.code}${q.town ? ` in ${q.town}` : ""}${q.page > 1 ? ` (page ${q.page})` : ""}`;

export const runCriteriaSearch = async (
  rawRequest: CriteriaRequest,
  onProgress?: (message: string, done: number, total: number) => void,
): Promise<CriteriaResult> => {
  const startedAt = Date.now();
  const request = normalizeRequest(rawRequest);
  const key = JSON.stringify(request);
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return { ...cached.value, cached: true };

  const now = new Date();
  const codes = expandIndustries(request.industries);
  const towns = expandTowns(request.region, request.cities);
  const dateEnd =
    (request.minAgeYears ?? 0) > 0 ? registrationDateEnd(request.minAgeYears ?? 0, now) : undefined;

  // Town-major order: all industries for the largest town before the next.
  const queue: PlannedQuery[] = [];
  for (const town of towns.length > 0 ? towns : [undefined]) {
    for (const code of codes) queue.push({ code, town, page: 1 });
  }
  const queriesPlanned = queue.length;

  const found = new Map<string, CompanySummary>();
  const log: CriteriaSearchLogEntry[] = [];
  let queriesRun = 0;

  while (queue.length > 0 && queriesRun < MAX_QUERIES && found.size < MAX_CANDIDATES) {
    const batch = queue.splice(0, Math.min(BATCH, MAX_QUERIES - queriesRun));
    const pages = await Promise.all(
      batch.map((q) =>
        queryPrh(
          {
            mainBusinessLine: q.code,
            location: q.town,
            registrationDateEnd: dateEnd,
          },
          q.page,
          CACHE_TTL_MS,
        ),
      ),
    );
    queriesRun += batch.length;

    pages.forEach((page, index) => {
      const q = batch[index];
      if (!q) return;
      const matching = page.companies.filter((c) => codeMatches(c.businessLineCode, [q.code]));
      for (const company of matching) {
        if (found.size >= MAX_CANDIDATES) break;
        if (!found.has(company.businessId)) found.set(company.businessId, company);
      }
      log.push({
        query: queryLabel(q),
        ok: page.ok,
        results: matching.length,
        durationMs: page.durationMs,
        note: page.ok ? `${page.totalResults} in register` : page.error,
      });
      // More pages exist: queue the next one after everything else.
      const pagesAvailable = Math.ceil(page.totalResults / PRH_PAGE_SIZE);
      if (page.ok && q.page < Math.min(pagesAvailable, MAX_PAGES_PER_QUERY)) {
        queue.push({ ...q, page: q.page + 1 });
      }
    });

    const total = Math.min(MAX_QUERIES, queriesRun + queue.length);
    onProgress?.(
      `Searched ${queriesRun} of ${total} register queries · ${found.size} candidates`,
      queriesRun,
      total,
    );
  }

  const { kept, excluded } = applyExclusions([...found.values()]);
  const companies: ScoredCompany[] = kept
    .map((company) => {
      const ageYears = ageInYears(company, now);
      const { score, reasons } = scoreCompany(company, { ageYears, now });
      return { company, score, reasons, ageYears };
    })
    .sort(compareScored);

  const result: CriteriaResult = {
    request,
    companies,
    scanned: found.size,
    excluded,
    truncated: queue.length > 0,
    truncatedBy:
      queue.length === 0 ? undefined : found.size >= MAX_CANDIDATES ? "candidates" : "queries",
    queriesRun,
    queriesPlanned,
    log,
    createdAt: now.toISOString(),
    durationMs: Date.now() - startedAt,
  };

  // Only cache searches where the register answered.
  if (log.some((entry) => entry.ok)) cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value: result });
  return result;
};
