/**
 * Ranking of name suggestions. Pure module (type-only imports) so it runs
 * under `node --test`.
 *
 * Name match alone ranks "Fazer Konserttitoimisto Oy" above "Oy Karl Fazer
 * Ab" for the query "fazer". A small prominence score — group head office,
 * the industries Velho serves, age, a registered website — lifts the company
 * a seller most likely means, and personal service firms sink.
 */

import type { CompanySummary } from "@/types/outreach";

/** Group parents ("Activities of head offices", TOL 70100). */
const HEAD_OFFICE = /^701/;
/** Manufacturing, construction, wholesale, transport and storage. */
const VELHO_INDUSTRIES = /^(1\d|2\d|3[0-3]|4[1-3]|46|49|5[0-2])/;
/** Lawyers, accountants, arts, personal services: usually one-person firms. */
const PERSONAL_SERVICE_LINES = /^(69|90|96)/;
const PERSONAL_SERVICE_NAMES =
  /\b(lakiasiaintoimisto|asianajotoimisto|tilitoimisto|konserttitoimisto|kampaamo|parturi|toiminimi|consulting)\b/i;

/** 0–40 bonus (can go negative) added to the 0–100 name match score. */
export const prominenceScore = (company: CompanySummary): number => {
  const line = company.businessLineCode ?? "";
  let score = 0;
  if (HEAD_OFFICE.test(line)) score += 30;
  else if (VELHO_INDUSTRIES.test(line)) score += 8;

  const year = Number.parseInt(company.registeredSince?.slice(0, 4) ?? "", 10);
  if (company.registeredBefore1978 || (year && year < 1990)) score += 10;
  else if (year && year < 2005) score += 5;

  if (company.website) score += 5;
  if (/julkinen|public/i.test(company.companyForm ?? "")) score += 10;

  if (PERSONAL_SERVICE_LINES.test(line) || PERSONAL_SERVICE_NAMES.test(company.name)) score -= 20;
  return score;
};

const STATUS_RANK = { active: 0, liquidation: 1, bankruptcy: 2, ended: 3 } as const;

/** Sort comparator: active first, then name match plus prominence. */
export const compareSuggestions = <T extends CompanySummary & { matchScore: number }>(a: T, b: T): number =>
  STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
  b.matchScore + prominenceScore(b) - (a.matchScore + prominenceScore(a)) ||
  b.matchScore - a.matchScore ||
  a.name.localeCompare(b.name);
