"use client";

import { useState } from "react";
import { Check, Copy, Download, Eye, ExternalLink, Mail, Send } from "lucide-react";

import { emailToPlainText, mailtoUrl } from "@/lib/outreach/pure/emailText";
import type { RoleEmail, RoleEmailStatus } from "@/types/outreach";

interface EmailCardProps {
  email: RoleEmail;
  /** Live status (send / opt-out may change after generation). */
  status: RoleEmailStatus;
  views: number;
  adminSecret: string;
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

export default function EmailCard({ email, status, views, adminSecret, onStatus }: EmailCardProps) {
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendNote, setSendNote] = useState<string | null>(null);
  const optedOut = status === "opted_out";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(emailToPlainText(email));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const send = async () => {
    setSending(true);
    setSendNote(null);
    try {
      const response = await fetch("/api/outreach/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-secret": adminSecret },
        body: JSON.stringify({ token: email.token }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        status?: RoleEmailStatus;
        deliveredTo?: string;
        error?: string;
      };
      if (payload.status) onStatus(email.token, payload.status);
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

  const buttonClass =
    "inline-flex items-center gap-2 rounded-lg border border-velho-line px-3 py-2 text-xs text-zinc-200 hover:bg-velho-ink disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <article className="space-y-4 rounded-2xl border border-velho-line bg-velho-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-sky-300" />
          <span className="text-sm font-semibold text-zinc-100">
            {email.role}
            {email.recipient.name ? ` · ${email.recipient.name}` : " · name not found"}
          </span>
          <span className="text-xs text-velho-muted">{email.recipient.title}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1 rounded-full bg-zinc-700/40 px-2 py-0.5 text-zinc-300">
            <Eye className="h-3 w-3" /> {views} video view{views === 1 ? "" : "s"}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 ${
              email.writtenBy === "live"
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-amber-500/15 text-amber-300"
            }`}
          >
            {email.writtenBy === "live" ? "Written by model" : "Template fallback"}
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
        {email.theme}
        {email.recipient.email && <span className="ml-2 text-zinc-400">→ {email.recipient.email}</span>}
      </p>
      {email.mergedRoles.length > 0 && (
        <p className="text-xs text-amber-200/80">
          Also covers the {email.mergedRoles.join("/")} angle (no separate email for that role).
        </p>
      )}

      <div className="space-y-3 rounded-xl border border-velho-line bg-velho-ink p-4 text-sm leading-relaxed text-zinc-200">
        <p className="font-semibold text-zinc-50">{email.subject}</p>
        <p>{email.greeting}</p>
        {email.body.map((sentence, index) => (
          <p key={index}>{sentence}</p>
        ))}
        <p>
          {email.callToAction}{" "}
          <a
            href={email.videoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 break-all text-sky-300 hover:text-sky-200"
          >
            {email.videoUrl} <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        </p>
        <div className="border-t border-velho-line pt-3 text-xs text-zinc-400">
          {email.footer.map((line) => (
            <p key={line} className="break-all">
              {line}
            </p>
          ))}
        </div>
      </div>

      {email.usedFacts.length > 0 && (
        <div className="space-y-1 text-xs text-zinc-400">
          <p className="font-semibold text-zinc-300">Facts used in this email</p>
          {email.usedFacts.map((fact) => (
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
        <a
          href={`/api/outreach/eml?t=${encodeURIComponent(email.token)}`}
          className={buttonClass}
          aria-disabled={optedOut}
          onClick={(event) => optedOut && event.preventDefault()}
        >
          <Download className="h-3.5 w-3.5" /> Download .eml
        </a>
        <a
          href={mailtoUrl(email)}
          className={buttonClass}
          aria-disabled={optedOut}
          onClick={(event) => optedOut && event.preventDefault()}
        >
          <Mail className="h-3.5 w-3.5" /> Open in mail app
        </a>
        <button
          type="button"
          onClick={send}
          disabled={sending || optedOut || !adminSecret}
          title={adminSecret ? "Send via the configured provider" : "Enter the admin secret above to send"}
          className={buttonClass}
        >
          <Send className="h-3.5 w-3.5" />
          {sending ? "Sending…" : "Send (dry run unless disabled)"}
        </button>
      </div>
      {sendNote && <p className="text-xs text-zinc-400">{sendNote}</p>}
    </article>
  );
}
