import "server-only";

/**
 * Lightweight, dependency-free site scraper used by the Discovery Agent.
 *
 * We deliberately avoid Playwright/Firecrawl on the hot path: a live stage
 * demo cannot afford a headless browser boot. Instead we fetch the homepage
 * plus a few high-signal pages with plain HTTP, strip tags, and extract
 * brand colours / metadata. Everything is deadline-bounded and returns a
 * structured result — never throws to the caller.
 */

export interface ScrapedPage {
  url: string;
  title: string;
  description: string;
  /** Visible text, whitespace-collapsed and truncated. */
  text: string;
  /** Hex colours found in inline styles / style blocks, ranked by frequency. */
  colors: string[];
}

export interface ScrapeResult {
  domain: string;
  origin: string;
  pages: ScrapedPage[];
  /** Concatenated text across pages, for LLM context. */
  combinedText: string;
  ok: boolean;
  error?: string;
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 VelhoBot/1.0";

/** Paths that tend to reveal operational pain and business model. */
const HIGH_SIGNAL_PATHS = [
  "",
  "/about",
  "/services",
  "/solutions",
  "/careers",
  "/contact",
];

const MAX_TEXT_PER_PAGE = 4000;
const MAX_COMBINED_TEXT = 12000;

const decodeEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 10)),
    );

const stripTags = (html: string): string =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();

const extractMeta = (
  html: string,
  pattern: RegExp,
): string => {
  const match = pattern.exec(html);
  return match?.[1] ? decodeEntities(match[1]).trim() : "";
};

const HEX_PATTERN = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;

/** Colours that appear in most frameworks and carry no brand signal. */
const COLOR_BLOCKLIST = new Set([
  "#000000",
  "#ffffff",
  "#fff",
  "#000",
  "#333333",
  "#666666",
  "#999999",
  "#cccccc",
  "#eeeeee",
  "#111111",
  "#222222",
  "#f5f5f5",
  "#e5e7eb",
]);

export const extractColors = (html: string): string[] => {
  const counts = new Map<string, number>();
  // Only trust colours from styling surfaces. Scripts and inline SVG artwork
  // are full of one-off hex values that would otherwise hijack the palette.
  const stylingHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const matches = stylingHtml.match(HEX_PATTERN) ?? [];

  for (const raw of matches) {
    const hex = raw.toLowerCase();
    const normalized =
      hex.length === 4
        ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
        : hex;
    if (COLOR_BLOCKLIST.has(normalized)) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([hex]) => hex);
};

export const normalizeOrigin = (raw: string): string | null => {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes(".")) return null;
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return null;
  }
};

const fetchPage = async (
  url: string,
  timeoutMs: number,
): Promise<ScrapedPage | null> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
      cache: "no-store",
    });

    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return null;

    const html = await response.text();

    const title =
      extractMeta(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
      extractMeta(
        html,
        /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      );

    const description =
      extractMeta(
        html,
        /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
      ) ||
      extractMeta(
        html,
        /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
      );

    const text = stripTags(html).slice(0, MAX_TEXT_PER_PAGE);

    return {
      url,
      title: title.slice(0, 200),
      description: description.slice(0, 400),
      text,
      colors: extractColors(html),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Scrape a domain's most informative pages within the given deadline.
 * Resolves with `ok: false` on total failure — callers fall back to mock.
 */
export const scrapeDomain = async (
  domain: string,
  timeoutMs = 5000,
): Promise<ScrapeResult> => {
  const origin = normalizeOrigin(domain);
  if (!origin) {
    return {
      domain,
      origin: "",
      pages: [],
      combinedText: "",
      ok: false,
      error: `Could not resolve "${domain}" to a valid host`,
    };
  }

  const startedAt = Date.now();
  const remaining = () => timeoutMs - (Date.now() - startedAt);

  const perPageTimeout = 2500;
  const results: ScrapedPage[] = [];

  // Homepage first — it defines the brand and is the best fallback.
  const home = await fetchPage(origin, Math.min(perPageTimeout, Math.max(remaining(), 500)));
  if (home) results.push(home);

  // Then a couple of high-signal pages, if budget allows.
  const secondary = HIGH_SIGNAL_PATHS.slice(1, 4);
  for (const path of secondary) {
    if (remaining() < 900) break;
    const page = await fetchPage(
      `${origin}${path}`,
      Math.min(perPageTimeout, Math.max(remaining(), 400)),
    );
    if (page && page.text.length > 200) results.push(page);
  }

  if (results.length === 0) {
    return {
      domain,
      origin,
      pages: [],
      combinedText: "",
      ok: false,
      error: "No pages could be fetched (blocked, offline, or non-HTML)",
    };
  }

  const combinedText = results
    .map(
      (page) =>
        `### ${page.url}\nTITLE: ${page.title}\nDESC: ${page.description}\n${page.text}`,
    )
    .join("\n\n")
    .slice(0, MAX_COMBINED_TEXT);

  return {
    domain,
    origin,
    pages: results,
    combinedText,
    ok: true,
  };
};

/** Flatten scraped colours into a usable brand palette. */
export const paletteFromColors = (
  colors: string[],
  fallback: { primary: string; secondary: string; accent: string },
): { primary: string; secondary: string; accent: string } => {
  const primary = colors[0] ?? fallback.primary;
  const secondary = colors[1] ?? darken(primary) ?? fallback.secondary;
  const accent = colors[2] ?? lighten(primary) ?? fallback.accent;
  return { primary, secondary, accent };
};

const clampChannel = (value: number): number =>
  Math.max(0, Math.min(255, Math.round(value)));

const toRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return null;
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  if ([r, g, b].some((c) => Number.isNaN(c))) return null;
  return { r, g, b };
};

const toHex = (r: number, g: number, b: number): string =>
  `#${[r, g, b]
    .map((c) => clampChannel(c).toString(16).padStart(2, "0"))
    .join("")}`;

export const darken = (hex: string, amount = 0.3): string | null => {
  const rgb = toRgb(hex);
  if (!rgb) return null;
  return toHex(rgb.r * (1 - amount), rgb.g * (1 - amount), rgb.b * (1 - amount));
};

export const lighten = (hex: string, amount = 0.35): string | null => {
  const rgb = toRgb(hex);
  if (!rgb) return null;
  return toHex(
    rgb.r + (255 - rgb.r) * amount,
    rgb.g + (255 - rgb.g) * amount,
    rgb.b + (255 - rgb.b) * amount,
  );
};
