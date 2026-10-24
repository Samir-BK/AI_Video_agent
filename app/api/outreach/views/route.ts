import { normalizeDomain } from "@/lib/mockData";
import { getOutreachStore } from "@/lib/outreach/store";
import type { ExecRole, RoleEmailStatus } from "@/types/outreach";

/**
 * GET /api/outreach/views?domain=<domain>
 *
 * Video-page views per role plus the current status of each stored email
 * (sent, opted out, …), polled by the dashboard.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ViewsResponse {
  views: Record<ExecRole, number>;
  statuses: Record<string, RoleEmailStatus>;
}

export async function GET(request: Request): Promise<Response> {
  const domain = normalizeDomain(new URL(request.url).searchParams.get("domain") ?? "");
  const store = getOutreachStore();
  const result = domain ? store.getResult(domain) : null;

  const payload: ViewsResponse = {
    views: domain ? store.getViews(domain) : { CEO: 0, COO: 0, CFO: 0 },
    statuses: Object.fromEntries(
      (result?.emails ?? []).map((email) => [email.token, email.status]),
    ),
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
