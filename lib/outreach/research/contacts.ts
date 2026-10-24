import "server-only";

import { promises as dns } from "node:dns";

import { withTimeout } from "@/lib/outreach/fetchText";
import { detectPattern, resolveLeaderEmail } from "@/lib/outreach/pure/emailPattern";
import type { FetchedPage, LeaderProfile, ResearchLogEntry } from "@/types/outreach";

/**
 * Work addresses for named leaders, using only addresses the company itself
 * publishes on its website. A pattern-based address is used only when the
 * site shows the format AND the mail domain has MX records.
 */

const MX_TIMEOUT_MS = 3000;

const brandOf = (host: string): string => {
  const parts = host.toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  return parts.length >= 2 ? (parts[parts.length - 2] ?? "") : (parts[0] ?? "");
};

const hasMx = async (domain: string): Promise<boolean> =>
  withTimeout(
    dns
      .resolveMx(domain)
      .then((records) => records.length > 0)
      .catch(() => false),
    MX_TIMEOUT_MS,
    false,
  );

export const assignLeaderEmails = async (
  leaders: LeaderProfile[],
  pages: FetchedPage[],
  websiteDomain: string,
): Promise<{ leaders: LeaderProfile[]; log: ResearchLogEntry }> => {
  const startedAt = Date.now();
  const brand = brandOf(websiteDomain);

  // Only the company's own mail domains (same brand as the website).
  const siteAddresses = [
    ...new Set(
      pages
        .flatMap((page) => page.emails)
        .filter((address) => brandOf(address.split("@")[1] ?? "") === brand),
    ),
  ];

  const pattern = detectPattern(siteAddresses);
  const mxDomain = pattern?.domain ?? null;
  const mxOk = mxDomain ? await hasMx(mxDomain) : false;

  const withEmails = leaders.map((leader) => ({
    ...leader,
    email: resolveLeaderEmail(leader.name, siteAddresses, (domain) => mxOk && domain === mxDomain),
  }));

  const found = withEmails.filter((leader) => leader.email.address).length;
  const named = withEmails.filter((leader) => leader.name).length;
  return {
    leaders: withEmails,
    log: {
      source: "Contact addresses",
      ok: found > 0,
      durationMs: Date.now() - startedAt,
      note:
        named === 0
          ? "No named leaders to address"
          : `${found}/${named} leader address(es) found${
              pattern
                ? ` · site format ${pattern.pattern}@${pattern.domain} (${pattern.support} example${pattern.support === 1 ? "" : "s"}, MX ${mxOk ? "ok" : "missing"})`
                : " · no personal address format published on the site"
            }`,
    },
  };
};
