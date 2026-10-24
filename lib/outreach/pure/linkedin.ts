/**
 * LinkedIn helpers for named leaders. Pure module (no imports) so it runs
 * under `node --test`.
 *
 * Only a profile URL is ever kept — never profile content. LinkedIn pages are
 * not fetched (their terms forbid automated access): a suggestion comes from
 * a web-search result's title and snippet, and is shown as unverified.
 */

const fold = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const LEGAL_FORMS = /\b(oy|oyj|ab|abp|ltd|plc|inc|gmbh|ky|ay|osk)\b/gi;

/** "Lassila & Tikanoja Oyj" -> "Lassila & Tikanoja" (for search boxes). */
export const displayCompanyName = (name: string): string =>
  name.replace(LEGAL_FORMS, " ").replace(/\s+/g, " ").trim();

/** LinkedIn's own people search, opened by the operator in a new tab. */
export const linkedinSearchUrl = (fullName: string, companyName: string): string =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
    `${fullName} ${displayCompanyName(companyName)}`.trim(),
  )}`;

/** "https://fi.linkedin.com/in/eero-x-123?trk=1" -> "https://www.linkedin.com/in/eero-x-123". */
export const normalizeProfileUrl = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)linkedin\.com$/i.test(parsed.hostname)) return null;
    const match = /^\/in\/([^/?#]+)/i.exec(parsed.pathname);
    return match?.[1] ? `https://www.linkedin.com/in/${match[1]}` : null;
  } catch {
    return null;
  }
};

export interface SearchHit {
  url?: string;
  title?: string;
  content?: string;
}

/**
 * The first search hit that is a LinkedIn profile whose title carries every
 * word of the person's name AND whose title or snippet names the company
 * (any of `companyNames`, e.g. the legal core name and the website brand).
 * Same-name people are common, so the caller labels the result unverified.
 */
export const pickLinkedinProfile = (
  hits: SearchHit[],
  fullName: string,
  companyNames: string[],
): string | null => {
  const nameWords = fold(fullName).split(" ").filter(Boolean);
  if (nameWords.length < 2) return null;
  const companies = companyNames
    .map((name) => fold(displayCompanyName(name)))
    .filter((name) => name.length >= 3);
  if (companies.length === 0) return null;

  for (const hit of hits) {
    const url = normalizeProfileUrl(hit.url ?? "");
    if (!url) continue;
    const titleWords = ` ${fold(hit.title ?? "")} `;
    if (!nameWords.every((word) => titleWords.includes(` ${word} `))) continue;
    const text = ` ${fold(`${hit.title ?? ""} ${hit.content ?? ""}`)} `;
    if (companies.some((company) => text.includes(` ${company} `))) return url;
  }
  return null;
};
