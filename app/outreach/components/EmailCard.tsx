"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download, Eye, ExternalLink, Mail, Send } from "lucide-react";

import {
  buildEml,
  emailToPlainText,
  emlFileName,
  gmailComposeUrl,
  rewriteLocalOrigins,
} from "@/lib/outreach/pure/emailText";
import ShareChannelsButton from "@/app/outreach/components/ShareChannelsButton";
import { isVelhoLiveRecipient } from "@/lib/outreach/pure/velhoDemo";
import type { RoleEmail, RoleEmailStatus, SocialLink } from "@/types/outreach";

interface EmailCardProps {
  email: RoleEmail;
  /** Live status (send / opt-out may change after generation). */
  status: RoleEmailStatus;
  views: number;
  adminSecret: string;
  /** True while sends are redirected to the operator's own inbox. */
  dryRun: boolean;
  /** Operator inbox. Dry-run "Open in Gmail" addresses this so To is already filled. */
  inboxEmail: string | null;
  companyName: string;
  companySocials: SocialLink[];
  onStatus: (token: string, status: RoleEmailStatus) => void;
}

const STATUS_LABELS: Record<RoleEmailStatus, string> = {
  draft: "Draft",
  dry_run_sent: "Dry run sent to test inbox",
  sent: "Sent",
  no_address: "Draft · no address yet",
  opted_out: "Opted out — do not contact",
  skipped: "Skipped",
};

export default function EmailCard({
  email,
  status,
  views,
  adminSecret,
  dryRun,
  inboxEmail,
  companyName,
  companySocials,
  onStatus,
}: EmailCardProps) {
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<string | null>(null);
  const optedOut = status === "opted_out";
  const shown = useMemo(
    () =>
      typeof window === "undefined"
        ? email
        : rewriteLocalOrigins(email, window.location.origin),
    [email],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(emailToPlainText(shown));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setSendNote("Could not copy. Select the email text instead.");
    }
  };

  const download = () => {
    const eml = buildEml(shown, {
      fromName: "Velho",
      fromAddress: "outreach@velho.io",
      date: new Date(),
    });
    const url = URL.createObjectURL(new Blob([eml], { type: "message/rfc822" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = emlFileName(shown.recipient.name || "outreach", shown);
    link.click();
    URL.revokeObjectURL(url);
  };

  const send = async () => {
    setSending(true);
    setSendNote(null);
    try {
      const response = await fetch("/api/outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": adminSecret },
        body: JSON.stringify({ token: shown.token, email: shown }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        status?: RoleEmailStatus;
        deliveredTo?: string;
        error?: string;
      };
      if (payload.status) onStatus(shown.token, payload.status);
      setSendNote(
        response.ok
          ? `Delivered to ${payload.deliveredTo ?? "the test inbox"}`
          : (payload.error ?? `Send failed (${response.status})`),
      );
    } catch {
      setSendNote("Could not reach the server.");
    } finally {
      setSending(false);
    }
  };

  const gmailTo = shown.recipient.email || (dryRun ? inboxEmail : "") || "";
  const liveToOskar = isVelhoLiveRecipient(shown.recipient.email, shown.videoUrl);

  const buttonClass =
    "inline-flex items-center gap-2 rounded-lg border border-velho-line px-3 py-2 text-xs text-zinc-200 hover:bg-velho-ink disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <article className="space-y-4 rounded-2xl border border-velho-line bg-velho-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-sky-300" />
          <span className="text-sm font-semibold text-zinc-100">
            {shown.role}
            {shown.recipient.name ? ` · ${shown.recipient.name}` : " · name not found"}
          </span>
          <span className="text-xs text-velho-muted">{shown.recipient.title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-700/40 px-2 py-0.5 text-zinc-300">
            <Eye className="h-3 w-3" /> {views} video view{views === 1 ? "" : "s"}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 ${
              shown.writtenBy === "live"
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-amber-500/15 text-amber-300"
            }`}
          >
            {shown.writtenBy === "live" ? "Written by model" : "Template fallback"}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 ${
              optedOut ? "bg-rose-500/15 text-rose-300" : "bg-zinc-700/40 text-zinc-300"
            }`}
          >
            {STATUS_LABELS[status]}
          </span>
        </div>
      </div>

      <p className="text-xs text-velho-muted">
        {shown.theme}
        {shown.recipient.email && <span className="ml-2 text-zinc-400">→ {shown.recipient.email}</span>}
        {shown.recipient.emailMethod === "guessed" && (
          <span className="ml-2 rounded-full bg-amber-500/15 px-1.5 text-amber-300">
            guessed address — unverified, may bounce
          </span>
        )}
      </p>
      {shown.mergedRoles.length > 0 && (
        <p className="text-xs text-amber-200/80">
          Also covers the {shown.mergedRoles.join("/")} angle (no separate email for that role).
        </p>
      )}

      <div className="space-y-3 rounded-xl border border-velho-line bg-velho-ink p-4 text-sm leading-relaxed text-zinc-200">
        <p className="font-semibold text-zinc-50">{shown.subject}</p>
        <p>{shown.greeting}</p>
        {shown.body.map((sentence, index) => (
          <p key={index}>{sentence}</p>
        ))}
        <p>
          {shown.callToAction}{" "}
          <a
            href={shown.videoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 break-all text-sky-300 hover:text-sky-200"
          >
            {shown.videoUrl} <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        </p>
        <div className="border-t border-velho-line pt-3 text-xs text-zinc-400">
          {shown.footer.map((line) => (
            <p key={line} className="break-all">
              {line}
            </p>
          ))}
        </div>
      </div>

      {shown.usedFacts.length > 0 && (
        <div className="space-y-1 text-xs text-zinc-400">
          <p className="font-semibold text-zinc-300">Facts used in this email</p>
          {shown.usedFacts.map((fact) => (
            <p key={fact.id}>
              {fact.text} —{" "}
              <a href={fact.sourceUrl} target="_blank" rel="noreferrer" className="text-sky-300">
                source
              </a>
            </p>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className={buttonClass}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy email"}
        </button>
        <button
          type="button"
          onClick={download}
          disabled={optedOut}
          className={buttonClass}
        >
          <Download className="h-3.5 w-3.5" /> Download .eml
        </button>
        <a
          href={gmailComposeUrl(shown, gmailTo)}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass}
          aria-disabled={optedOut}
          title={
            gmailTo
              ? `Opens Gmail with To set to ${gmailTo}`
              : "No address found for this draft yet"
          }
          onClick={(event) => optedOut && event.preventDefault()}
        >
          <Mail className="h-3.5 w-3.5" /> Open in Gmail
        </a>
        <button
          type="button"
          onClick={send}
          disabled={sending || optedOut || (!dryRun && !liveToOskar && !adminSecret)}
          title={
            liveToOskar
              ? "Sends this draft to oskar@velho.io"
              : dryRun
                ? "Sends this draft from your Gmail to your own inbox"
                : adminSecret
                  ? "Send to the real recipient"
                  : "Enter the admin secret above to send to the real recipient"
          }
          className={buttonClass}
        >
          <Send className="h-3.5 w-3.5" />
          {sending ? "Sending…" : liveToOskar || !dryRun ? "Send" : "Send to my inbox"}
        </button>
        <ShareChannelsButton
          companyName={companyName}
          videoUrl={shown.videoUrl}
          callToAction={shown.callToAction}
          socials={companySocials}
        />
      </div>
      {sendNote && <p className="text-xs text-zinc-400">{sendNote}</p>}
    </article>
  );
}
