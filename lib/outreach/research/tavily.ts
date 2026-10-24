import "server-only";

import type { ResearchSource, SourceOutput } from "@/lib/outreach/research/source";
import type { FetchedPage } from "@/types/outreach";

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

const search = async (query: string, apiKey: string): Promise<TavilyResult[]> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: MAX_RESULTS,
        include_raw_content: true,
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
      // Social networks are out of scope (no scraping or profiling of people).
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
