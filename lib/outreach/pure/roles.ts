/**
 * Map a published job title to CEO / COO / CFO.
 *
 * Finnish companies rarely use "COO"; the person running operations is often
 * titled production, logistics or supply-chain director. Pure module.
 */

import type { ExecRole } from "@/types/outreach";

const normalizeTitle = (title: string): string =>
  title.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

/** Deputies and unit heads are not the company-level role holder. */
const EXCLUDED = [
  "varatoimitusjohtaja",
  "deputy ceo",
  "vice ceo",
  "deputy managing director",
  "assistant",
  "assistentti",
];

const CEO_PATTERNS = [
  /\bceo\b/,
  /chief executive/,
  /\btoimitusjohtaja\b/,
  /managing director/,
  /\bpresident and ceo\b/,
  /\bverkställande direktör\b/,
  /\bvd\b/,
];

const CFO_PATTERNS = [
  /\bcfo\b/,
  /chief financial/,
  /\btalousjohtaja\b/,
  /finance director/,
  /director,? finance/,
  /head of finance/,
  /\bekonomidirektör\b/,
  /\bfinanschef\b/,
  /\btalous- ja hallintojohtaja\b/,
];

const COO_PATTERNS = [
  /\bcoo\b/,
  /chief operating/,
  /operatiivinen johtaja/,
  /\btuotantojohtaja\b/,
  /\blogistiikkajohtaja\b/,
  /\btoimitusketjujohtaja\b/,
  /supply chain/,
  /\boperations\b/,
  /production director/,
  /director,? production/,
  /head of production/,
  /\bdriftsdirektör\b/,
];

export const mapTitleToRole = (title: string): ExecRole | null => {
  const value = normalizeTitle(title);
  if (!value) return null;
  if (EXCLUDED.some((word) => value.includes(word))) return null;

  // CFO and COO first: "CFO, deputy to the CEO" must not become CEO.
  if (CFO_PATTERNS.some((pattern) => pattern.test(value))) return "CFO";
  if (COO_PATTERNS.some((pattern) => pattern.test(value))) return "COO";
  if (CEO_PATTERNS.some((pattern) => pattern.test(value))) return "CEO";
  return null;
};

/** Keywords used to locate leadership mentions in raw page text. */
export const ROLE_KEYWORDS: Record<ExecRole, string[]> = {
  CEO: ["toimitusjohtaja", "CEO", "Chief Executive Officer", "Managing Director"],
  CFO: ["talousjohtaja", "CFO", "Chief Financial Officer", "Finance Director"],
  COO: [
    "COO",
    "Chief Operating Officer",
    "operatiivinen johtaja",
    "tuotantojohtaja",
    "toimitusketjujohtaja",
    "logistiikkajohtaja",
    "SVP Operations",
    "Director, Operations",
    "Supply Chain Director",
  ],
};
