import { normalizeDomain } from "@/lib/mockData";
import { runOutreach } from "@/lib/outreach/orchestrator";
import { publicAppOrigin } from "@/lib/outreach/pure/publicOrigin";
import type { OutreachLanguage, OutreachStreamEvent } from "@/types/outreach";
import { EXEC_ROLES } from "@/types/outreach";

/**
 * POST /api/outreach  { domain, businessId?, language? }
 *
 * Streams Server-Sent Events: `progress` events while research runs, then one
 * `result` event with the full OutreachResult (or an `error` event). The
 * stream always ends cleanly so the dashboard never shows an error screen.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;
const BUSINESS_ID_PATTERN = /^\d{7}-\d$/;

interface Body {
  domain?: unknown;
  businessId?: unknown;
  language?: unknown;
}

const json = (status: number, payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export async function POST(request: Request): Promise<Response> {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json(400, { error: "Expected JSON { domain: string }" });
  }

  const domain = normalizeDomain(typeof body.domain === "string" ? body.domain : "");
  if (!domain || !DOMAIN_PATTERN.test(domain)) {
    return json(400, { error: "Use a bare domain like tamtron.fi" });
  }

  const businessId =
    typeof body.businessId === "string" && BUSINESS_ID_PATTERN.test(body.businessId.trim())
      ? body.businessId.trim()
      : undefined;
  const language: OutreachLanguage = body.language === "fi" ? "fi" : "en";
  const appOrigin = publicAppOrigin({
    configured: process.env.NEXT_PUBLIC_APP_URL,
    requestOrigin: new URL(request.url).origin,
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto"),
    vercelProductionHost: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    vercelHost: process.env.VERCEL_URL,
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start: async (controller) => {
      const send = (event: OutreachStreamEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const result = await runOutreach(
          { domain, businessId, language },
          { appOrigin, onProgress: send, roles: [...EXEC_ROLES] },
        );
        send({ type: "result", result });
      } catch (error) {
        send({
          type: "error",
          message:
            error instanceof Error
              ? `Outreach failed: ${error.message.slice(0, 200)}`
              : "Outreach failed",
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
