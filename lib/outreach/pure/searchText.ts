/**
 * Text folding, name matching and domain candidates for company search.
 * Pure module (no imports) so it runs under `node --test`.
 */

/** Lower case, accents removed ("Würth" -> "wurth", "Hämeen" -> "hameen"). */
export const foldText = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const LEGAL_SUFFIXES = new Set([
  "oy", "oyj", "ab", "abp", "ltd", "limited", "plc", "inc", "gmbh", "ky", "ay", "osk", "ry", "sr",
]);

/** Company name without legal form words: "Berner Oy" -> "berner". */
export const coreName = (name: string): string =>
  foldText(name)
    .split(" ")
    .filter((word) => word && !LEGAL_SUFFIXES.has(word))
    .join(" ");

/**
 * 0–100 match score of a query against a company's current and previous names.
 * Exact core-name match 100, prefix 80, all query words present 60, partial 30.
 * Previous names score 10 lower than the current name.
 */
export const nameMatchScore = (
  query: string,
  name: string,
  previousNames: string[] = [],
): number => {
  const q = coreName(query) || foldText(query);
  if (!q) return 0;
  const score = (candidate: string): number => {
    const c = coreName(candidate);
    if (!c) return 0;
    if (c === q) return 100;
    if (c.startsWith(`${q} `) || c.startsWith(q)) return 80;
    const words = q.split(" ");
    if (words.every((word) => c.split(" ").includes(word))) return 60;
    if (c.includes(q)) return 30;
    return 0;
  };
  const current = score(name);
  const previous = Math.max(0, ...previousNames.map((n) => score(n) - 10));
  return Math.max(current, previous);
};

/** Does `text` contain `needle` once both are folded? */
export const containsFolded = (text: string, needle: string): boolean => {
  const n = foldText(needle);
  return n.length >= 3 && ` ${foldText(text)} `.includes(` ${n} `);
};

/* ------------------------------------------------------------------ */
/* Domain candidates                                                    */
/* ------------------------------------------------------------------ */

// Guesses are only candidates: the caller must verify each one (DNS +
// homepage containing the legal name or business ID) before using it.

/** "https://www.Example.fi/en/" -> "example.fi". */
export const hostFromWebsite = (website: string): string | null => {
  const trimmed = website.trim().toLowerCase();
  if (!trimmed) return null;
  try {
    const url = new URL(/^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, "");
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ? host : null;
  } catch {
    return null;
  }
};

const TLDS = ["fi", "com"];
const MAX_GUESSES = 8;

/** Words that are rarely part of a company's domain. */
const DROPPABLE = new Set(["group", "finland", "suomi", "konserni", "and", "ja", "&"]);

/**
 * Ordered guesses: full core name joined ("lassilatikanoja.fi"), hyphenated
 * ("lassila-tikanoja.fi"), then without generic words, then single words
 * (longest, last, first).
 */
export const domainGuesses = (name: string, previousNames: string[] = []): string[] => {
  const labels: string[] = [];
  const addLabel = (label: string) => {
    const clean = label.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "");
    if (clean.length >= 2 && clean.length <= 63 && !labels.includes(clean)) labels.push(clean);
  };

  for (const source of [name, ...previousNames.slice(0, 1)]) {
    // Symbols such as "&" never appear in domain labels.
    const words = coreName(source)
      .split(" ")
      .map((word) => word.replace(/[^a-z0-9]/g, ""))
      .filter(Boolean);
    if (words.length === 0) continue;
    const meaningful = words.filter((word) => !DROPPABLE.has(word));
    addLabel(words.join(""));
    if (words.length > 1) addLabel(words.join("-"));
    if (meaningful.length && meaningful.length !== words.length) {
      addLabel(meaningful.join(""));
      addLabel(meaningful.join("-"));
    }
    // Single words: brands often drop a founder's first name ("Oy Karl Fazer
    // Ab" -> fazer.com), so the longest and last words come before the first.
    if (meaningful.length > 1) {
      addLabel([...meaningful].sort((a, b) => b.length - a.length)[0] ?? "");
      addLabel(meaningful[meaningful.length - 1] ?? "");
    }
    if (words[0]) addLabel(words[0]);
  }

  const guesses: string[] = [];
  for (const label of labels) {
    for (const tld of TLDS) {
      guesses.push(`${label}.${tld}`);
      if (guesses.length >= MAX_GUESSES) return guesses;
    }
  }
  return guesses;
};

/* ------------------------------------------------------------------ */
/* Query fallbacks                                                      */
/* ------------------------------------------------------------------ */

/**
 * Alternative queries to try when the register finds nothing, at most `max`:
 * Finnish/German letters typed without accents ("wurth" -> "würth"), then the
 * longest word alone ("lassila tikanoja" -> "tikanoja") — results are filtered
 * by `nameMatchScore` afterwards, so a broader query is safe.
 */
export const queryFallbacks = (query: string, max = 3): string[] => {
  const q = query.trim().toLowerCase();
  const out: string[] = [];
  const add = (value: string) => {
    if (value && value !== q && !out.includes(value)) out.push(value);
  };
  // Multi-word names often need a symbol the user left out ("&"): the longest
  // word alone is the most useful retry, so it goes first.
  const words = q.split(/\s+/).filter((word) => word.length >= 4 && word !== "&");
  if (words.length > 1) {
    add([...words].sort((a, b) => b.length - a.length)[0] ?? "");
  }
  if (/^[a-z0-9 &.-]+$/.test(q)) {
    add(q.replace(/u/g, "ü"));
    add(q.replace(/a/g, "ä"));
    add(q.replace(/o/g, "ö"));
  }
  return out.slice(0, max);
};

/* ------------------------------------------------------------------ */
/* History search                                                       */
/* ------------------------------------------------------------------ */

interface HistoryLike {
  domain: string;
  companyName: string;
  businessId: string | null;
  createdAt: string;
  totalViews: number;
  emails: { status: string; recipient: string | null }[];
}

/**
 * Filter and sort stored outreach runs. Matching is case- and
 * accent-insensitive and partial ("wurth" finds "Würth Oy", "bern" finds
 * "berner.fi").
 */
export const filterHistory = <T extends HistoryLike>(
  rows: T[],
  { q, status, minViews, sort }: { q?: string; status?: string; minViews?: number; sort?: "date" | "views" },
): T[] => {
  const needle = foldText(q ?? "");
  return rows
    .filter((row) => {
      if (needle) {
        const haystack = foldText(
          [row.companyName, row.domain, row.businessId ?? "", ...row.emails.map((e) => e.recipient ?? "")].join(" "),
        );
        if (!haystack.includes(needle)) return false;
      }
      if (status && !row.emails.some((email) => email.status === status)) return false;
      if (minViews !== undefined && row.totalViews < minViews) return false;
      return true;
    })
    .sort((a, b) =>
      sort === "views"
        ? b.totalViews - a.totalViews || b.createdAt.localeCompare(a.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
    );
};
