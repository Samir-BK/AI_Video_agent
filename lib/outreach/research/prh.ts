import "server-only";

import { fetchPageText } from "@/lib/outreach/fetchText";
import { nextFactId, nowIso } from "@/lib/outreach/research/source";
import type { EntityCandidate, SourcedFact } from "@/types/outreach";

/**
 * Finnish Patent and Registration Office (PRH) open data — YTJ API v3.
 * Free and key-less. Returns register data including current and previous
 * names and, for some companies, the registered website.
 */

const API_BASE = "https://avoindata.prh.fi/opendata-ytj-api/v3/companies";
const PRH_TIMEOUT_MS = 5000;

/** Public, human-readable page for a business ID. */
export const ytjPageUrl = (businessId: string): string =>
  `https://tietopalvelu.ytj.fi/yritys/${encodeURIComponent(businessId)}`;

interface PrhName {
  name?: string;
  type?: string;
  registrationDate?: string;
  endDate?: string;
}

interface PrhDescription {
  languageCode?: string;
  description?: string;
}

interface PrhCompany {
  businessId?: { value?: string; registrationDate?: string };
  names?: PrhName[];
  website?: { url?: string } | null;
  mainBusinessLine?: { descriptions?: PrhDescription[] } | null;
  endDate?: string | null;
  tradeRegisterStatus?: string;
}

interface PrhResponse {
  totalResults?: number;
  companies?: PrhCompany[];
}

export interface PrhLookup {
  candidates: EntityCandidate[];
  /** Raw JSON body, kept so register facts can be verified verbatim. */
  rawText: string;
  apiUrl: string;
}

const toCandidate = (company: PrhCompany): EntityCandidate | null => {
  const businessId = company.businessId?.value;
  if (!businessId || company.endDate) return null;

  // type "1" = official name; the current one has no endDate.
  const official = (company.names ?? []).filter((n) => n.type === "1" && n.name);
  const current = official.find((n) => !n.endDate);
  if (!current?.name) return null;

  const previous = official
    .filter((n) => n.endDate)
    .map((n) => ({ name: n.name ?? "", until: n.endDate ?? null }))
    .sort((a, b) => (b.until ?? "").localeCompare(a.until ?? ""));

  const english = company.mainBusinessLine?.descriptions?.find(
    (d) => d.languageCode === "3",
  );
  const finnish = company.mainBusinessLine?.descriptions?.find(
    (d) => d.languageCode === "1",
  );

  return {
    name: current.name,
    businessId,
    registeredSince: company.businessId?.registrationDate ?? null,
    website: company.website?.url ?? null,
    previousNames: previous,
    renamedOn: previous.length > 0 ? (current.registrationDate ?? null) : null,
    businessLine: english?.description ?? finnish?.description ?? null,
  };
};

const lookup = async (query: string): Promise<PrhLookup> => {
  const apiUrl = `${API_BASE}?${query}`;
  const page = await fetchPageText(apiUrl, { timeoutMs: PRH_TIMEOUT_MS, json: true });
  if (!page) return { candidates: [], rawText: "", apiUrl };

  try {
    const parsed = JSON.parse(page.text) as PrhResponse;
    const candidates = (parsed.companies ?? [])
      .map(toCandidate)
      .filter((c): c is EntityCandidate => c !== null);
    return { candidates, rawText: page.text, apiUrl };
  } catch {
    return { candidates: [], rawText: "", apiUrl };
  }
};

export const searchPrhByName = (name: string): Promise<PrhLookup> =>
  lookup(`name=${encodeURIComponent(name)}`);

export const getPrhByBusinessId = (businessId: string): Promise<PrhLookup> =>
  lookup(`businessId=${encodeURIComponent(businessId)}`);

const yearsAgo = (iso: string | null): number | null => {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return null;
  return (Date.now() - time) / (365.25 * 24 * 3600 * 1000);
};

/**
 * Deterministic register facts. Quotes are exact fragments of the API's JSON
 * body, so they verify against `verifiedAgainstUrl`; readers get the YTJ page.
 */
export const registerFacts = (
  candidate: EntityCandidate,
  lookupResult: PrhLookup,
): SourcedFact[] => {
  const facts: SourcedFact[] = [];
  const retrievedAt = nowIso();
  const base = {
    quoteLang: "en",
    sourceUrl: ytjPageUrl(candidate.businessId),
    verifiedAgainstUrl: lookupResult.apiUrl,
    retrievedAt,
  };

  if (candidate.registeredSince) {
    const age = yearsAgo(candidate.registeredSince);
    facts.push({
      ...base,
      id: nextFactId("prh"),
      kind: "company",
      text: `Registered in the Finnish trade register since ${candidate.registeredSince.slice(0, 4)}${
        age !== null ? ` (${Math.floor(age)} years)` : ""
      }.`,
      quote: `"value":"${candidate.businessId}","registrationDate":"${candidate.registeredSince}"`,
    });
  }

  if (candidate.businessLine) {
    facts.push({
      ...base,
      id: nextFactId("prh"),
      kind: "company",
      text: `Main line of business: ${candidate.businessLine.replace(/\.+$/, "")}.`,
      quote: `"description":"${candidate.businessLine}"`,
    });
  }

  // A recent rename is a genuine "why now" signal (new owner, merger, rebrand).
  const renameAge = yearsAgo(candidate.renamedOn);
  const previous = candidate.previousNames[0];
  if (previous && candidate.renamedOn && renameAge !== null && renameAge <= 3) {
    facts.push({
      ...base,
      id: nextFactId("prh"),
      kind: "why_now",
      text: `Renamed from ${previous.name} to ${candidate.name} on ${candidate.renamedOn}.`,
      quote: `"name":"${candidate.name}","type":"1","registrationDate":"${candidate.renamedOn}"`,
    });
  }

  return facts;
};
