import "server-only";

import { fetchPageText, withTimeout } from "@/lib/outreach/fetchText";
import { extractEmployeeCount, isManualWorkRole } from "@/lib/outreach/pure/searchSignals";
import { verifyFacts } from "@/lib/outreach/pure/verify";
import { jobAdsSource } from "@/lib/outreach/research/jobAds";
import { nextFactId, nowIso } from "@/lib/outreach/research/source";
import { resolveCompanyDomain } from "@/lib/outreach/search/resolveDomain";
import type { CompanyEnrichment, CompanySummary, FetchedPage, SourcedFact } from "@/types/outreach";

/**
 * Enrichment for the top criteria-search results:
 *   - website (registered or verified — never a raw guess),
 *   - open positions on Duunitori, flagged when they are manual-work roles,
 *   - employee count, only when the company's own site states it.
 * Each company has a hard deadline; the job board is called at most two at a
 * time to stay polite. Results are cached for 30 minutes.
 */

export const ENRICH_TOP_N = 25;
export const ENRICH_TOTAL_BUDGET_MS = 40_000;
/** Hard cap per company (project rule: ≤6 s per step). */
const PER_COMPANY_MS = 6000;
/** Website + job ads run in parallel within this part of the budget. */
const LOOKUP_MS = 4500;
const PAGE_TIMEOUT_MS = 2500;
const CACHE_TTL_MS = 30 * 60 * 1000;

/* -------------------- small semaphore for the job board ------------------- */

let jobsInFlight = 0;
const jobWaiters: (() => void)[] = [];
const withJobSlot = async <T,>(task: () => Promise<T>): Promise<T> => {
  if (jobsInFlight >= 2) await new Promise<void>((resolve) => jobWaiters.push(resolve));
  jobsInFlight += 1;
  try {
    return await task();
  } finally {
    jobsInFlight -= 1;
    jobWaiters.shift()?.();
  }
};

const cacheStore = globalThis as typeof globalThis & {
  __velhoEnrichCache?: Map<string, { expires: number; value: CompanyEnrichment }>;
};
const cache = (cacheStore.__velhoEnrichCache ??= new Map());

const ABOUT_LINK = /(about|meista|meistä|yritys|yhtio|yhtiö|company|tietoa|esittely)/i;

/** Employee count from the homepage or one "about" page, with its quote. */
const findSize = async (
  domain: string,
): Promise<{ employees: number; fact: SourcedFact } | null> => {
  const home = await fetchPageText(`https://${domain}`, { timeoutMs: PAGE_TIMEOUT_MS });
  const pages: FetchedPage[] = home ? [home] : [];
  const about = home?.links.find((link) => ABOUT_LINK.test(new URL(link).pathname));
  if (about) {
    const page = await fetchPageText(about, { timeoutMs: PAGE_TIMEOUT_MS });
    if (page) pages.push(page);
  }
  for (const page of pages) {
    const count = extractEmployeeCount(page.text);
    if (!count) continue;
    return {
      employees: count.employees,
      fact: {
        id: nextFactId("size"),
        kind: "company",
        text: `About ${count.employees} employees`,
        quote: count.quote,
        quoteLang: "fi",
        sourceUrl: page.url,
        retrievedAt: nowIso(),
      },
    };
  }
  return null;
};

const findHiring = async (company: CompanySummary): Promise<SourcedFact[]> =>
  withJobSlot(async () => {
    const output = await jobAdsSource.run({
      domain: "",
      origin: "",
      companyName: company.name,
      entity: null,
    });
    const texts = new Map(output.pages.map((page) => [page.url, page.text]));
    return verifyFacts(output.facts, texts).verified;
  });

/**
 * Each part has its own deadline, so a slow job board or "about" page never
 * throws away a website that was already found.
 */
const enrichUncached = async (company: CompanySummary): Promise<CompanyEnrichment> => {
  const startedAt = Date.now();
  const [domain, hiring] = await Promise.all([
    withTimeout(resolveCompanyDomain(company), LOOKUP_MS, null),
    withTimeout(
      findHiring(company).catch(() => [] as SourcedFact[]),
      LOOKUP_MS,
      [] as SourcedFact[],
    ),
  ]);
  const remaining = PER_COMPANY_MS - (Date.now() - startedAt) - 200;
  const size =
    domain?.domain && remaining > 500
      ? await withTimeout(findSize(domain.domain).catch(() => null), remaining, null)
      : null;
  return {
    status: "done",
    domain,
    hiring,
    manualHiring: hiring.filter((fact) => isManualWorkRole(fact.quote)),
    size,
    websiteTimedOut: domain === null,
  };
};

export const enrichCompany = async (company: CompanySummary): Promise<CompanyEnrichment> => {
  const cached = cache.get(company.businessId);
  if (cached && cached.expires > Date.now()) return cached.value;

  const timedOut: CompanyEnrichment = {
    status: "timed_out",
    domain: null,
    hiring: [],
    manualHiring: [],
    size: null,
  };
  const value = await withTimeout(enrichUncached(company), PER_COMPANY_MS, timedOut);
  if (value.status === "done") {
    cache.set(company.businessId, { expires: Date.now() + CACHE_TTL_MS, value });
  }
  return value;
};

/**
 * Enrich companies with limited parallelism and an overall budget. Calls
 * `onEach` as soon as each company finishes, so the UI can update live.
 */
export const enrichMany = async (
  companies: CompanySummary[],
  onEach: (company: CompanySummary, enrichment: CompanyEnrichment) => void,
  concurrency = 5,
): Promise<{ done: number; timedOut: number }> => {
  const deadline = Date.now() + ENRICH_TOTAL_BUDGET_MS;
  const queue = [...companies];
  let done = 0;
  let timedOut = 0;

  const worker = async () => {
    while (queue.length > 0 && Date.now() < deadline) {
      const company = queue.shift();
      if (!company) break;
      const remaining = deadline - Date.now();
      const enrichment = await withTimeout(enrichCompany(company), Math.max(remaining, 0), {
        status: "timed_out",
        domain: null,
        hiring: [],
        manualHiring: [],
        size: null,
      } satisfies CompanyEnrichment);
      if (enrichment.status === "done") done += 1;
      else timedOut += 1;
      onEach(company, enrichment);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, companies.length) }, worker));
  // Anything never started because the budget ran out counts as timed out.
  for (const company of queue) {
    timedOut += 1;
    onEach(company, { status: "timed_out", domain: null, hiring: [], manualHiring: [], size: null });
  }
  return { done, timedOut };
};
