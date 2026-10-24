import { filterHistory } from "@/lib/outreach/pure/searchText";
import { getOutreachStore } from "@/lib/outreach/store";
import type { HistoryRow, RoleEmailStatus } from "@/types/outreach";

/**
 * GET /api/outreach/search/history?q=&status=&minViews=&sort=date|views
 *
 * Companies already researched on this server, with email statuses and video
 * views per role. Read-only. The default store lives on this machine only
 * (see docs/OUTREACH_INTEGRATION.md), so a deployed instance sees its own runs.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: RoleEmailStatus[] = ["draft", "dry_run_sent", "sent", "no_address", "opted_out", "skipped"];
const MAX_ROWS = 200;

export async function GET(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const status = params.get("status") as RoleEmailStatus | null;
  const minViews = Number.parseInt(params.get("minViews") ?? "", 10);

  const store = getOutreachStore();
  const rows: HistoryRow[] = store.listResults().map((result) => {
    const views = store.getViews(result.domain);
    return {
      domain: result.domain,
      companyName: result.entity.candidate?.name ?? result.pipeline.discovery.companyName,
      businessId: result.entity.candidate?.businessId ?? null,
      createdAt: result.createdAt,
      language: result.language,
      sufficiency: result.sufficiency,
      emails: result.emails.map((email) => ({
        role: email.role,
        status: email.status,
        recipient: email.recipient.name,
      })),
      views,
      totalViews: views.CEO + views.COO + views.CFO,
    };
  });

  const filtered = filterHistory(rows, {
    q: params.get("q")?.slice(0, 80) ?? undefined,
    status: status && STATUSES.includes(status) ? status : undefined,
    minViews: Number.isFinite(minViews) && minViews > 0 ? minViews : undefined,
    sort: params.get("sort") === "views" ? "views" : "date",
  }).slice(0, MAX_ROWS);

  return new Response(JSON.stringify({ rows: filtered, total: rows.length }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
