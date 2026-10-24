/**
 * Map a published job title to a company-level role: CEO / COO / CFO, plus
 * CTO (IT), SALES, HR and SERVICE (customer service, purchasing, supply chain).
 *
 * Finnish companies rarely use "COO"; the person running operations is often
 * titled production or logistics director. Pure module.
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
  /\boperations\b/,
  /production director/,
  /director,? production/,
  /head of production/,
  /\bdriftsdirektör\b/,
];

const CTO_PATTERNS = [
  /\bcto\b/,
  /\bcio\b/,
  /\bcdo\b/,
  /chief (technology|information|digital)/,
  /\bteknologiajohtaja\b/,
  /\bit-johtaja\b/,
  /\btietohallintojohtaja\b/,
  /\bdigitalisaatiojohtaja\b/,
  /\bit director\b/,
  /director,? (it|technology|digital)/,
  /head of (it|technology|digital)/,
  /\bit-chef\b/,
];

const SALES_PATTERNS = [
  /\bcco\b/,
  /chief (commercial|sales|revenue)/,
  /\bmyyntijohtaja\b/,
  /\bkaupallinen johtaja\b/,
  /\bmyynti- ja markkinointijohtaja\b/,
  /sales director/,
  /director,? sales/,
  /\bvp,? sales\b/,
  /vice president,? sales/,
  /head of sales/,
  /\bförsäljningsdirektör\b/,
];

const HR_PATTERNS = [
  /\bchro\b/,
  /chief (human|people)/,
  /\bhenkilöstöjohtaja/,
  /\bhr-johtaja\b/,
  /\bhr director\b/,
  /people director/,
  /director,? (hr|human resources|people)/,
  /head of (hr|people|human resources)/,
  /\bpersonaldirektör\b/,
];

const SERVICE_PATTERNS = [
  /\basiakaspalvelujohtaja\b/,
  /\basiakaspalvelupäällikkö/,
  /customer service director/,
  /director,? customer service/,
  /head of customer (service|care|support)/,
  /\bhankintajohtaja\b/,
  /\bostojohtaja\b/,
  /chief procurement/,
  /(procurement|purchasing) director/,
  /director,? (procurement|purchasing)/,
  /head of (procurement|purchasing)/,
  /\btoimitusketjujohtaja\b/,
  /supply chain/,
];

/**
 * Checked in this order: the specific functions first, so "CFO, deputy to the
 * CEO" stays CFO and "Supply Chain Director" is not swallowed by COO's
 * generic "operations".
 */
const ROLE_ORDER: [ExecRole, RegExp[]][] = [
  ["CFO", CFO_PATTERNS],
  ["CTO", CTO_PATTERNS],
  ["HR", HR_PATTERNS],
  ["SALES", SALES_PATTERNS],
  ["SERVICE", SERVICE_PATTERNS],
  ["COO", COO_PATTERNS],
  ["CEO", CEO_PATTERNS],
];

export const mapTitleToRole = (title: string): ExecRole | null => {
  const value = normalizeTitle(title);
  if (!value) return null;
  if (EXCLUDED.some((word) => value.includes(word))) return null;
  return ROLE_ORDER.find(([, patterns]) => patterns.some((pattern) => pattern.test(value)))?.[0] ?? null;
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
    "logistiikkajohtaja",
    "SVP Operations",
    "Director, Operations",
  ],
  CTO: [
    "CTO",
    "CIO",
    "Chief Technology Officer",
    "Chief Information Officer",
    "Chief Digital Officer",
    "teknologiajohtaja",
    "tietohallintojohtaja",
    "IT-johtaja",
    "digitalisaatiojohtaja",
    "IT Director",
  ],
  SALES: [
    "myyntijohtaja",
    "kaupallinen johtaja",
    "CCO",
    "Chief Commercial Officer",
    "Sales Director",
    "VP Sales",
    "Head of Sales",
  ],
  HR: [
    "henkilöstöjohtaja",
    "HR-johtaja",
    "CHRO",
    "HR Director",
    "People Director",
    "Head of HR",
  ],
  SERVICE: [
    "asiakaspalvelujohtaja",
    "asiakaspalvelupäällikkö",
    "Customer Service Director",
    "Head of Customer Service",
    "hankintajohtaja",
    "ostojohtaja",
    "Procurement Director",
    "Purchasing Director",
    "toimitusketjujohtaja",
    "Supply Chain Director",
  ],
};
