import "server-only";

import { htmlToText } from "@/lib/outreach/fetchText";
import { normalizeCompanyName } from "@/lib/outreach/research/entity";
import {
  nextFactId,
  nowIso,
  type ResearchSource,
  type SourceOutput,
} from "@/lib/outreach/research/source";
import type { SourcedFact } from "@/types/outreach";

/**
 * Open job ads from Duunitori's public search page. Ads that describe manual
 * work are a strong "why now" signal. Plain fetch, one request, short timeout.
 */

const SEARCH_URL = "https://duunitori.fi/tyopaikat";
const JOB_URL = "https://duunitori.fi/tyopaikat/tyo";
const TIMEOUT_MS = 5000;
const MAX_ADS = 6;

/** Standing "send us an application" posts are not real openings. */
const GENERIC_TITLES =
  /^(avoin hakemus|avoimet hakemukset|yleishakemus|open application|spontaneous application|öppen ansökan)\b/i;

const attr = (tag: string, name: string): string | null => {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`, "i"));
  return match?.[1] ?? null;
};

export const jobAdsSource: ResearchSource = {
  id: "jobs",
  label: "Job ads (Duunitori)",
  run: async (ctx): Promise<SourceOutput> => {
    const startedAt = Date.now();
    const company = ctx.entity?.name ?? ctx.companyName;
    const brand = normalizeCompanyName(company).split(" ")[0] ?? "";
    const searchUrl = `${SEARCH_URL}?haku=${encodeURIComponent(
      normalizeCompanyName(company) || company,
    )}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let html = "";
    try {
      const response = await fetch(searchUrl, {
        headers: { "User-Agent": "Mozilla/5.0 VelhoBot/1.0", "Accept-Language": "fi" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (response.ok) html = await response.text();
    } catch {
      html = "";
    } finally {
      clearTimeout(timer);
    }

    if (!html || brand.length < 3) {
      return {
        pages: [],
        facts: [],
        log: [
          {
            source: "Job ads (Duunitori)",
            ok: false,
            durationMs: Date.now() - startedAt,
            note: html ? "Company name too short to search" : "Job board not reachable",
            url: searchUrl,
          },
        ],
      };
    }

    const facts: SourcedFact[] = [];
    const seenRoles = new Set<string>();
    const retrievedAt = nowIso();
    const anchors = html.matchAll(/<a\b[^>]*class="[^"]*job-box__hover[^"]*"[^>]*>([\s\S]*?)<\/a>/gi);
    for (const anchor of anchors) {
      const tag = anchor[0].slice(0, anchor[0].indexOf(">") + 1);
      const advertiser = normalizeCompanyName(attr(tag, "data-company") ?? "");
      const slug = attr(tag, "data-job-slug");
      const inner = anchor[1] ?? "";
      const heading = inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? inner;
      const title = htmlToText(heading).split("\n")[0]?.trim() ?? "";

      // Keep ads posted by the company itself or naming it in the title
      // (staffing agencies often post on a client's behalf).
      const mentions =
        advertiser.includes(brand) || normalizeCompanyName(title).includes(brand);
      if (!mentions || title.length < 12 || !slug || GENERIC_TITLES.test(title)) continue;

      // The same opening is often posted by both the company and an agency.
      const roleKey = normalizeCompanyName(title).split(" ")[0] ?? title;
      if (seenRoles.has(roleKey)) continue;
      seenRoles.add(roleKey);

      facts.push({
        id: nextFactId("job"),
        kind: "hiring",
        text: `Open position: ${title}`,
        quote: title,
        quoteLang: "fi",
        sourceUrl: `${JOB_URL}/${slug}`,
        verifiedAgainstUrl: searchUrl,
        retrievedAt,
      });
      if (facts.length >= MAX_ADS) break;
    }

    return {
      pages: [{ url: searchUrl, title: "Duunitori search", text: htmlToText(html), emails: [], links: [] }],
      facts,
      log: [
        {
          source: "Job ads (Duunitori)",
          ok: true,
          durationMs: Date.now() - startedAt,
          note: facts.length
            ? `Found ${facts.length} open position(s)`
            : "No open positions found for this company",
          url: searchUrl,
        },
      ],
    };
  },
};
