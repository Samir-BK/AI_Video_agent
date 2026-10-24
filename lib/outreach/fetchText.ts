import "server-only";

import { extractSocialLinks, structuredText } from "@/lib/outreach/pure/htmlData";
import type { FetchedPage } from "@/types/outreach";

/**
 * Deadline-bounded page fetcher that keeps the FULL visible text.
 *
 * The legacy `scrapeDomain` truncates pages to 4000 characters for LLM
 * context, which is too little to verify quotes against. This fetcher keeps
 * up to MAX_TEXT characters and never throws: it resolves to null on failure.
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 VelhoBot/1.0";

const MAX_TEXT = 200_000;
const MAX_HTML = 2_000_000;

const decodeEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&ndash;/gi, "–")
    .replace(/&mdash;/gi, "—")
    .replace(/&(auml|ouml|aring|Auml|Ouml|Aring);/g, (_, name: string) => {
      const map: Record<string, string> = {
        auml: "ä",
        ouml: "ö",
        aring: "å",
        Auml: "Ä",
        Ouml: "Ö",
        Aring: "Å",
      };
      return map[name] ?? "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    );

/** Visible text: drop scripts/styles, turn block tags into line breaks. */
export const htmlToText = (html: string): string =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_TEXT);

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

const extractEmails = (html: string): string[] => {
  const found = new Set<string>();
  for (const match of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    const address = decodeURIComponent(match[1] ?? "").toLowerCase();
    if (address.includes("@")) found.add(address);
  }
  for (const match of htmlToText(html).matchAll(EMAIL_PATTERN)) {
    found.add(match[0].toLowerCase());
  }
  return [...found].slice(0, 100);
};

const extractLinks = (html: string, baseUrl: string): string[] => {
  const base = new URL(baseUrl);
  const links = new Set<string>();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1] ?? "", base);
      if (url.hostname.replace(/^www\./, "") !== base.hostname.replace(/^www\./, "")) {
        continue;
      }
      if (/\.(pdf|jpe?g|png|gif|svg|zip|docx?|xlsx?)$/i.test(url.pathname)) continue;
      url.hash = "";
      links.add(url.toString());
    } catch {
      // Ignore malformed hrefs.
    }
  }
  return [...links].slice(0, 300);
};

const extractTitle = (html: string): string => {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match?.[1] ? decodeEntities(match[1]).replace(/\s+/g, " ").trim() : "";
};

export interface FetchTextOptions {
  timeoutMs: number;
  /** Accept JSON bodies (for open-data APIs); text is the raw body. */
  json?: boolean;
}

/** Fetch a URL and return its visible text. Never throws. */
export const fetchPageText = async (
  url: string,
  { timeoutMs, json = false }: FetchTextOptions,
): Promise<FetchedPage | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, 300));

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: json
          ? "application/json"
          : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "fi,en;q=0.8,sv;q=0.5",
      },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;

    const type = response.headers.get("content-type") ?? "";
    const body = (await response.text()).slice(0, MAX_HTML);

    if (json) {
      if (!type.includes("json")) return null;
      return { url: response.url || url, title: "", text: body, emails: [], links: [], socialLinks: [] };
    }

    if (!type.includes("html")) return null;
    const finalUrl = response.url || url;
    return {
      url: finalUrl,
      title: extractTitle(body),
      // Visible text plus structured data, so browser-rendered sites still read.
      text: [htmlToText(body), structuredText(body)].filter(Boolean).join("\n").slice(0, MAX_TEXT),
      emails: extractEmails(body),
      links: extractLinks(body, finalUrl),
      socialLinks: extractSocialLinks(body),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** Fetch a small text file (robots.txt, sitemap.xml) as-is. Never throws. */
export const fetchRawText = async (url: string, timeoutMs: number): Promise<string | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, 300));
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.text()).slice(0, MAX_HTML);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/** Resolve after `ms`, used to cap a group of parallel fetches. */
export const withTimeout = async <T,>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
