import { getOutreachStore, tokenKey } from "@/lib/outreach/store";

/**
 * POST /api/outreach/unsubscribe?t=<token>
 *
 * Adds the recipient behind the token to the do-not-contact list, which every
 * channel checks before sending. Two callers:
 *   - the confirm button on /unsubscribe (form POST -> redirect back), and
 *   - mail clients using RFC 8058 one-click (List-Unsubscribe-Post) -> 200.
 * A plain GET never unsubscribes, so link scanners cannot opt people out.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const url = new URL(request.url);
  let token = url.searchParams.get("t") ?? "";
  let fromForm = false;

  const type = request.headers.get("content-type") ?? "";
  if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
    const form = await request.formData().catch(() => null);
    const formToken = form?.get("t");
    if (typeof formToken === "string" && formToken) token = formToken;
    // One-click posts "List-Unsubscribe=One-Click"; our form posts "source=page".
    fromForm = form?.get("source") === "page";
  }

  const store = getOutreachStore();
  const record = token ? store.resolveToken(token) : null;
  if (record) {
    store.addDoNotContact(tokenKey(token));
    if (record.email) store.addDoNotContact(record.email);
    store.setEmailStatus(token, "opted_out");
  }

  if (fromForm) {
    return Response.redirect(
      new URL(`/unsubscribe?t=${encodeURIComponent(token)}&done=1`, url.origin),
      303,
    );
  }
  return new Response(record ? "Unsubscribed" : "Unknown token", {
    status: record ? 200 : 404,
  });
}
