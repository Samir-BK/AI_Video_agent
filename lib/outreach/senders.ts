import "server-only";

import { buildEml, emailBodyText } from "@/lib/outreach/pure/emailText";
import type { RoleEmail } from "@/types/outreach";

/**
 * Sending. The default is DRAFT ONLY: the dashboard offers a .eml download,
 * a mailto: link and copy-to-clipboard, and nothing leaves the server.
 *
 * `ResendSender` is optional and only active when RESEND_API_KEY is set. Even
 * then OUTREACH_DRY_RUN defaults to true, which redirects every email to
 * OUTREACH_TEST_EMAIL. Resend's terms do not allow unsolicited bulk email, so
 * for real cold outreach the leader should plug in a dedicated provider behind
 * the same `EmailSender` interface (see docs/OUTREACH_INTEGRATION.md).
 */

export interface SendRequest {
  email: RoleEmail;
  /** Where the message actually goes (the test inbox in dry-run mode). */
  to: string;
  dryRun: boolean;
}

export interface SendResult {
  ok: boolean;
  provider: string;
  id?: string;
  error?: string;
}

export interface EmailSender {
  id: string;
  send: (request: SendRequest) => Promise<SendResult>;
}

export interface SenderConfig {
  fromName: string;
  fromAddress: string;
  dryRun: boolean;
  testEmail: string | null;
  adminSecret: string | null;
  dailyLimit: number;
}

const env = (name: string): string => process.env[name]?.trim() ?? "";

export const readSenderConfig = (): SenderConfig => {
  const limit = Number.parseInt(env("OUTREACH_DAILY_LIMIT_PER_INBOX"), 10);
  return {
    fromName: env("OUTREACH_SENDER_NAME") || "Velho",
    // Resend's shared test sender works without a verified domain, but only
    // delivers to the Resend account owner — fine for a dry run.
    fromAddress: env("OUTREACH_SENDER_EMAIL") || "onboarding@resend.dev",
    dryRun: env("OUTREACH_DRY_RUN").toLowerCase() !== "false",
    testEmail: env("OUTREACH_TEST_EMAIL") || null,
    adminSecret: env("OUTREACH_ADMIN_SECRET") || null,
    dailyLimit: Number.isFinite(limit) && limit > 0 ? limit : 40,
  };
};

/**
 * The .eml draft for download. Without OUTREACH_SENDER_EMAIL the From line is
 * a clearly invalid placeholder; the operator's mail client sends it from
 * their own account anyway.
 */
export const draftEml = (email: RoleEmail, config: SenderConfig): string =>
  buildEml(email, {
    fromName: config.fromName,
    fromAddress: env("OUTREACH_SENDER_EMAIL") || "outreach@velho.invalid",
    date: new Date(),
  });

const SEND_TIMEOUT_MS = 8000;

const resendSender = (apiKey: string, config: SenderConfig): EmailSender => ({
  id: "resend",
  send: async ({ email, to, dryRun }) => {
    const intended = email.recipient.email
      ? `${email.recipient.name ?? ""} <${email.recipient.email}>`.trim()
      : "(no address found)";
    const banner = dryRun
      ? `[DRY RUN — not sent to the real recipient. Intended for: ${intended}, ${email.recipient.title}]\n\n`
      : "";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${config.fromName} <${config.fromAddress}>`,
          to: [to],
          subject: dryRun ? `[Dry run] ${email.subject}` : email.subject,
          text: `${banner}${emailBodyText(email)}`,
          headers: {
            "List-Unsubscribe": `<${email.unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        id?: string;
        message?: string;
      };
      return response.ok
        ? { ok: true, provider: "resend", id: payload.id }
        : {
            ok: false,
            provider: "resend",
            error: payload.message ?? `Resend returned ${response.status}`,
          };
    } catch (error) {
      return {
        ok: false,
        provider: "resend",
        error: error instanceof Error ? error.message : "Send failed",
      };
    } finally {
      clearTimeout(timer);
    }
  },
});

/** The configured network sender, or null when sending is draft-only. */
export const resolveSender = (config: SenderConfig): EmailSender | null => {
  const key = env("RESEND_API_KEY");
  return key ? resendSender(key, config) : null;
};
