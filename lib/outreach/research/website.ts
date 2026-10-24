import "server-only";

import { fetchPageText } from "@/lib/outreach/fetchText";
import type { ResearchSource, SourceOutput } from "@/lib/outreach/research/source";
import type { FetchedPage } from "@/types/outreach";

/**
 * Company website source: homepage plus the pages most likely to name the
 * leadership team, state goals, or announce news. Links found on the homepage
 * are preferred; common Finnish/English paths are guessed as a backup.
 */

const LINK_KEYWORDS =
  /(management|leadership|johto|hallitus|board|team|tiimi|about|meista|yritys|yhtio|company|investor|sijoittaj|strategy|strategia|news|uutis|tiedot|press|media|career|rekry|ura|tyopaik)/i;

const GUESSED_PATHS = [
  "/about",
  "/about-us",
  "/company",
  "/en/company",
  "/yritys",
  "/yhtio",
  "/management",
  "/leadership",
  "/about-us/management",
  "/johto",
  "/johtoryhma",
  "/fi/yhtio/johto",
  "/investors",
  "/sijoittajat",
  "/news",
  "/uutiset",
  "/careers",
  "/ura",
  "/rekry",
];

const PAGE_TIMEOUT_MS = 4000;
const MAX_PAGES = 14;

/** Score a link so leadership and investor pages are fetched first. */
const linkPriority = (url: string): number => {
  const path = new URL(url).pathname.toLowerCase();
  if (/(management|leadership|johto|johtoryhm)/.test(path)) return 0;
  if (/(investor|sijoittaj|strateg)/.test(path)) return 1;
  if (/(news|uutis|press|tiedot|media)/.test(path)) return 2;
  if (/(career|rekry|ura|tyopaik)/.test(path)) return 3;
  return 4;
};

export const websiteSource: ResearchSource = {
  id: "website",
  label: "Company website",
  run: async (ctx): Promise<SourceOutput> => {
    const startedAt = Date.now();
    const home = await fetchPageText(ctx.origin, { timeoutMs: PAGE_TIMEOUT_MS });
    const pages: FetchedPage[] = home ? [home] : [];

    const fromLinks = (home?.links ?? [])
      .filter((url) => LINK_KEYWORDS.test(new URL(url).pathname))
      .sort((a, b) => linkPriority(a) - linkPriority(b));
    const guessed = GUESSED_PATHS.map((path) => `${ctx.origin}${path}`);

    const seen = new Set<string>([ctx.origin, `${ctx.origin}/`, home?.url ?? ""]);
    const queue: string[] = [];
    for (const url of [...fromLinks, ...guessed]) {
      const key = url.replace(/\/$/, "");
      if (seen.has(key) || seen.has(url)) continue;
      seen.add(key);
      queue.push(url);
      if (queue.length >= MAX_PAGES) break;
    }

    const fetched = await Promise.all(
      queue.map((url) => fetchPageText(url, { timeoutMs: PAGE_TIMEOUT_MS })),
    );

    const byUrl = new Map<string, FetchedPage>();
    for (const page of [...pages, ...fetched]) {
      if (page && page.text.length > 150 && !byUrl.has(page.url)) {
        byUrl.set(page.url, page);
      }
    }

    const collected = [...byUrl.values()];
    return {
      pages: collected,
      facts: [],
      log: [
        {
          source: "Company website",
          ok: collected.length > 0,
          durationMs: Date.now() - startedAt,
          note: home
            ? `Read ${collected.length} page(s) on ${new URL(ctx.origin).hostname}`
            : "Homepage could not be fetched",
          url: ctx.origin,
        },
      ],
    };
  },
};
