/**
 * Criteria-search configuration and filters. Pure module (type-only imports).
 *
 * Industry codes were verified against the live PRH API on 24 Oct 2026. PRH
 * now classifies companies with TOL 2025, but older records still carry TOL
 * 2008 codes, so some groups list both (e.g. 41000 and 41200).
 * PRH matches `mainBusinessLine` as a SUBSTRING ("5210" also returns 25210),
 * so results are always post-filtered with `codeMatches`.
 */

import type { CompanySummary, ExclusionCount } from "@/types/outreach";

export interface IndustryGroup {
  id: string;
  label: string;
  codes: string[];
}

export const INDUSTRY_GROUPS: IndustryGroup[] = [
  {
    id: "logistics",
    label: "Logistics & transport",
    codes: ["49410", "52100", "52291", "53200"],
  },
  {
    id: "wholesale",
    label: "Industrial wholesale",
    codes: ["46642", "46649", "46620", "46630", "46842", "46850", "46900"],
  },
  {
    id: "manufacturing",
    label: "Manufacturing (metal, machinery, plastics, furniture)",
    codes: ["25110", "25990", "28290", "28990", "28920", "28220", "22260", "22290", "31000"],
  },
  {
    id: "construction",
    label: "Construction & installation",
    codes: ["41000", "41200", "43210", "43220", "42990"],
  },
  {
    id: "food",
    label: "Food production & wholesale",
    codes: ["10710", "10890", "46390", "46389"],
  },
];

export interface Region {
  id: string;
  label: string;
  /** Largest towns first: the request budget may stop before the last ones. */
  towns: string[];
}

export const REGIONS: Region[] = [
  {
    id: "uusimaa",
    label: "Uusimaa",
    towns: ["Helsinki", "Espoo", "Vantaa", "Hyvinkää", "Järvenpää", "Porvoo", "Kerava", "Tuusula"],
  },
  {
    id: "pirkanmaa",
    label: "Pirkanmaa",
    towns: ["Tampere", "Nokia", "Ylöjärvi", "Kangasala", "Lempäälä", "Valkeakoski"],
  },
  {
    id: "varsinais-suomi",
    label: "Varsinais-Suomi",
    towns: ["Turku", "Salo", "Kaarina", "Raisio", "Lieto", "Loimaa"],
  },
  {
    id: "pohjois-pohjanmaa",
    label: "Pohjois-Pohjanmaa",
    towns: ["Oulu", "Raahe", "Kempele", "Ylivieska"],
  },
  {
    id: "paijat-hame",
    label: "Päijät-Häme",
    towns: ["Lahti", "Hollola", "Orimattila", "Heinola"],
  },
];

export const DEFAULT_MIN_AGE_YEARS = 10;

/** Accept "52100", "5210", "521" — 3 to 5 digits. */
export const isTolCode = (value: string): boolean => /^\d{3,5}$/.test(value.trim());

/** Expand group ids and raw codes into a de-duplicated list of codes. */
export const expandIndustries = (industries: string[]): string[] => {
  const codes: string[] = [];
  for (const item of industries) {
    const group = INDUSTRY_GROUPS.find((g) => g.id === item);
    for (const code of group ? group.codes : isTolCode(item) ? [item.trim()] : []) {
      if (!codes.includes(code)) codes.push(code);
    }
  }
  return codes;
};

/** Expand a region id plus typed towns into towns (region order kept). */
export const expandTowns = (region: string | undefined, cities: string[] = []): string[] => {
  const towns = [...(REGIONS.find((r) => r.id === region)?.towns ?? [])];
  for (const city of cities) {
    const clean = city.trim();
    if (clean && !towns.some((t) => t.toLowerCase() === clean.toLowerCase())) towns.push(clean);
  }
  return towns;
};

/** Prefix match on the company's code (the API itself matches substrings). */
export const codeMatches = (companyCode: string | null, codes: string[]): boolean =>
  companyCode !== null && codes.some((code) => companyCode.startsWith(code));

/** Latest registration date that still satisfies the minimum age. */
export const registrationDateEnd = (minAgeYears: number, now: Date): string => {
  const date = new Date(now);
  date.setUTCFullYear(date.getUTCFullYear() - Math.max(0, Math.floor(minAgeYears)));
  return date.toISOString().slice(0, 10);
};

/** Whole years since registration; null when unknown. */
export const ageInYears = (company: CompanySummary, now: Date): number | null => {
  if (!company.registeredSince) return null;
  const since = Date.parse(company.registeredSince);
  if (Number.isNaN(since)) return null;
  return Math.floor((now.getTime() - since) / (365.25 * 24 * 3600 * 1000));
};

/* ------------------------------ exclusions ------------------------------ */

export interface ExclusionRule {
  id: string;
  label: string;
  test: (company: CompanySummary) => boolean;
}

// No \b here: in JS it treats "ö" as a non-word character, so "Kiinteistö Oy"
// would slip through. Require whitespace or end of string instead.
const HOUSING_NAME = /^(asunto|as\.|as oy|kiinteistö|kiint\.|koy|bostads|fastighets)(?=\s|$)/iu;

/** Non-prospects excluded by default. Order matters: first match is counted. */
export const EXCLUSION_RULES: ExclusionRule[] = [
  { id: "dissolved", label: "Dissolved", test: (c) => c.status === "ended" },
  {
    id: "insolvent",
    label: "In liquidation or bankruptcy",
    test: (c) => c.status === "liquidation" || c.status === "bankruptcy",
  },
  {
    id: "housing",
    label: "Housing / real-estate company",
    test: (c) =>
      HOUSING_NAME.test(c.name) ||
      (c.businessLineCode?.startsWith("68") ?? false) ||
      /housing|real estate|asunto|kiinteistö/i.test(c.companyForm ?? ""),
  },
  {
    id: "non_profit",
    label: "Foundation, association or religious body",
    test: (c) =>
      /foundation|association|säätiö|yhdistys|religious|church|seurakunta/i.test(c.companyForm ?? "") ||
      /\b(ry|sr)$/i.test(c.name.trim()),
  },
];

export interface ExclusionOutcome {
  kept: CompanySummary[];
  excluded: ExclusionCount[];
}

export const applyExclusions = (
  companies: CompanySummary[],
  rules: ExclusionRule[] = EXCLUSION_RULES,
): ExclusionOutcome => {
  const counts = new Map<string, ExclusionCount>(
    rules.map((rule) => [rule.id, { id: rule.id, label: rule.label, count: 0 }]),
  );
  const kept: CompanySummary[] = [];
  for (const company of companies) {
    const rule = rules.find((r) => r.test(company));
    if (rule) {
      const entry = counts.get(rule.id);
      if (entry) entry.count += 1;
    } else {
      kept.push(company);
    }
  }
  return { kept, excluded: [...counts.values()].filter((entry) => entry.count > 0) };
};
