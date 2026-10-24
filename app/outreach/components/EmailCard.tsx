"use client";

import { useState } from "react";
import { Check, Copy, ExternalLink, Mail } from "lucide-react";

import type { RoleEmail } from "@/types/outreach";

interface EmailCardProps {
  email: RoleEmail;
}

/** Plain-text rendering used for copy/paste into any mail client. */
export const emailToPlainText = (email: RoleEmail): string =>
  [
    `Subject: ${email.subject}`,
    "",
    email.greeting,
    "",
    email.body.join(" "),
    "",
    `${email.callToAction} ${email.videoUrl}`,
    "",
    "—",
    ...email.footer,
  ].join("\n");

const STATUS_LABELS: Record<RoleEmail["status"], string> = {
  draft: "Draft",
  dry_run_sent: "Dry run sent",
  sent: "Sent",
  no_address: "Draft · no address yet",
  opted_out: "Opted out",
  skipped: "Skipped",
};

export default function EmailCard({ email }: EmailCardProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(emailToPlainText(email));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

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
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`rounded-full px-2 py-0.5 ${
              email.writtenBy === "live"
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-amber-500/15 text-amber-300"
            }`}
          >
            {email.writtenBy === "live" ? "Written by model" : "Template fallback"}
          </span>
          <span className="rounded-full bg-zinc-700/40 px-2 py-0.5 text-zinc-300">
            {STATUS_LABELS[email.status]}
          </span>
        </div>
      </div>

      <p className="text-xs text-velho-muted">{email.theme}</p>
      {email.mergedRoles.length > 0 && (
        <p className="text-xs text-amber-200/80">
          No {email.mergedRoles.join("/")} found — that angle is folded into this email.
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

      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-2 rounded-lg border border-velho-line px-3 py-2 text-xs text-zinc-200 hover:bg-velho-ink"
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? "Copied" : "Copy email"}
      </button>
    </article>
  );
}
