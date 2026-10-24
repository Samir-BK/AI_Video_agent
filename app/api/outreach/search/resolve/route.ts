import { getCompanyById } from "@/lib/outreach/search/prhSearch";
import { resolveCompanyDomain } from "@/lib/outreach/search/resolveDomain";

/**
 * GET /api/outreach/search/resolve?businessId=<id>
 *
 * Looks the company up by business ID and finds its website: the registered
 * one, or a guessed domain verified against the homepage (legal name or
 * business ID). Returns domain null when nothing can be verified.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const BUSINESS_ID = /^\d{7}-\d$/;

const json = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function GET(request: Request): Promise<Response> {
  const businessId = (new URL(request.url).searchParams.get("businessId") ?? "").trim();
  if (!BUSINESS_ID.test(businessId)) {
    return json({ error: "Expected a business ID like 0107011-5" }, 400);
  }

  const company = await getCompanyById(businessId);
  if (!company) {
    return json({ error: "Company not found in the trade register (or register unreachable)" }, 404);
  }

  const resolution = await resolveCompanyDomain(company);
  return json({ company, resolution });
}
