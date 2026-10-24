import { normalizeDomain } from "@/lib/mockData";
import { getOutreachStore } from "@/lib/outreach/store";

/**
 * GET /api/outreach/result?domain=<domain>
 *
 * The stored outreach result for a domain, so the dashboard can reopen a
 * previous run without researching (and spending LLM calls) again.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const domain = normalizeDomain(new URL(request.url).searchParams.get("domain") ?? "");
  const result = domain ? getOutreachStore().getResult(domain) : null;
  return new Response(
    JSON.stringify(result ? { result } : { error: `No stored result for ${domain || "that domain"}` }),
    {
      status: result ? 200 : 404,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    },
  );
}
