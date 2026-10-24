"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Copy,
  ExternalLink,
  Mail,
  Send,
  Smartphone,
} from "lucide-react";

import type { EmailOutput } from "@/types/pipeline";

interface EmailPreviewProps {
  email: EmailOutput;
  /** Opens the iPhone landing-page preview modal. */
  onPreviewMobile: () => void;
  /** True when the email came from the mock fallback path. */
  isFallback?: boolean;
}

const COPY_RESET_MS = 2000;

/** Render the email as a single string for the clipboard. */
const toClipboardText = (email: EmailOutput): string => {
  const body = [
    email.greeting,
    "",
    ...email.bodySentences,
    "",
    email.callToAction,
    "",
    email.signoff,
  ].join("\n");

  return `Subject: ${email.subject}\n\n${body}`;
};

export default function EmailPreview({
  email,
  onPreviewMobile,
  isFallback = false,
}: EmailPreviewProps) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const clipboardText = useMemo(() => toClipboardText(email), [email]);

  useEffect(() => {
    if (!copied && !copyFailed) return;
    const timer = setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, COPY_RESET_MS);
    return () => clearTimeout(timer);
  }, [copied, copyFailed]);

  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(clipboardText);
      } else {
        // Fallback for non-secure contexts (e.g. http:// on stage Wi-Fi).
        const textarea = document.createElement("textarea");
        textarea.value = clipboardText;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(textarea);
        if (!ok) throw new Error("execCommand copy failed");
      }
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
      setCopied(false);
    }
  }, [clipboardText]);

  const mailtoHref = useMemo(() => {
    const body = [
      email.greeting,
      "",
      ...email.bodySentences,
      "",
      email.callToAction,
      "",
      email.signoff,
    ].join("\n");
    return `mailto:?subject=${encodeURIComponent(
      email.subject,
    )}&body=${encodeURIComponent(body)}`;
  }, [email]);

  return (
    <section className="overflow-hidden rounded-2xl border border-velho-line bg-velho-panel/60">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-velho-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Mail className="h-4 w-4 text-zinc-500" strokeWidth={1.9} />
          <h2 className="text-[13px] font-semibold text-zinc-300">
            CEO Outreach Email
          </h2>
          <span className="rounded-full border border-velho-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            {email.bodySentences.length} sentences
          </span>
          {isFallback && (
            <span
              className="flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-300"
              title="Generated from the instant fallback profile"
            >
              <AlertTriangle className="h-2.5 w-2.5" strokeWidth={2.5} />
              Fallback
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onPreviewMobile}
            className="flex items-center gap-1.5 rounded-lg border border-velho-line bg-white/[0.02] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
          >
            <Smartphone className="h-3.5 w-3.5" strokeWidth={2} />
            Mobile preview
          </button>

          <a
            href={mailtoHref}
            className="flex items-center gap-1.5 rounded-lg border border-velho-line bg-white/[0.02] px-2.5 py-1.5 text-[11px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200"
          >
            <Send className="h-3.5 w-3.5" strokeWidth={2} />
            Open in mail
          </a>

          <button
            type="button"
            onClick={handleCopy}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
              copied
                ? "bg-emerald-500/15 text-emerald-300"
                : copyFailed
                  ? "bg-rose-500/15 text-rose-300"
                  : "bg-zinc-100 text-zinc-900 hover:bg-white"
            }`}
          >
            <AnimatePresence mode="wait" initial={false}>
              {copied ? (
                <motion.span
                  key="copied"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="flex items-center gap-1.5"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Copied
                </motion.span>
              ) : copyFailed ? (
                <motion.span
                  key="failed"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5"
                >
                  <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Press ⌘C
                </motion.span>
              ) : (
                <motion.span
                  key="copy"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5" strokeWidth={2.5} />
                  Copy email
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      </header>

      {/* Email body */}
      <div className="p-4">
        <div className="rounded-xl border border-velho-line bg-velho-void/60">
          {/* Subject line */}
          <div className="flex items-start gap-2 border-b border-velho-line px-4 py-3">
            <span className="mt-px shrink-0 text-[11px] font-medium uppercase tracking-wider text-zinc-600">
              Subject
            </span>
            <p className="text-[13px] font-semibold leading-relaxed text-zinc-100">
              {email.subject}
            </p>
          </div>

          {/* Body */}
          <div className="space-y-3 px-4 py-4 text-[13px] leading-[1.7] text-zinc-300">
            <p className="text-zinc-200">{email.greeting}</p>

            <div className="space-y-2.5">
              {email.bodySentences.map((sentence, index) => (
                <motion.p
                  key={`${index}-${sentence.slice(0, 24)}`}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.06 }}
                  className="flex gap-2.5"
                >
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-sky-500/60" />
                  <span>{sentence}</span>
                </motion.p>
              ))}
            </div>

            <p className="text-zinc-300">{email.callToAction}</p>

            {/* Video link chip */}
            <div className="pt-1">
              <a
                href={email.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group/link inline-flex max-w-full items-center gap-2 rounded-lg border border-sky-500/25 bg-sky-500/[0.07] px-3 py-2 font-mono text-[11px] text-sky-300 transition-colors hover:border-sky-400/50 hover:bg-sky-500/[0.12]"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                <span className="truncate">{email.videoUrl}</span>
              </a>
            </div>

            <p className="pt-1 text-zinc-500">{email.signoff}</p>
          </div>
        </div>

        {/* Plain-text toggle hint */}
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-[11px] font-medium text-zinc-600 transition-colors hover:text-zinc-400">
            View plain text
          </summary>
          <pre className="velho-scroll mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-xl border border-velho-line bg-velho-void/60 p-3 font-mono text-[11px] leading-relaxed text-zinc-400">
            {clipboardText}
          </pre>
        </details>
      </div>
    </section>
  );
}
