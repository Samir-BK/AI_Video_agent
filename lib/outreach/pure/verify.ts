/**
 * Quote verification: a fact is only accepted when its verbatim quote can be
 * found in the text we actually fetched from the source.
 *
 * Pure module (type-only imports) so it runs under `node --test` without a
 * build step.
 */

import type { SourcedFact } from "@/types/outreach";

/** Shortest quote we accept; anything shorter matches too easily. */
export const MIN_QUOTE_LENGTH = 12;

/**
 * Normalize text for matching: Unicode NFC, lower case, unified quote marks
 * and dashes, collapsed whitespace.
 */
export const normalizeForMatch = (value: string): string =>
  value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‘’‚‛´`]/g, "'")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Strip surrounding quote marks and trailing ellipses a model may add. */
const cleanQuote = (quote: string): string =>
  normalizeForMatch(quote)
    .replace(/^["']+|["']+$/g, "")
    .replace(/(\.\.\.|…)+$/g, "")
    .replace(/^(\.\.\.|…)+/g, "")
    .trim();

export const quoteAppearsIn = (quote: string, sourceText: string): boolean => {
  const needle = cleanQuote(quote);
  if (needle.length < MIN_QUOTE_LENGTH) return false;
  return normalizeForMatch(sourceText).includes(needle);
};

export interface VerificationOutcome {
  verified: SourcedFact[];
  rejected: SourcedFact[];
}

/**
 * Keep only facts whose quote appears in a fetched source.
 *
 * The fact's own `sourceUrl` is tried first. If the quote is not there but is
 * found on another fetched page, the fact is kept and re-pointed at the page
 * that really contains it (models sometimes cite the wrong page).
 */
export const verifyFacts = (
  candidates: SourcedFact[],
  sourceTexts: ReadonlyMap<string, string>,
): VerificationOutcome => {
  const verified: SourcedFact[] = [];
  const rejected: SourcedFact[] = [];

  for (const fact of candidates) {
    const checkUrl = fact.verifiedAgainstUrl ?? fact.sourceUrl;
    const ownText = sourceTexts.get(checkUrl);
    if (ownText !== undefined && quoteAppearsIn(fact.quote, ownText)) {
      verified.push(fact);
      continue;
    }

    let relocated: string | null = null;
    for (const [url, text] of sourceTexts) {
      if (quoteAppearsIn(fact.quote, text)) {
        relocated = url;
        break;
      }
    }

    if (relocated) {
      verified.push({ ...fact, sourceUrl: relocated, verifiedAgainstUrl: undefined });
    } else {
      rejected.push(fact);
    }
  }

  return { verified, rejected };
};

/** Drop facts that repeat the same quote (keeps the first occurrence). */
export const dedupeFacts = (facts: SourcedFact[]): SourcedFact[] => {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = cleanQuote(fact.quote);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
