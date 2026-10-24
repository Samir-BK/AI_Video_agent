import "server-only";

import { fetchPageText, fetchRawText } from "@/lib/outreach/fetchText";
import { robotsSitemaps, sitemapLocs } from "@/lib/outreach/pure/htmlData";
import type { ResearchSource, SourceOutput } from "@/lib/outreach/research/source";
import type { FetchedPage } from "@/types/outreach";

/**
 * Company website source: homepage plus the pages most likely to name the
 * leadership team, state goals, or announce news. Links found on the homepage
 * are preferred; common Finnish/English paths are guessed as a backup.
 * Sites rendered in the browser expose few links in their HTML, so the
 * sitemap is read as well when the homepage yields too few candidates.
 */

const LINK_KEYWORDS =
  /(management|leadership|johto|hallitus|board|team|tiimi|about|meista|yritys|yhtio|company|investor|sijoittaj|strategy|strategia|news|uutis|tiedot|press|media|career|rekry|ura|tyopaik|contact|kontakt|yhteys)/i;

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
  // Contact pages often list leaders' work addresses.
  "/yhteystiedot",
  "/contact",
];

const PAGE_TIMEOUT_MS = 4000;
/** Finish before the source runner's 6 s cut-off, which would drop every page. */
const OWN_BUDGET_MS = 5500;
const SITEMAP_TIMEOUT_MS = 3000;
const MAX_PAGES = 14;
/** Below this many keyword links on the homepage, consult the sitemap. */
const MIN_HOME_LINKS = 4;
const MAX_CHILD_SITEMAPS = 3;
/** Extra management pages found on the first round of pages. */
const MAX_SECOND_HOP = 4;

/** Score a link so leadership and investor pages are fetched first. */
const linkPriority = (url: string): number => {
  const path = new URL(url).pathname.toLowerCase();
  if (/(management|leadership|johto|johtoryhm)/.test(path)) return 0;
  if (/(investor|sijoittaj|strateg|yhteystied|contact|kontakt)/.test(path)) return 1;
  if (/(news|uutis|press|tiedot|media)/.test(path)) return 2;
  if (/(career|rekry|ura|tyopaik)/.test(path)) return 3;
  return 4;
};

const sameSite = (url: string, origin: string): boolean => {
  try {
    return new URL(url).hostname.replace(/^www\./, "") === new URL(origin).hostname.replace(/^www\./, "");
  } catch {
    return false;
  }
};

/**
 * Keyword pages listed in the site's sitemap (robots.txt first, then
 * /sitemap.xml). Follows a sitemap index one level down, skipping children
 * that list products, images or recipes.
 */
const sitemapPages = async (origin: string, deadline: number): Promise<string[]> => {
  const budget = (): number => Math.min(SITEMAP_TIMEOUT_MS, deadline - Date.now());
  const robots = await fetchRawText(`${origin}/robots.txt`, budget());
  const roots = robots ? robotsSitemaps(robots) : [];
  if (!roots.length) roots.push(`${origin}/sitemap.xml`);

  if (budget() < 800) return [];
  const rootXml = await fetchRawText(roots[0] ?? "", budget());
  if (!rootXml) return [];
  const root = sitemapLocs(rootXml);
  const pages = [...root.pages];
  const children = root.sitemaps
    .filter((url) => !/(product|tuote|image|video|recipe|resepti)/i.test(url))
    .sort((a, b) => Number(/page|sivu/i.test(b)) - Number(/page|sivu/i.test(a)))
    .slice(0, MAX_CHILD_SITEMAPS);
  const childXml =
    budget() < 800 ? [] : await Promise.all(children.map((url) => fetchRawText(url, budget())));
  for (const xml of childXml) if (xml) pages.push(...sitemapLocs(xml).pages);

  return pages
    .filter((url) => {
      if (!sameSite(url, origin)) return false;
      const path = new URL(url).pathname;
      // Multilingual sites: keep Finnish, English and Swedish versions only.
      const locale = /^\/([a-z]{2})(?:-[a-z]{2})?\//i.exec(path)?.[1]?.toLowerCase();
      if (locale && !["fi", "en", "sv"].includes(locale)) return false;
      return LINK_KEYWORDS.test(path);
    })
    // Shallow pages first: /fi/yhtio/johto beats a dated news article.
    .sort(
      (a, b) =>
        linkPriority(a) - linkPriority(b) ||
        new URL(a).pathname.split("/").length - new URL(b).pathname.split("/").length,
    );
};

export const websiteSource: ResearchSource = {
  id: "website",
  label: "Company website",
  run: async (ctx): Promise<SourceOutput> => {
    const startedAt = Date.now();
    const deadline = startedAt + OWN_BUDGET_MS;
    const left = (): number => deadline - Date.now();
    const home = await fetchPageText(ctx.origin, { timeoutMs: PAGE_TIMEOUT_MS });
    const pages: FetchedPage[] = home ? [home] : [];

    const fromLinks = (home?.links ?? [])
      .filter((url) => LINK_KEYWORDS.test(new URL(url).pathname))
      .sort((a, b) => linkPriority(a) - linkPriority(b));
    const fromSitemap =
      fromLinks.length < MIN_HOME_LINKS && left() > 2500
        ? await sitemapPages(home?.url ? new URL(home.url).origin : ctx.origin, deadline - 1500)
        : [];
    const guessed = GUESSED_PATHS.map((path) => `${ctx.origin}${path}`);

    const seen = new Set<string>([ctx.origin, `${ctx.origin}/`, home?.url ?? ""]);
    const queue: string[] = [];
    for (const url of [...fromLinks, ...fromSitemap, ...guessed]) {
      const key = url.replace(/\/$/, "");
      if (seen.has(key) || seen.has(url)) continue;
      seen.add(key);
      queue.push(url);
      if (queue.length >= MAX_PAGES) break;
    }

    const fetched = await Promise.all(
      queue.map((url) => fetchPageText(url, { timeoutMs: Math.min(PAGE_TIMEOUT_MS, left() - 200) })),
    );

    // Second hop: the team page is often only linked from a "governance and
    // management" page (lt.fi/yritys/hallinto-johto -> /yritys/johtoryhma).
    const secondHop: string[] = [];
    for (const page of left() > 1000 ? fetched : []) {
      for (const url of page?.links ?? []) {
        const key = url.replace(/\/$/, "");
        if (seen.has(key) || seen.has(url) || linkPriority(url) !== 0) continue;
        seen.add(key);
        secondHop.push(url);
        if (secondHop.length >= MAX_SECOND_HOP) break;
      }
      if (secondHop.length >= MAX_SECOND_HOP) break;
    }
    const fetchedSecond = await Promise.all(
      secondHop.map((url) => fetchPageText(url, { timeoutMs: left() - 200 })),
    );

    const byUrl = new Map<string, FetchedPage>();
    for (const page of [...pages, ...fetched, ...fetchedSecond]) {
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
            ? `Read ${collected.length} page(s) on ${new URL(ctx.origin).hostname}` +
              (fromSitemap.length ? " (pages found via sitemap)" : "")
            : "Homepage could not be fetched",
          url: ctx.origin,
        },
      ],
    };
  },
};
