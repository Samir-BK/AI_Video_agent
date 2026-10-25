/**
 * Open the company's official social accounts with a copied video proposal.
 * Pure module (type-only imports) so it runs under `node --test`.
 *
 * Platforms do not let a web app DM on the operator's behalf. This builds a
 * caption plus one URL per official company account: a share dialog where the
 * platform has one (LinkedIn, X, Facebook), otherwise the public profile.
 */

import type { SocialLink, SocialPlatform } from "@/types/outreach";

export const SOCIAL_LABELS: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
};

/** Company pages only — never a person's /in/ profile or similar. */
export const officialCompanyAccounts = (links: SocialLink[]): SocialLink[] => {
  const seen = new Set<SocialPlatform>();
  const official: SocialLink[] = [];
  for (const link of links) {
    if (link.kind !== "company" || seen.has(link.platform)) continue;
    seen.add(link.platform);
    official.push(link);
  }
  return official;
};

export const proposalCaption = (
  companyName: string,
  videoUrl: string,
  callToAction: string,
): string =>
  [`A 45-second video for ${companyName}.`, callToAction.trim(), videoUrl]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

export interface ShareTarget {
  platform: SocialPlatform;
  label: string;
  profileUrl: string;
  openUrl: string;
}

/** URL opened for one official account. */
export const channelOpenUrl = (
  link: SocialLink,
  caption: string,
  videoUrl: string,
): string => {
  switch (link.platform) {
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(videoUrl)}`;
    case "x":
      return `https://twitter.com/intent/tweet?text=${encodeURIComponent(caption)}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(videoUrl)}`;
    default:
      return link.url;
  }
};

export interface SharePlan {
  caption: string;
  targets: ShareTarget[];
}

export const sharePlan = (
  links: SocialLink[],
  companyName: string,
  videoUrl: string,
  callToAction: string,
): SharePlan => {
  const caption = proposalCaption(companyName, videoUrl, callToAction);
  const targets = officialCompanyAccounts(links).map((link) => ({
    platform: link.platform,
    label: SOCIAL_LABELS[link.platform],
    profileUrl: link.url,
    openUrl: channelOpenUrl(link, caption, videoUrl),
  }));
  return { caption, targets };
};
