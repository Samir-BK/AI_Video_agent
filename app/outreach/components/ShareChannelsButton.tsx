"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";

import {
  officialCompanyAccounts,
  sharePlan,
  SOCIAL_LABELS,
} from "@/lib/outreach/pure/socialShare";
import type { SocialLink } from "@/types/outreach";

interface ShareChannelsButtonProps {
  companyName: string;
  videoUrl: string;
  callToAction: string;
  socials: SocialLink[];
  /** Extra classes on the button (defaults match the email-card actions). */
  className?: string;
}

const absoluteUrl = (value: string): string => {
  if (/^https?:\/\//i.test(value)) return value;
  if (typeof window === "undefined") return value;
  return `${window.location.origin}${value.startsWith("/") ? "" : "/"}${value}`;
};

/**
 * Copies the video pitch, then opens one tab per official company account.
 * LinkedIn / X / Facebook get a share dialog; Instagram / TikTok / YouTube
 * open the public profile. Platforms do not let this app send DMs.
 */
export default function ShareChannelsButton({
  companyName,
  videoUrl,
  callToAction,
  socials,
  className,
}: ShareChannelsButtonProps) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const accounts = officialCompanyAccounts(socials);
  if (accounts.length === 0) return null;

  const labels = accounts.map((account) => SOCIAL_LABELS[account.platform]).join(", ");

  const share = async () => {
    setBusy(true);
    setNote(null);
    const plan = sharePlan(socials, companyName, absoluteUrl(videoUrl), callToAction);
    try {
      await navigator.clipboard.writeText(plan.caption);
    } catch {
      setNote("Could not copy automatically — the caption is in the first tab.");
    }

    for (const [index, target] of plan.targets.entries()) {
      if (index > 0) {
        await new Promise((resolve) => setTimeout(resolve, 220));
      }
      const win = window.open(target.openUrl, "_blank");
      if (win) win.opener = null;
    }

    const channelList = plan.targets.map((target) => target.label).join(", ");
    setNote(
      `Copied the pitch. Opening ${channelList} — paste it into a post or message. Platforms do not let us send DMs. If a tab is missing, allow pop-ups and try again.`,
    );
    setBusy(false);
  };

  return (
    <div className="inline-flex max-w-md flex-col items-start gap-1">
      <button
        type="button"
        onClick={() => void share()}
        disabled={busy}
        title={`Copy the video pitch and open ${labels}. Does not send DMs.`}
        className={
          className ??
          "inline-flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-100 hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        }
      >
        <Share2 className="h-3.5 w-3.5" />
        {busy ? "Opening channels…" : "Share proposal on found channels"}
      </button>
      {note && <p className="text-xs text-zinc-400">{note}</p>}
    </div>
  );
}
