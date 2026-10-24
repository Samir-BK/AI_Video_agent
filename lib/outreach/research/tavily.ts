import "server-only";

import { displayCompanyName, pickLinkedinProfile } from "@/lib/outreach/pure/linkedin";
import type { ResearchSource, SourceOutput } from "@/lib/outreach/research/source";
import type { FetchedPage, LeaderProfile, ResearchLogEntry } from "@/types/outreach";

/**
 * Optional web search via Tavily — active only when TAVILY_API_KEY is set.
 * Finds leadership news, interviews and press releases outside the company's
 * own site. Result text becomes extra pages for the extraction step, where
 * every quote is still verified against that text.
 */

const ENDPOINT = "https://api.tavily.com/search";
const TIMEOUT_MS = 5500;
const MAX_RESULTS = 4;

interface TavilyResult {
  url?: string;
  title?: string;
  content?: string;
  raw_content?: string | null;
}

export const isTavilyConfigured = (): boolean => Boolean(process.env.TAVILY_API_KEY?.trim());

interface SearchOptions {
  maxResults?: number;
  includeRawContent?: boolean;
  includeDomains?: string[];
}

const search = async (
  query: string,
  apiKey: string,
  { maxResults = MAX_RESULTS, includeRawContent = true, includeDomains }: SearchOptions = {},
): Promise<TavilyResult[]> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: maxResults,
        include_raw_content: includeRawContent,
        ...(includeDomains ? { include_domains: includeDomains } : {}),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { results?: TavilyResult[] };
    return payload.results ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
};

export const tavilySource: ResearchSource = {
  id: "tavily",
  label: "Web search (Tavily)",
  run: async (ctx): Promise<SourceOutput> => {
    const startedAt = Date.now();
    const apiKey = process.env.TAVILY_API_KEY?.trim() ?? "";
    if (!apiKey) {
      return { pages: [], facts: [], log: [] };
    }

    const company = ctx.entity?.name ?? ctx.companyName;
    const queries = [
      `"${company}" toimitusjohtaja talousjohtaja johtoryhmä`,
      `"${company}" strategia tavoite kasvu investointi`,
    ];
    const results = (await Promise.all(queries.map((query) => search(query, apiKey)))).flat();

    const byUrl = new Map<string, FetchedPage>();
    for (const result of results) {
      const text = (result.raw_content || result.content || "").trim();
      if (!result.url || text.length < 200 || byUrl.has(result.url)) continue;
      // Social networks never feed fact extraction (no profiling of people);
      // LinkedIn profile URLs are suggested separately, see below.
      if (/(linkedin|facebook|instagram|twitter|x)\.com/i.test(new URL(result.url).hostname)) {
        continue;
      }
      byUrl.set(result.url, {
        url: result.url,
        title: result.title ?? "",
        text: text.slice(0, 200_000),
        emails: [],
        links: [],
        socialLinks: [],
      });
    }

    const pages = [...byUrl.values()];
    return {
      pages,
      facts: [],
      log: [
        {
          source: "Web search (Tavily)",
          ok: pages.length > 0,
          durationMs: Date.now() - startedAt,
          note: `${pages.length} relevant page(s) from web search`,
        },
      ],
    };
  },
};

const MAX_LINKEDIN_LOOKUPS = 7;

/**
 * Suggest a LinkedIn profile for each named leader that the company site did
 * not link, from one web search per person (LinkedIn results only, titles and
 * snippets only — LinkedIn itself is never fetched). A suggestion needs the
 * full name in the result title and the company in the title or snippet; it
 * is still shown as unverified, and only the URL is kept.
 */
export const suggestLinkedinProfiles = async (
  leaders: LeaderProfile[],
  companyNames: string[],
): Promise<{ leaders: LeaderProfile[]; log: ResearchLogEntry | null }> => {
  const apiKey = process.env.TAVILY_API_KEY?.trim() ?? "";
  if (!apiKey) return { leaders, log: null };

  const startedAt = Date.now();
  const company = displayCompanyName(companyNames[0] ?? "");
  const wanted = leaders
    .filter((leader) => leader.name && !leader.linkedinUrl)
    .slice(0, MAX_LINKEDIN_LOOKUPS);
  const found = new Map<string, string>();
  await Promise.all(
    wanted.map(async (leader) => {
      const name = leader.name ?? "";
      const hits = await search(`"${name}" "${company}" LinkedIn`, apiKey, {
        maxResults: 5,
        includeRawContent: false,
        includeDomains: ["linkedin.com"],
      });
      const url = pickLinkedinProfile(hits, name, companyNames);
      if (url) found.set(name, url);
    }),
  );

  return {
    leaders: leaders.map((leader) =>
      leader.name && found.has(leader.name)
        ? { ...leader, linkedinSuggestion: found.get(leader.name) ?? null }
        : leader,
    ),
    log: {
      source: "LinkedIn suggestions (Tavily)",
      ok: found.size > 0,
      durationMs: Date.now() - startedAt,
      note: wanted.length
        ? `${found.size}/${wanted.length} profile(s) suggested — unverified, check before use`
        : "No named leaders without a site-linked profile",
    },
  };
};
