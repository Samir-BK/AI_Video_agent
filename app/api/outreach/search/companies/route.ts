import { compareSuggestions } from "@/lib/outreach/pure/searchRank";
import { nameMatchScore, queryFallbacks } from "@/lib/outreach/pure/searchText";
import { queryPrh } from "@/lib/outreach/search/prhSearch";
import type { CompanySearchResponse, CompanySuggestion } from "@/types/outreach";

/**
 * GET /api/outreach/search/companies?q=<name>
 *
 * Live company suggestions from the trade register (PRH open data, cached
 * 10 min). Active companies first, then by name match plus company
 * prominence (see searchRank). Never throws: when the register is
 * unreachable the response carries a `note` and no suggestions.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SUGGESTIONS = 10;

const json = (payload: CompanySearchResponse, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function GET(request: Request): Promise<Response> {
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (query.length < 2) {
    return json({ query, suggestions: [], totalResults: 0, note: "Type at least 2 characters" });
  }

  let page = await queryPrh({ name: query });
  if (!page.ok) {
    return json({ query, suggestions: [], totalResults: 0, note: page.error });
  }

  // Nothing found: retry a few spellings ("wurth" -> "würth", or the longest
  // word of a multi-word name). Matches are still scored against the query.
  let note: string | undefined;
  if (page.totalResults === 0) {
    for (const alternative of queryFallbacks(query)) {
      const retry = await queryPrh({ name: alternative });
      if (retry.ok && retry.companies.length > 0) {
        page = retry;
        note = `Showing results for “${alternative}”`;
        break;
      }
    }
  }

  const suggestions: CompanySuggestion[] = page.companies
    .map((company) => ({
      ...company,
      // nameMatchScore folds accents, so "wurth" still matches "Würth Oy".
      matchScore: nameMatchScore(query, company.name, company.previousNames),
    }))
    .filter((company) => company.matchScore > 0)
    // Active first, then name match plus prominence (head office, age, ...).
    .sort(compareSuggestions)
    .slice(0, MAX_SUGGESTIONS);

  return json({ query, suggestions, totalResults: page.totalResults, note });
}
