import "server-only";

import { promises as dns } from "node:dns";

import { withTimeout } from "@/lib/outreach/fetchText";
import { detectPattern, resolveLeaderEmail } from "@/lib/outreach/pure/emailPattern";
import { companySocials, personLinkFor } from "@/lib/outreach/pure/htmlData";
import { coreName } from "@/lib/outreach/pure/searchText";
import type { FetchedPage, LeaderProfile, ResearchLogEntry, SocialLink } from "@/types/outreach";

/**
 * Work addresses for named leaders, from addresses the company publishes on
 * its website (or that web search finds on press releases and contact pages).
 * The company's mail domain may differ from the website (lt.fi publishes
 * etunimi.sukunimi@lassila-tikanoja.fi). A pattern-based address needs the
 * format published AND MX records; with no format anywhere, a first.last@
 * guess on a domain with MX records is offered, labelled unverified.
 * Also collects LinkedIn profiles the site links next to a leader's name and
 * the company's own social accounts — nothing is looked up elsewhere.
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
  companyName = "",
  /** Web-search pages: used for addresses only, never for social links. */
  extraPages: FetchedPage[] = [],
): Promise<{ leaders: LeaderProfile[]; socials: SocialLink[]; log: ResearchLogEntry }> => {
  const startedAt = Date.now();
  const brand = brandOf(websiteDomain);
  // The company's own mail domains: the website brand, or the legal name as a
  // domain label ("lassila-tikanoja", "lassilatikanoja").
  const nameWords = coreName(companyName)
    .split(" ")
    .map((word) => word.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
  const ownBrands = new Set([brand, nameWords.join(""), nameWords.join("-")].filter((b) => b.length >= 2));
  const siteAddresses = [
    ...new Set(
      [...pages, ...extraPages]
        .flatMap((page) => page.emails)
        .filter((address) => ownBrands.has(brandOf(address.split("@")[1] ?? ""))),
    ),
  ];

  const pattern = detectPattern(siteAddresses);
  const mxDomain = pattern?.domain ?? null;
  const mxOk = mxDomain ? await hasMx(mxDomain) : false;

  // Last resort: no format published anywhere. Guess on the domain the
  // company already uses for mail (any published address), else the website.
  const usedDomains = siteAddresses.map((address) => address.split("@")[1] ?? "").filter(Boolean);
  const guessCandidate = pattern ? null : (usedDomains[0] ?? websiteDomain.replace(/^www\./, ""));
  const guessDomain = guessCandidate && (await hasMx(guessCandidate)) ? guessCandidate : null;

  const siteLinks = pages.flatMap((page) => page.socialLinks);
  const withEmails = leaders.map((leader) => ({
    ...leader,
    email: resolveLeaderEmail(
      leader.name,
      siteAddresses,
      (domain) => mxOk && domain === mxDomain,
      guessDomain,
    ),
    linkedinUrl: personLinkFor(leader.name, siteLinks),
  }));
  const socials = companySocials(siteLinks, brand);

  const found = withEmails.filter((leader) => leader.email.address && leader.email.method !== "guessed").length;
  const guessed = withEmails.filter((leader) => leader.email.method === "guessed").length;
  const linked = withEmails.filter((leader) => leader.linkedinUrl).length;
  const named = withEmails.filter((leader) => leader.name).length;
  return {
    leaders: withEmails,
    socials,
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
            }${guessed ? ` · ${guessed} guessed as first.last@${guessDomain} (unverified)` : ""}${linked ? ` · ${linked} LinkedIn profile(s) linked on the site` : ""}${
              socials.length ? ` · company accounts: ${socials.map((s) => s.platform).join(", ")}` : ""
            }`,
    },
  };
};
