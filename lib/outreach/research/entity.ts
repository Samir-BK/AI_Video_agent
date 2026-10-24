import "server-only";

import {
  getPrhByBusinessId,
  registerFacts,
  searchPrhByName,
  type PrhLookup,
} from "@/lib/outreach/research/prh";
import type { EntityCandidate, EntityMatch, SourcedFact } from "@/types/outreach";

/**
 * Domain -> legal entity. The input is a website, while registers work by
 * company name or business ID, so we search PRH with a few candidate names
 * and prefer the company whose registered website matches the domain.
 */

const LEGAL_SUFFIX = /\b(oyj|oy|ab|ltd|limited|plc|inc|gmbh|group|konserni|ky|ay)\b/g;

export const normalizeCompanyName = (name: string): string =>
  name
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.,&()'"]/g, " ")
    .replace(LEGAL_SUFFIX, " ")
    .replace(/\s+/g, " ")
    .trim();

const hostOf = (value: string): string =>
  value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0] ?? "";

/** "tamtron.fi" -> "tamtron"; "en.example.com" -> "example". */
const brandLabel = (host: string): string => {
  const parts = host.split(".").filter(Boolean);
  return parts.length >= 2 ? (parts[parts.length - 2] ?? "") : (parts[0] ?? "");
};

type Scored = { candidate: EntityCandidate; score: number; method: EntityMatch["method"] };

const scoreCandidate = (
  candidate: EntityCandidate,
  domain: string,
  names: string[],
): Scored => {
  const host = hostOf(domain);
  const website = candidate.website ? hostOf(candidate.website) : "";

  if (website && website === host) return { candidate, score: 100, method: "website" };
  if (website && brandLabel(website) === brandLabel(host)) {
    return { candidate, score: 80, method: "website" };
  }

  const normalized = normalizeCompanyName(candidate.name);
  const label = brandLabel(host);
  let score = 0;
  for (const raw of names) {
    const query = normalizeCompanyName(raw);
    if (!query) continue;
    if (normalized === query) score = Math.max(score, 60);
    else if (normalized.startsWith(`${query} `) || normalized.startsWith(query)) {
      score = Math.max(score, 40);
    }
  }
  if (label && normalized.replace(/\s+/g, "") === label) score = Math.max(score, 55);
  // A fuzzy name match whose registered website points elsewhere is suspect.
  // An exact legal-name match keeps its score (companies often register a
  // short domain, e.g. "Lassila & Tikanoja Oyj" -> lt.fi).
  if (website && brandLabel(website) !== label && score < 60) score -= 20;
  return { candidate, score, method: score > 0 ? "name" : "none" };
};

/** Words that precede a company name in footers ("Copyright Example Oy"). */
const LEADING_NOISE = new Set([
  "copyright", "tekijänoikeus", "all", "rights", "reserved", "by", "powered", "from", "and",
]);

/** "Sinituote Oy", "Würth Oy", "Lassila & Tikanoja Oyj". */
const LEGAL_NAME_PATTERN =
  /(\p{Lu}[\p{L}.'-]+(?: (?:&|\p{Lu}[\p{L}.'-]+)){0,3}) (Oyj|Oy|Ab)(?![\p{L}])/gu;

/**
 * Legal names printed on the company's own site ("© Sinituote Oy") are the
 * best hint for the register search. Names containing the domain's brand
 * label rank first, then by frequency.
 */
export const legalNamesFromText = (texts: string[], domain: string): string[] => {
  const label = brandLabel(hostOf(domain));
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const match of text.matchAll(LEGAL_NAME_PATTERN)) {
      const words = (match[1] ?? "").split(" ");
      while (words.length > 1 && LEADING_NOISE.has((words[0] ?? "").toLowerCase())) {
        words.shift();
      }
      const name = `${words.join(" ")} ${match[2] ?? ""}`.trim();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => {
      const aHas = normalizeCompanyName(a[0]).includes(label) ? 1 : 0;
      const bHas = normalizeCompanyName(b[0]).includes(label) ? 1 : 0;
      return bHas - aHas || b[1] - a[1];
    })
    .map(([name]) => name)
    .slice(0, 2);
};

export interface EntityResolution {
  match: EntityMatch;
  facts: SourcedFact[];
  /** Raw register texts for quote verification, keyed by API URL. */
  sourceTexts: Map<string, string>;
}

const confidenceFor = (score: number): EntityMatch["confidence"] =>
  score >= 80 ? "high" : score >= 55 ? "medium" : "low";

export const resolveEntity = async (
  domain: string,
  candidateNames: string[],
  overrideBusinessId?: string,
): Promise<EntityResolution> => {
  const sourceTexts = new Map<string, string>();
  const remember = (result: PrhLookup) => {
    if (result.rawText) sourceTexts.set(result.apiUrl, result.rawText);
  };

  if (overrideBusinessId) {
    const result = await getPrhByBusinessId(overrideBusinessId);
    remember(result);
    const candidate = result.candidates[0] ?? null;
    return {
      match: {
        candidate,
        confidence: candidate ? "high" : "low",
        method: "override",
        alternatives: [],
        note: candidate
          ? "Company chosen by the operator"
          : `No active company found for business ID ${overrideBusinessId}`,
      },
      facts: candidate ? registerFacts(candidate, result) : [],
      sourceTexts,
    };
  }

  const queries = [
    ...new Set(candidateNames.map((name) => name.trim()).filter((name) => name.length >= 2)),
  ].slice(0, 3);
  const lookups = await Promise.all(queries.map((query) => searchPrhByName(query)));
  lookups.forEach(remember);

  const byId = new Map<string, { candidate: EntityCandidate; lookup: PrhLookup }>();
  for (const result of lookups) {
    for (const candidate of result.candidates) {
      if (!byId.has(candidate.businessId)) {
        byId.set(candidate.businessId, { candidate, lookup: result });
      }
    }
  }

  const scored = [...byId.values()]
    .map(({ candidate }) => scoreCandidate(candidate, domain, queries))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  // A weak name-only match is never auto-selected: the operator picks.
  if (!best || best.score < 55) {
    return {
      match: {
        candidate: null,
        confidence: "low",
        method: "none",
        alternatives: scored.filter((s) => s.score > 0).slice(0, 6).map((s) => s.candidate),
        note: lookups.every((l) => !l.rawText)
          ? "Trade register could not be reached"
          : best && best.score > 0
            ? "No confident register match — please pick the right company"
            : `No register match for ${queries.join(", ") || domain}`,
      },
      facts: [],
      sourceTexts,
    };
  }

  const bestLookup = byId.get(best.candidate.businessId)?.lookup;
  return {
    match: {
      candidate: best.candidate,
      confidence: confidenceFor(best.score),
      method: best.method,
      alternatives: scored.slice(1, 6).map((s) => s.candidate),
      note:
        best.method === "website"
          ? `Registered website matches ${hostOf(domain)}`
          : `Matched by company name "${best.candidate.name}" — please confirm`,
    },
    facts: bestLookup ? registerFacts(best.candidate, bestLookup) : [],
    sourceTexts,
  };
};
