/**
 * Key-free fact finder: picks sentences from fetched pages that state a goal,
 * a financial figure or a recent change, using keyword rules instead of a
 * model. Each fact's quote is a sentence copied verbatim from the page, so it
 * is verified like any other fact. Pure module (type-only imports).
 *
 * Used only when no LLM key is configured; the model reads the same pages
 * better when it is available.
 */

import type { FactKind } from "@/types/outreach";

export interface RulePage {
  url: string;
  text: string;
}

export interface RuleFact {
  kind: FactKind;
  /** The sentence itself (no translation without a model). */
  text: string;
  quote: string;
  quoteLang: "fi" | "en" | "sv";
  sourceUrl: string;
}

const MIN_LENGTH = 40;
const MAX_LENGTH = 280;
const MAX_PER_KIND = 2;
const MAX_FACTS = 6;

const fold = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/** Checked in this order; the first matching kind wins for a sentence. */
const RULES: [FactKind, RegExp][] = [
  [
    "financial",
    /(liikevaihto|liikevoitto|liiketulos|liiketoiminnan tulos|revenue|net sales|operating profit|ebitda|omsattning|rorelseresultat)[^.]{0,120}\d/,
  ],
  [
    "why_now",
    /(nimitetty|nimitettiin|yrityskaup|yritysjarjestel|aloittaa .{0,40}(johtaja|ceo)|appointed|has been named|yritysosto|ostaa .{0,60}(oy|ab|oyj)|acquir|investoi|investment of|uu(si|den|teen|tta) (tehda|tehta|tuotantolaito|toimipist|logistiikkakesk|varasto|jakelukesk)|new (plant|factory|facility|warehouse)|laajen|expan|muutosneuvottelu|yt-neuvottel|change negotiations|ennatys|record (year|order|sales)|kasvoi \d|grew \d)/,
  ],
  [
    "strategy_goal",
    /(tavoitteena|tavoitteemme|tavoittelemme|tavoite on|strategia(mme|n)? |strategy|our goal|we aim|aims to|target (is|of)|tahtaamme|visiomme|vision is|kasvustrategi|vuoteen 20\d\d mennessa|by 20\d\d)/,
  ],
];

/** Cookie banners, navigation and legal text are never facts. */
const BOILERPLATE =
  /(cookie|evaste|tietosuoja|privacy|copyright|©|kaikki oikeudet|all rights reserved|lue lisaa|read more|tilaa uutiskirje|newsletter|javascript|selain)/;

// Finnish: ä/ö, common words, genitive "L&T:n", or a -mme verb ("laajennamme").
const FINNISH_HINT = /([äö]|\b(ja|on|oli|ovat|vuonna|yhtiö|myös|perustuu)\b|\w:n\b|\w{3,}mme\b)/iu;
const SWEDISH_HINT = /\b(och|är|för|med|bolaget)\b/i;

const languageOf = (sentence: string): RuleFact["quoteLang"] =>
  FINNISH_HINT.test(sentence) ? "fi" : SWEDISH_HINT.test(sentence) ? "sv" : "en";

/** Sentences of a page: split on line breaks and sentence ends, kept verbatim. */
export const sentencesOf = (text: string): string[] =>
  text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-ZÅÄÖ0-9"“])/u))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= MIN_LENGTH && sentence.length <= MAX_LENGTH);

/**
 * Up to six facts, at most two per kind, best pages first.
 * `companyNames` must appear in sentences from pages outside `ownHost`
 * (news or register sites), so facts about other companies are not taken.
 */
export const ruleFacts = (pages: RulePage[], ownHost: string, companyNames: string[]): RuleFact[] => {
  const names = companyNames.map((name) => fold(name).trim()).filter((name) => name.length >= 3);
  const host = ownHost.replace(/^www\./, "").toLowerCase();
  const facts: RuleFact[] = [];
  const perKind = new Map<FactKind, number>();
  const seen = new Set<string>();

  for (const page of pages) {
    let pageHost = "";
    try {
      pageHost = new URL(page.url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      continue;
    }
    const ownPage = pageHost === host || pageHost.endsWith(`.${host}`);

    for (const sentence of sentencesOf(page.text)) {
      const folded = fold(sentence);
      if (BOILERPLATE.test(folded) || seen.has(folded)) continue;
      // A real sentence: several words, mostly letters, not a menu line.
      if (sentence.split(/\s+/).length < 7 || !/[a-zåäö]{3,} [a-zåäö]{3,}/u.test(sentence)) continue;
      if (!ownPage && !names.some((name) => folded.includes(name))) continue;

      const kind = RULES.find(([, pattern]) => pattern.test(folded))?.[0];
      if (!kind || (perKind.get(kind) ?? 0) >= MAX_PER_KIND) continue;

      seen.add(folded);
      perKind.set(kind, (perKind.get(kind) ?? 0) + 1);
      facts.push({ kind, text: sentence, quote: sentence, quoteLang: languageOf(sentence), sourceUrl: page.url });
      if (facts.length >= MAX_FACTS) return facts;
    }
  }
  return facts;
};
