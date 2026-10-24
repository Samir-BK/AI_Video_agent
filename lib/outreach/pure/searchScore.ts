/**
 * Deterministic, explainable prospect score (0–100). Every point comes with a
 * reason the operator can read. Pure module (type-only imports).
 */

import type { CompanyEnrichment, CompanySummary, ScoreReason } from "@/types/outreach";

/** All weights in one place. */
export const SCORE_WEIGHTS = {
  base: 30,
  ageOver30: 20,
  ageOver20: 15,
  ageOver10: 10,
  limitedCompany: 10,
  registeredWebsite: 5,
  recentRename: 10,
  // Enrichment (M3)
  hiring: 30,
  verifiedWebsite: 5,
  noWebsite: -20,
  sizeInRange: 10,
  sizeOutOfRange: -10,
} as const;

/** Velho's sweet spot: established companies of a few dozen to ~200 people. */
export const IDEAL_SIZE = { min: 20, max: 250 } as const;

export interface ScoreContext {
  ageYears: number | null;
  now: Date;
  enrichment?: CompanyEnrichment;
}

const yearsSince = (iso: string | null, now: Date): number | null => {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : (now.getTime() - time) / (365.25 * 24 * 3600 * 1000);
};

export const scoreCompany = (
  company: CompanySummary,
  { ageYears, now, enrichment }: ScoreContext,
): { score: number; reasons: ScoreReason[] } => {
  const w = SCORE_WEIGHTS;
  const reasons: ScoreReason[] = [{ points: w.base, reason: "Matches the industry and area filters" }];

  if (company.registeredBefore1978) {
    reasons.push({ points: w.ageOver30, reason: "Registered before 1978" });
  } else if (ageYears !== null && ageYears >= 30) {
    reasons.push({ points: w.ageOver30, reason: `Established ${ageYears} years ago` });
  } else if (ageYears !== null && ageYears >= 20) {
    reasons.push({ points: w.ageOver20, reason: `Established ${ageYears} years ago` });
  } else if (ageYears !== null && ageYears >= 10) {
    reasons.push({ points: w.ageOver10, reason: `Established ${ageYears} years ago` });
  }

  if (/limited company|osakeyhtiö/i.test(company.companyForm ?? "")) {
    reasons.push({ points: w.limitedCompany, reason: "Limited company" });
  }

  // A rename in the last 3 years is a "why now" signal (merger, new owner).
  const renamedAgo = yearsSince(company.renamedOn, now);
  if (renamedAgo !== null && renamedAgo <= 3) {
    reasons.push({
      points: w.recentRename,
      reason: `Renamed ${company.renamedOn?.slice(0, 4)} (formerly ${company.previousNames[0] ?? "another name"})`,
    });
  }

  if (enrichment?.domain?.domain) {
    reasons.push(
      enrichment.domain.method === "registered"
        ? { points: w.registeredWebsite, reason: `Website ${enrichment.domain.domain} (registered)` }
        : { points: w.verifiedWebsite, reason: `Website ${enrichment.domain.domain} (verified)` },
    );
  } else if (enrichment && enrichment.status !== "pending") {
    reasons.push({ points: w.noWebsite, reason: "No website found" });
  } else if (company.website) {
    reasons.push({ points: w.registeredWebsite, reason: "Website registered in PRH" });
  }

  if (enrichment && enrichment.hiring.length > 0) {
    reasons.push({
      points: w.hiring,
      reason: `Hiring: ${enrichment.hiring
        .slice(0, 2)
        .map((fact) => fact.quote)
        .join(", ")}`,
    });
  }

  if (enrichment?.size) {
    const { employees } = enrichment.size;
    reasons.push(
      employees >= IDEAL_SIZE.min && employees <= IDEAL_SIZE.max
        ? { points: w.sizeInRange, reason: `About ${employees} employees (fits Velho's focus)` }
        : { points: w.sizeOutOfRange, reason: `About ${employees} employees (outside ${IDEAL_SIZE.min}–${IDEAL_SIZE.max})` },
    );
  }

  const total = reasons.reduce((sum, item) => sum + item.points, 0);
  return { score: Math.max(0, Math.min(100, total)), reasons };
};

/** Stable ordering: score, then age, then name. */
export const compareScored = (
  a: { score: number; ageYears: number | null; company: CompanySummary },
  b: { score: number; ageYears: number | null; company: CompanySummary },
): number =>
  b.score - a.score ||
  (b.ageYears ?? -1) - (a.ageYears ?? -1) ||
  a.company.name.localeCompare(b.company.name, "fi");
