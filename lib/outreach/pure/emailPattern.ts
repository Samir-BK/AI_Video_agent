/**
 * Work email addresses for named leaders.
 *
 * Order of trust:
 *   1. "published" — an address on the company's own site matches the person.
 *   2. "pattern"   — the site publishes other people's addresses in a clear
 *                    firstname.lastname@ format; we apply it to the leader.
 *   3. "none"      — no address. We never invent one without a known pattern.
 *
 * Pure module (type-only imports) so it runs under `node --test`.
 */

import type { Confidence, LeaderEmail } from "@/types/outreach";

export type AddressPattern = "first.last" | "first_last" | "first-last" | "firstlast" | "f.last";

/** Shared mailboxes that say nothing about the personal-address format. */
const GENERIC_LOCAL_PARTS = new Set([
  "info", "sales", "myynti", "asiakaspalvelu", "customerservice", "service", "support",
  "tuki", "office", "toimisto", "contact", "hello", "hei", "moi", "orders", "tilaukset",
  "invoices", "laskut", "lasku", "billing", "hr", "rekry", "recruitment", "careers",
  "marketing", "markkinointi", "media", "press", "viestinta", "noreply", "no-reply",
  "admin", "webmaster", "privacy", "tietosuoja", "gdpr", "finance", "talous", "kirjaamo",
  "huolto", "varaosat", "spareparts", "export", "logistics", "logistiikka", "palaute",
  "feedback", "ir", "investor.relations", "sijoittajat",
]);

/** Words that show a dotted address belongs to a team, not a person. */
const DEPARTMENT_WORDS = new Set([
  "customer", "asiakas", "order", "tilaus", "spare", "parts", "team", "tiimi", "group",
  "finland", "suomi", "fi", "global", "relations", "accounts", "payable", "receivable",
]);

/** Lower-case ASCII form used in addresses: "Hämäläinen" -> "hamalainen". */
export const asciiNamePart = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z-]/g, "");

export const splitName = (fullName: string): { first: string; last: string } | null => {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  const first = asciiNamePart(parts[0] ?? "");
  const last = asciiNamePart(parts[parts.length - 1] ?? "");
  return first && last ? { first, last } : null;
};

export const buildLocalPart = (fullName: string, pattern: AddressPattern): string | null => {
  const name = splitName(fullName);
  if (!name) return null;
  switch (pattern) {
    case "first.last":
      return `${name.first}.${name.last}`;
    case "first_last":
      return `${name.first}_${name.last}`;
    case "first-last":
      return `${name.first}-${name.last}`;
    case "firstlast":
      return `${name.first}${name.last}`;
    case "f.last":
      return `${name.first.charAt(0)}.${name.last}`;
  }
};

const ALL_PATTERNS: AddressPattern[] = ["first.last", "first_last", "first-last", "firstlast", "f.last"];

const localPartOf = (address: string): string => address.split("@")[0] ?? "";
const domainOf = (address: string): string => (address.split("@")[1] ?? "").toLowerCase();

/** Personal-looking addresses only (drops info@, myynti@, …). */
export const personalAddresses = (addresses: string[]): string[] =>
  addresses
    .map((address) => address.trim().toLowerCase())
    .filter((address) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(address))
    .filter((address) => !GENERIC_LOCAL_PARTS.has(localPartOf(address)));

/**
 * Detect the format from published personal addresses. Only formats that are
 * unambiguous without knowing the person are recognised:
 *   "matti.meikalainen" -> first.last, "m.meikalainen" -> f.last,
 *   "matti_meikalainen" -> first_last.
 */
export const detectPattern = (
  addresses: string[],
): { pattern: AddressPattern; domain: string; support: number } | null => {
  const tally = new Map<string, number>();
  for (const address of personalAddresses(addresses)) {
    const local = localPartOf(address);
    // "customer.service@" is a shared box, not a person.
    if (local.split(/[._-]/).some((part) => GENERIC_LOCAL_PARTS.has(part) || DEPARTMENT_WORDS.has(part))) {
      continue;
    }
    let pattern: AddressPattern | null = null;
    if (/^[a-z]{2,}\.[a-z][a-z-]{1,}$/.test(local)) pattern = "first.last";
    else if (/^[a-z]\.[a-z][a-z-]{1,}$/.test(local)) pattern = "f.last";
    else if (/^[a-z]{2,}_[a-z][a-z-]{1,}$/.test(local)) pattern = "first_last";
    if (!pattern) continue;
    const key = `${pattern}@${domainOf(address)}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }

  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best) return null;
  const [key, support] = best;
  const [pattern, domain] = key.split("@") as [AddressPattern, string];
  return { pattern, domain, support };
};

/**
 * Decide the address for one leader.
 * `mxOk` = the address domain accepts mail (checked by the caller).
 */
export const resolveLeaderEmail = (
  fullName: string | null,
  siteAddresses: string[],
  mxOk: (domain: string) => boolean,
): LeaderEmail => {
  const none: LeaderEmail = { address: null, method: "none", confidence: "low" };
  if (!fullName) return none;

  // 1. Published on the site for this exact person.
  const personal = personalAddresses(siteAddresses);
  for (const pattern of ALL_PATTERNS) {
    const local = buildLocalPart(fullName, pattern);
    if (!local) continue;
    const match = personal.find((address) => localPartOf(address) === local);
    if (match) return { address: match, method: "published", confidence: "high" };
  }

  // 2. Apply the company's published format.
  const detected = detectPattern(siteAddresses);
  if (detected && mxOk(detected.domain)) {
    const local = buildLocalPart(fullName, detected.pattern);
    if (local) {
      const confidence: Confidence = "medium";
      return { address: `${local}@${detected.domain}`, method: "pattern", confidence };
    }
  }

  return none;
};
