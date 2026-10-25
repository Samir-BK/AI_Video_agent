import { timingSafeEqual } from "node:crypto";

import { isVelhoLiveRecipient } from "@/lib/outreach/pure/velhoDemo";
import { readSenderConfig, resolveSender } from "@/lib/outreach/senders";
import { getOutreachStore, tokenKey } from "@/lib/outreach/store";
import type { RoleEmail, RoleEmailStatus } from "@/types/outreach";

/**
 * GET  /api/outreach/send
 *   Whether the pitch sender is ready (Gmail app password, or Resend).
 *
 * POST /api/outreach/send  { token }   header: x-admin-secret (real sends only)
 *
 * Sends one stored role email. Guard rails, in order:
 *   1. A real recipient needs OUTREACH_ADMIN_SECRET. A dry run skips that,
 *      because it only delivers to OUTREACH_TEST_EMAIL.
 *   2. The recipient must not be on the do-not-contact list.
 *   3. The daily per-inbox limit must not be reached.
 *   4. Gmail (GMAIL_APP_PASSWORD) or Resend (RESEND_API_KEY) must be configured.
 *   5. OUTREACH_DRY_RUN (default true) redirects to OUTREACH_TEST_EMAIL,
 *      except oskar@velho.io on a velho.io video (the live pitch).
 * Hackathon rule: real companies are never contacted without Velho's OK.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (status: number, payload: Record<string, unknown>): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/**
 * The dashboard already has the email. On Vercel the in-memory store is not
 * shared between requests, so a dry run can send that copy when the token
 * is missing. Real recipients still require the stored record.
 */
const clientEmail = (value: unknown, token: string): RoleEmail | null => {
  if (!value || typeof value !== "object") return null;
  const email = value as RoleEmail;
  if (email.token !== token) return null;
  if (typeof email.subject !== "string" || email.subject.length > 300) return null;
  if (typeof email.greeting !== "string" || typeof email.callToAction !== "string") return null;
  if (typeof email.videoUrl !== "string" || typeof email.unsubscribeUrl !== "string") return null;
  if (!Array.isArray(email.body) || email.body.some((line) => typeof line !== "string")) return null;
  if (!Array.isArray(email.footer) || email.footer.some((line) => typeof line !== "string")) return null;
  if (email.body.join("").length + email.footer.join("").length > 12_000) return null;
  if (!email.recipient || typeof email.recipient !== "object") return null;
  return email;
};

const secretMatches = (expected: string, given: string): boolean => {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
};

export async function GET(): Promise<Response> {
  const config = readSenderConfig();
  const sender = resolveSender(config);
  return json(200, {
    dryRun: config.dryRun,
    provider: sender?.id ?? null,
    inbox: config.testEmail,
  });
}

export async function POST(request: Request): Promise<Response> {
  const config = readSenderConfig();
  if (!config.dryRun) {
    if (!config.adminSecret) {
      return json(403, {
        error:
          "Sending to a real recipient is disabled. Set OUTREACH_ADMIN_SECRET, or keep OUTREACH_DRY_RUN=true to deliver only to your inbox.",
      });
    }
    if (!secretMatches(config.adminSecret, request.headers.get("x-admin-secret") ?? "")) {
      return json(401, { error: "Wrong admin secret." });
    }
  }

  let token = "";
  let posted: unknown;
  try {
    const body = (await request.json()) as { token?: unknown; email?: unknown };
    token = typeof body.token === "string" ? body.token : "";
    posted = body.email;
  } catch {
    return json(400, { error: "Expected JSON { token }" });
  }

  const store = getOutreachStore();
  const found = token ? store.getEmailByToken(token) : null;
  const email = found?.email ?? (config.dryRun ? clientEmail(posted, token) : null);
  if (!email) return json(404, { error: "Unknown email token." });

  const address = email.recipient.email;
  const liveToOskar = isVelhoLiveRecipient(address, email.videoUrl);
  if ((address && store.isDoNotContact(address)) || store.isDoNotContact(tokenKey(token))) {
    store.setEmailStatus(token, "opted_out");
    return json(409, { error: "Recipient has opted out.", status: "opted_out" });
  }

  if (store.sentToday() >= config.dailyLimit) {
    return json(429, { error: `Daily limit of ${config.dailyLimit} emails reached for this inbox.` });
  }

  const sender = resolveSender(config);
  if (!sender) {
    return json(400, {
      error:
        "Gmail is not connected. Set GMAIL_APP_PASSWORD, OUTREACH_SENDER_EMAIL, and OUTREACH_TEST_EMAIL (in .env.local locally, or in the Vercel project settings) and redeploy.",
    });
  }

  let to: string;
  if (liveToOskar) {
    to = address as string;
  } else if (config.dryRun) {
    if (!config.testEmail) {
      return json(400, { error: "Dry run needs OUTREACH_TEST_EMAIL (the team's test inbox)." });
    }
    to = config.testEmail;
  } else {
    if (!address) return json(409, { error: "No verified address for this recipient." });
    to = address;
  }

  const result = await sender.send({ email, to, dryRun: config.dryRun && !liveToOskar });
  if (!result.ok) {
    return json(502, { error: result.error ?? "Send failed", provider: result.provider });
  }

  const status: RoleEmailStatus = config.dryRun && !liveToOskar ? "dry_run_sent" : "sent";
  store.recordSend();
  store.setEmailStatus(token, status);
  return json(200, { status, deliveredTo: to, provider: result.provider, id: result.id });
}
