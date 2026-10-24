import "server-only";

import { promises as dns } from "node:dns";

import { fetchPageText, withTimeout } from "@/lib/outreach/fetchText";
import { containsFolded, domainGuesses, hostFromWebsite } from "@/lib/outreach/pure/searchText";
import type { CompanySummary, DomainCheck, DomainResolution } from "@/types/outreach";

/**
 * Find a company's website without ever inventing one.
 *
 * 1. The website registered in PRH, if it resolves and responds.
 * 2. Otherwise domain guesses from the legal name, each accepted only if DNS
 *    resolves AND the homepage text contains the legal name (current or
 *    previous) or the business ID.
 * Anything else: domain null, "website not found".
 */

const DNS_TIMEOUT_MS = 2500;
const PAGE_TIMEOUT_MS = 4000;
const TOTAL_BUDGET_MS = 6500;
const CACHE_TTL_MS = 30 * 60 * 1000;

const resolvesInDns = async (host: string): Promise<boolean> =>
  withTimeout(
    dns
      .lookup(host)
      .then(() => true)
      .catch(() => false),
    DNS_TIMEOUT_MS,
    false,
  );

/** Short excerpt around the first case-insensitive occurrence of `needle`. */
const excerpt = (text: string, needle: string): string => {
  const index = text.toLowerCase().indexOf(needle.toLowerCase());
  if (index === -1) return `Homepage mentions "${needle}"`;
  let start = Math.max(0, index - 40);
  let end = Math.min(text.length, index + needle.length + 40);
  // Cut at word boundaries so the excerpt never starts or ends mid-word.
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space !== -1 && space < index) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > index + needle.length) end = space;
  }
  return text.slice(start, end).replace(/\s+/g, " ").trim();
};

const proofOnPage = (text: string, company: CompanySummary): string | null => {
  if (text.includes(company.businessId)) return excerpt(text, company.businessId);
  for (const name of [company.name, ...company.previousNames.slice(0, 2)]) {
    if (containsFolded(text, name)) return excerpt(text, name);
  }
  return null;
};

const cacheStore = globalThis as typeof globalThis & {
  __velhoDomainCache?: Map<string, { expires: number; value: DomainResolution }>;
};
const cache = (cacheStore.__velhoDomainCache ??= new Map());

const checkGuess = async (
  host: string,
  company: CompanySummary,
): Promise<{ check: DomainCheck; evidence: string | null }> => {
  if (!(await resolvesInDns(host))) {
    return { check: { domain: host, outcome: "no_dns" }, evidence: null };
  }
  const page = await fetchPageText(`https://${host}`, { timeoutMs: PAGE_TIMEOUT_MS });
  if (!page) return { check: { domain: host, outcome: "unreachable" }, evidence: null };
  const evidence = proofOnPage(page.text, company);
  return {
    check: { domain: host, outcome: evidence ? "verified" : "name_not_found" },
    evidence,
  };
};

const resolveUncached = async (company: CompanySummary): Promise<DomainResolution> => {
  const startedAt = Date.now();
  const checks: DomainCheck[] = [];
  const done = (
    domain: string | null,
    method: DomainResolution["method"],
    evidence: string | null,
  ): DomainResolution => ({
    businessId: company.businessId,
    domain,
    method,
    evidence,
    checks,
    durationMs: Date.now() - startedAt,
  });

  // 1. Registered website: trusted source, only needs to be reachable.
  const registered = company.website ? hostFromWebsite(company.website) : null;
  if (registered) {
    const page = (await resolvesInDns(registered))
      ? await fetchPageText(`https://${registered}`, { timeoutMs: PAGE_TIMEOUT_MS })
      : null;
    if (page) {
      checks.push({ domain: registered, outcome: "registered" });
      return done(registered, "registered", proofOnPage(page.text, company));
    }
    checks.push({ domain: registered, outcome: "unreachable" });
  }

  // 2. Verified guesses, checked in parallel, accepted in guess order.
  const guesses = domainGuesses(company.name, company.previousNames).filter(
    (host) => host !== registered,
  );
  const results = await Promise.all(guesses.map((host) => checkGuess(host, company)));
  checks.push(...results.map((r) => r.check));
  const winner = results.find((r) => r.check.outcome === "verified");
  return winner
    ? done(winner.check.domain, "verified_guess", winner.evidence)
    : done(null, "none", null);
};

export const resolveCompanyDomain = async (company: CompanySummary): Promise<DomainResolution> => {
  const cached = cache.get(company.businessId);
  if (cached && cached.expires > Date.now()) return cached.value;

  const fallback: DomainResolution = {
    businessId: company.businessId,
    domain: null,
    method: "none",
    evidence: null,
    checks: [],
    durationMs: TOTAL_BUDGET_MS,
  };
  const value = await withTimeout(resolveUncached(company), TOTAL_BUDGET_MS, fallback);
  if (value !== fallback) cache.set(company.businessId, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
};
