/**
 * Demo-only seed for Velho itself. Pure module so it runs under `node --test`.
 *
 * When the researched company is velho.io / Velho Applied Intelligence Oy,
 * the pitch needs a real To-line (oskar@velho.io) and the official LinkedIn
 * page. Other companies are never touched.
 */

import type { LeaderProfile, SocialLink } from "@/types/outreach";

export const VELHO_DEMO_EMAIL = "oskar@velho.io";
export const VELHO_DEMO_LINKEDIN = "https://www.linkedin.com/company/velho/home/";

const fold = (value: string): string => value.trim().toLowerCase();

export const isVelhoCompany = (domain: string, companyName = ""): boolean => {
  const host = fold(domain).replace(/^www\./, "");
  if (host === "velho.io") return true;
  return fold(companyName).includes("velho applied intelligence");
};

/** Real send is allowed only to Oskar on a velho.io video — never another inbox. */
export const isVelhoLiveRecipient = (
  address: string | null | undefined,
  videoUrl = "",
): boolean => {
  if (fold(address ?? "") !== VELHO_DEMO_EMAIL) return false;
  return /\/v\/velho\.io(?:[/?#]|$)/i.test(videoUrl);
};

export const seedVelhoDemo = (
  leaders: LeaderProfile[],
  socials: SocialLink[],
): { leaders: LeaderProfile[]; socials: SocialLink[] } => {
  const ceo: LeaderProfile = {
    role: "CEO",
    name: "Oskar",
    title: "Representative",
    publicStatements: [],
    email: { address: VELHO_DEMO_EMAIL, method: "published", confidence: "high" },
    confidence: "high",
    evidence: null,
  };

  const seededLeaders = leaders.some((leader) => leader.role === "CEO")
    ? leaders.map((leader) =>
        leader.role === "CEO"
          ? {
              ...leader,
              name: "Oskar",
              title: leader.title || ceo.title,
              email: ceo.email,
              confidence: "high" as const,
            }
          : leader,
      )
    : [ceo, ...leaders];

  const linkedin: SocialLink = {
    platform: "linkedin",
    url: VELHO_DEMO_LINKEDIN,
    kind: "company",
    context: "Official Velho company page",
  };
  const withoutLinkedin = socials.filter(
    (link) => !(link.platform === "linkedin" && link.kind === "company"),
  );

  return { leaders: seededLeaders, socials: [linkedin, ...withoutLinkedin] };
};
