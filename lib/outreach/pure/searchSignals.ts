/**
 * Prospect signals read from public text: manual-work job titles and a stated
 * employee count. Pure module (no imports) so it runs under `node --test`.
 */

/**
 * Title words for roles whose daily work is largely repetitive admin —
 * the kind of work Velho automates. Finnish first, then English.
 */
const MANUAL_ROLE_WORDS = [
  "koordinaattori", "assistentti", "sihteeri", "asiakaspalvelu", "asiakaspalvelija",
  "tilauskäsittelijä", "tilaus", "laskutus", "laskuttaja", "reskontra", "kirjanpitäjä",
  "palkanlaskija", "palkanlaskenta", "toimisto", "käsittelijä", "huolinta", "huolitsija",
  "ajojärjestelijä", "logistiikkasuunnittelija", "varastonhoitaja", "ostaja", "hankinta",
  "myyntisihteeri", "myynnin tuki", "back office", "coordinator", "assistant", "secretary",
  "customer service", "order", "invoic", "billing", "accounts payable", "accounts receivable",
  "bookkeeper", "payroll", "office", "dispatcher", "forwarding", "procurement", "purchas",
  "sales support", "data entry", "administrator",
];

export const isManualWorkRole = (title: string): boolean => {
  const value = title.normalize("NFC").toLowerCase();
  return MANUAL_ROLE_WORDS.some((word) => value.includes(word));
};

export interface EmployeeCount {
  employees: number;
  /** Exact text from the page that states the number. */
  quote: string;
}

const NUMBER = "(\\d{1,3}(?:[\\s.,]\\d{3})?|\\d+)";

const PATTERNS: RegExp[] = [
  // "yli 200 ammattilaista", "noin 70 työntekijää", "120 henkilöä"
  new RegExp(
    `(?:yli|noin|n\\.|lähes|reilu|yhteensä)?\\s*${NUMBER}\\s*(?:työntekijää|työntekijän|henkilöä|henkeä|ammattilaista|asiantuntijaa|osaajaa)`,
    "iu",
  ),
  // "henkilöstö: 85", "henkilöstömäärä noin 85", "työllistää 85"
  new RegExp(
    `(?:henkilöstö(?:määrä)?|henkilökunta|työllistää)\\s*(?::|on|n\\.|noin|yli)?\\s*(?:noin|yli)?\\s*${NUMBER}`,
    "iu",
  ),
  // "over 150 employees", "200 people", "65 professionals"
  new RegExp(
    `(?:over|about|around|nearly|more than)?\\s*${NUMBER}\\s*(?:employees|people|professionals|staff members|experts)`,
    "iu",
  ),
];

const MIN_EMPLOYEES = 2;
const MAX_EMPLOYEES = 100_000;

/**
 * The first plausible employee count stated in `text`, with the exact
 * sentence fragment that states it. Years ("2024"), money and percentages
 * are rejected.
 */
export const extractEmployeeCount = (text: string): EmployeeCount | null => {
  for (const pattern of PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const raw = (match[1] ?? "").replace(/[\s.,]/g, "");
    const employees = Number.parseInt(raw, 10);
    if (!Number.isFinite(employees) || employees < MIN_EMPLOYEES || employees > MAX_EMPLOYEES) continue;

    // Reject years mistaken for counts ("vuonna 2024 työntekijää" is rare, but
    // "1985 people" would be odd) — a 4-digit number from 1900 to 2099.
    if (/^(19|20)\d{2}$/.test(raw)) continue;

    const before = text.slice(Math.max(0, match.index - 1), match.index);
    if (/[€$%\d]/.test(before)) continue;

    const quote = match[0].trim();
    return { employees, quote };
  }
  return null;
};
