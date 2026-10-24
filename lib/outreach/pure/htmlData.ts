/**
 * Data hidden in a page's HTML that a JavaScript-rendered site still ships:
 * meta descriptions, JSON-LD (schema.org) blocks, framework data blobs, and
 * links to the company's official social accounts. Pure module (no imports)
 * so it runs under `node --test`.
 *
 * Why: many large company sites (e.g. fazer.com) render their content in the
 * browser, so the visible text of the HTML is a single title line. The
 * structured data is genuine page content, so quotes taken from it still
 * verify against what was fetched.
 */

import type { SocialLink, SocialPlatform } from "@/types/outreach";

const decode = (value: string): string =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");

const META_NAMES = /^(description|og:description|og:title|og:site_name|twitter:description)$/i;

/** Text values of meta description / Open Graph tags. */
export const metaTexts = (html: string): string[] => {
  const out: string[] = [];
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const name = /(?:name|property)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    if (META_NAMES.test(name) && content.trim().length > 3) out.push(decode(content.trim()));
  }
  return [...new Set(out)];
};

/** Keys whose values are prose worth reading (not ids, urls or styling). */
const TEXT_KEYS = /^(name|legalName|alternateName|description|slogan|headline|jobTitle|title|text|articleBody|about|abstract|numberOfEmployees|value|foundingDate|address|streetAddress|addressLocality)$/i;

const collectStrings = (node: unknown, out: string[], depth = 0, key = ""): void => {
  if (depth > 12 || out.length > 400) return;
  if (typeof node === "string") {
    const value = node.trim();
    if (
      value.length >= 3 &&
      value.length <= 2000 &&
      !/^https?:\/\//.test(value) &&
      /\p{L}{3}/u.test(value) &&
      (TEXT_KEYS.test(key) || value.split(/\s+/).length >= 4)
    ) {
      out.push(value);
    }
    return;
  }
  if (typeof node === "number" && /numberOfEmployees|value/i.test(key)) {
    out.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectStrings(item, out, depth + 1, key);
    return;
  }
  if (node && typeof node === "object") {
    for (const [childKey, value] of Object.entries(node as Record<string, unknown>)) {
      collectStrings(value, out, depth + 1, childKey);
    }
  }
};

/** Readable strings from JSON-LD blocks and common framework data blobs. */
export const jsonTexts = (html: string): string[] => {
  const blocks: string[] = [];
  for (const match of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    blocks.push(match[1] ?? "");
  }
  const nextData = /<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)?.[1];
  if (nextData) blocks.push(nextData);

  const out: string[] = [];
  for (const block of blocks) {
    try {
      collectStrings(JSON.parse(block.trim()), out);
    } catch {
      // Malformed block: ignore.
    }
  }
  return [...new Set(out.map((value) => decode(value).replace(/\s+/g, " ")))].slice(0, 300);
};

/**
 * Structured text to append to the visible text, one item per line.
 * Empty when the page has none.
 */
export const structuredText = (html: string): string =>
  [...metaTexts(html), ...jsonTexts(html)].join("\n");

/* ------------------------------ social links ------------------------------ */

const PLATFORM_HOSTS: [RegExp, SocialPlatform][] = [
  [/(^|\.)instagram\.com$/i, "instagram"],
  [/(^|\.)facebook\.com$/i, "facebook"],
  [/(^|\.)linkedin\.com$/i, "linkedin"],
  [/(^|\.)(twitter|x)\.com$/i, "x"],
  [/(^|\.)youtube\.com$/i, "youtube"],
  [/(^|\.)tiktok\.com$/i, "tiktok"],
];

/** Paths that are share buttons or generic pages, not accounts. */
const NOT_AN_ACCOUNT = /\/(sharer|share|intent|plugins|dialog|hashtag|explore|watch|embed|p\/|reel\/|login|help)/i;

const NOT_AN_ACCOUNT_HOST = /^(platform|static|api|graph|connect|cdn|developers|business|ads|about|help)\./i;

