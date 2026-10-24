import { emlFileName } from "@/lib/outreach/pure/emailText";
import { draftEml, readSenderConfig } from "@/lib/outreach/senders";
import { getOutreachStore } from "@/lib/outreach/store";

/**
 * GET /api/outreach/eml?t=<token>
 *
 * Downloads one role email as an unsent .eml draft that opens in Outlook,
 * Apple Mail or Thunderbird ready to review and send. Nothing is sent.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  const found = getOutreachStore().getEmailByToken(token);
  if (!found) {
    return new Response("Unknown email token.", { status: 404 });
  }

  const companyName =
    found.result.entity.candidate?.name ?? found.result.pipeline.discovery.companyName;
  const eml = draftEml(found.email, readSenderConfig());

  return new Response(eml, {
    status: 200,
    headers: {
      "Content-Type": "message/rfc822; charset=utf-8",
      "Content-Disposition": `attachment; filename="${emlFileName(companyName, found.email)}"`,
      "Cache-Control": "no-store",
    },
  });
}
