import { INDUSTRY_GROUPS, REGIONS, isTolCode } from "@/lib/outreach/pure/searchFilters";
import { scoreCompany } from "@/lib/outreach/pure/searchScore";
import { runCriteriaSearch } from "@/lib/outreach/search/criteria";
import { ENRICH_TOP_N, enrichMany } from "@/lib/outreach/search/enrich";
import type { CriteriaRequest, CriteriaStreamEvent } from "@/types/outreach";

/**
 * POST /api/outreach/search/criteria
 *   { industries: string[], region?, cities?, minAgeYears?, requireHiring?, onlyKnownSize? }
 *
 * Streams Server-Sent Events: `progress` while the trade register is queried,
 * then one `result` with the ranked, explained companies (or `error`).
 * GET returns the available industry groups and regions for the form.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const json = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function GET(): Promise<Response> {
  return json(200, {
    industries: INDUSTRY_GROUPS.map(({ id, label, codes }) => ({ id, label, codes })),
    regions: REGIONS.map(({ id, label, towns }) => ({ id, label, towns })),
  });
}

const parseRequest = (body: unknown): CriteriaRequest | string => {
  if (typeof body !== "object" || body === null) return "Expected a JSON object";
  const raw = body as Record<string, unknown>;

  const industries = Array.isArray(raw.industries)
    ? raw.industries.filter((i): i is string => typeof i === "string").slice(0, 12)
    : [];
  const valid = industries.filter(
    (i) => INDUSTRY_GROUPS.some((g) => g.id === i) || isTolCode(i),
  );
  if (valid.length === 0) return "Pick at least one industry (or enter a 3–5 digit TOL code)";

  const region =
    typeof raw.region === "string" && REGIONS.some((r) => r.id === raw.region) ? raw.region : undefined;
  const cities = Array.isArray(raw.cities)
    ? raw.cities
        .filter((c): c is string => typeof c === "string")
        .map((c) => c.trim().slice(0, 40))
        .filter((c) => /^[\p{L} .'-]{2,40}$/u.test(c))
        .slice(0, 10)
    : [];

  const minAge = Number(raw.minAgeYears);
  return {
    industries: valid,
    region,
    cities,
    minAgeYears: Number.isFinite(minAge) ? Math.min(100, Math.max(0, Math.floor(minAge))) : undefined,
    requireHiring: raw.requireHiring === true,
    onlyKnownSize: raw.onlyKnownSize === true,
  };
};

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Expected JSON" });
  }
  const parsed = parseRequest(body);
  if (typeof parsed === "string") return json(400, { error: parsed });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      let open = true;
      const send = (event: CriteriaStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false; // client went away
        }
      };
      try {
        const result = await runCriteriaSearch(parsed, (message, done, total) =>
          send({ type: "progress", message, done, total }),
        );
        send({ type: "result", result });

        // Enrich the top results live: website, job ads, stated size.
        const top = result.companies.slice(0, ENRICH_TOP_N);
        if (top.length > 0) {
          const startedAt = Date.now();
          const now = new Date();
          let checked = 0;
          send({ type: "progress", message: `Checking the top ${top.length}: website, job ads, size…`, done: 0, total: top.length });
          const summary = await enrichMany(
            top.map((row) => row.company),
            (company, enrichment) => {
              const row = top.find((r) => r.company.businessId === company.businessId);
              if (!row) return;
              checked += 1;
              const { score, reasons } = scoreCompany(company, { ageYears: row.ageYears, now, enrichment });
              send({
                type: "enriched",
                businessId: company.businessId,
                scored: { ...row, score, reasons, enrichment },
              });
              send({ type: "progress", message: `Checked ${checked} of ${top.length}`, done: checked, total: top.length });
            },
          );
          send({ type: "enrichment_done", ...summary, durationMs: Date.now() - startedAt });
        }
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? `Search failed: ${error.message.slice(0, 200)}` : "Search failed",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
    },
  });
}