const stripTags =(value: string): string =>
  decode(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/**
 * Social links found anywhere in the HTML (anchors and JSON "sameAs" lists).
 * LinkedIn /in/ profiles are "person" links; everything else is "company".
 */
export const extractSocialLinks = (html: string): SocialLink[] => {
  const found = new Map<string, SocialLink>();
  for (const match of html.matchAll(/https?:\\?\/\\?\/[a-z0-9.-]+\.[a-z]{2,}[^"'\s<>)]*/gi)) {
    const raw = match[0].replace(/\\\//g, "/");
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    const platform = PLATFORM_HOSTS.find(([pattern]) => pattern.test(url.hostname))?.[1];
    if (
      !platform ||
      NOT_AN_ACCOUNT.test(url.pathname) ||
      url.pathname.replace(/\/+$/, "") === "" ||
      // Embed scripts and assets (platform.twitter.com/widgets.js), not accounts.
      NOT_AN_ACCOUNT_HOST.test(url.hostname) ||
      /\.(js|css|png|jpe?g|gif|svg|ico|json)$/i.test(url.pathname)
    ) {
      continue;
    }

    const kind: SocialLink["kind"] =
      platform === "linkedin" && /^\/in\//i.test(url.pathname) ? "person" : "company";
    // Keep only the account part: /company/fazer/posts -> /company/fazer,
    // /fazersuomi/reels -> /fazersuomi.
    const segments = url.pathname.split("/").filter(Boolean);
    const keep = platform === "linkedin" || platform === "youtube" ? 2 : 1;
    const accountPath = segments[0]?.startsWith("@") ? segments.slice(0, 1) : segments.slice(0, keep);
    const clean = `${url.origin}/${accountPath.join("/")}`;
    if (found.has(clean)) continue;

    const index = match.index ?? 0;
    const context = stripTags(html.slice(Math.max(0, index - 400), Math.min(html.length, index + 200)));
    found.set(clean, { platform, url: clean, kind, context: context.slice(-400) });
  }
  return [...found.values()].slice(0, 60);
};

/* -------------------------------- sitemaps -------------------------------- */

/**
 * `<loc>` entries of a sitemap, split into page URLs and child sitemaps
 * (a sitemap index lists other sitemaps instead of pages).
 */
export const sitemapLocs = (xml: string): { pages: string[]; sitemaps: string[] } => {
  const isIndex = /<sitemapindex\b/i.test(xml);
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?\s*<\/loc>/gi)]
    .map((match) => decode(match[1] ?? "").trim())
    .filter((loc) => /^https?:\/\//i.test(loc));
  return isIndex ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] };
};

/** `Sitemap:` lines of a robots.txt file. */
export const robotsSitemaps = (robots: string): string[] =>
  [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((match) => match[1] ?? "").filter(Boolean);

/* ------------------------------ link matching ----------------------------- */

const fold = (value: string): string =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * A LinkedIn profile published on the company's own site next to this
 * person's full name. Never searched elsewhere: if the company does not link
 * it, the person has no profile link here.
 */
export const personLinkFor = (fullName: string | null, links: SocialLink[]): string | null => {
  if (!fullName) return null;
  const name = fold(fullName);
  if (!name.includes(" ")) return null;
  const slugWords = name.split(" ");
  const match = links.find(
    (link) =>
      link.kind === "person" &&
      // Name printed next to the link, or the profile slug spells it out.
      (fold(link.context).includes(name) || slugWords.every((word) => fold(link.url).includes(word))),
  );
  return match?.url ?? null;
};

/**
 * The company's official accounts: one per platform, preferring an account
 * whose path contains the brand (fazersuomi for fazer.com) over partner or
 * campaign links that happen to be on the page.
 */
export const companySocials = (links: SocialLink[], brand: string): SocialLink[] => {
  const brandKey = fold(brand).replace(/ /g, "");
  const byPlatform = new Map<SocialPlatform, SocialLink>();
  for (const link of links) {
    if (link.kind !== "company") continue;
    const current = byPlatform.get(link.platform);
    const onBrand = brandKey.length >= 3 && fold(link.url).replace(/ /g, "").includes(brandKey);
    const currentOnBrand =
      current !== undefined && brandKey.length >= 3 && fold(current.url).replace(/ /g, "").includes(brandKey);
    if (!current || (onBrand && !currentOnBrand)) byPlatform.set(link.platform, link);
  }
  return [...byPlatform.values()];
};
