import "server-only";

import { callLlm, extractJson, isLlmConfigured } from "@/lib/llm";
import { mapTitleToRole, ROLE_KEYWORDS } from "@/lib/outreach/pure/roles";
import { coreName, foldText } from "@/lib/outreach/pure/searchText";
import {
  dedupeFacts,
  normalizeForMatch,
  quoteAppearsIn,
  verifyFacts,
} from "@/lib/outreach/pure/verify";
import { nextFactId, nowIso } from "@/lib/outreach/research/source";
import type {
  CompanyFinancials,
  ExecRole,
  FactKind,
  FetchedPage,
  LeaderProfile,
  SourcedFact,
} from "@/types/outreach";
import { EXEC_ROLES } from "@/types/outreach";

/**
 * Turn fetched pages into verified facts and leadership profiles.
 *
 * One LLM call reads the most relevant pages and proposes leaders and facts,
 * each with a verbatim quote. Every quote is then checked against the page
 * text; anything that cannot be found is dropped. Without a key, a small
 * keyword heuristic still finds named leaders on management pages.
 */

const CONTEXT_BUDGET = 9000;
const PER_PAGE_BUDGET = 2600;

const PAGE_PRIORITY: [RegExp, number][] = [
  [/(management|leadership|johto|johtoryhm)/i, 0],
  [/(investor|sijoittaj|strateg)/i, 1],
  [/(news|uutis|press|tiedot|media)/i, 2],
  [/(about|yritys|yhtio|company|meista)/i, 3],
  [/(career|rekry|ura|tyopaik)/i, 4],
];

const priorityOf = (url: string): number => {
  for (const [pattern, rank] of PAGE_PRIORITY) {
    if (pattern.test(url)) return rank;
  }
  return 5;
};

/** Keep the paragraphs around leadership and goal keywords. */
const focusText = (text: string, budget: number): string => {
  if (text.length <= budget) return text;
  const keywords =
    /(toimitusjohtaja|talousjohtaja|johtaja|ceo|cfo|coo|director|chief|tavoite|strategi|target|goal|growth|kasvu|liikevaihto|revenue|investoi|expan|laajen|rekry|hiring)/i;
  const lines = text.split("\n");
  const picked: string[] = [];
  let size = 0;
  for (const line of lines) {
    if (!keywords.test(line)) continue;
    picked.push(line);
    size += line.length + 1;
    if (size >= budget) break;
  }
  const focused = picked.join("\n");
  return focused.length > 400 ? focused.slice(0, budget) : text.slice(0, budget);
};

export const buildExtractionContext = (pages: FetchedPage[]): string => {
  const ordered = [...pages].sort((a, b) => priorityOf(a.url) - priorityOf(b.url));
  const parts: string[] = [];
  let used = 0;
  for (const page of ordered) {
    const remaining = CONTEXT_BUDGET - used;
    if (remaining < 400) break;
    const chunk = `### SOURCE ${page.url}\n${focusText(page.text, Math.min(PER_PAGE_BUDGET, remaining))}`;
    parts.push(chunk);
    used += chunk.length;
  }
  return parts.join("\n\n");
};

const EXTRACT_SYSTEM = `You extract verifiable business facts about one company from web page text.
Only use the provided SOURCE text. Never use outside knowledge. Never guess.
Professional information only: names, job titles, company goals, results, investments, hiring.
Never include private life (family, hobbies, health, politics, religion).
Every item needs "quote": an EXACT, verbatim substring (12-200 characters) copied from the SOURCE text in its original language, and "sourceUrl": the SOURCE url it came from.
Respond with ONLY a JSON object:
{
  "leaders": [ { "name": string, "title": string (exact published title), "quote": string (must contain the name and title), "sourceUrl": string, "inRoleSince": string | null } ],
  "facts": [ { "kind": "strategy_goal" | "financial" | "hiring" | "why_now" | "leader_statement", "text": string (one sentence in English), "quote": string, "quoteLang": "fi" | "en" | "sv", "sourceUrl": string } ],
  "financials": { "year": number, "revenueEur": number | null, "operatingProfitEur": number | null, "employees": number | null, "quote": string (the sentence or table row stating these figures), "sourceUrl": string } | null
}
Leaders: company-level executives only: the CEO (toimitusjohtaja), the CFO (talousjohtaja / finance director), whoever runs operations, production or logistics, and the heads of IT (CTO / CIO / IT-johtaja), sales (myyntijohtaja / kaupallinen johtaja), HR (henkilöstöjohtaja) and customer service, purchasing or supply chain. At most 10.
Facts: at most 8. Use "why_now" for recent changes: a new CEO or executive, cost cuts or change negotiations, expansion, acquisitions, new plants, record orders.
Financials: only the latest year stated in the SOURCE; amounts in plain euros (52.7 MEUR = 52700000). Use null if not stated.
Return empty arrays / null if nothing qualifies.`;

interface RawLeader {
  name?: unknown;
  title?: unknown;
  quote?: unknown;
  sourceUrl?: unknown;
  inRoleSince?: unknown;
}

interface RawFact {
  kind?: unknown;
  text?: unknown;
  quote?: unknown;
  quoteLang?: unknown;
  sourceUrl?: unknown;
}

interface RawFinancials {
  year?: unknown;
  revenueEur?: unknown;
  operatingProfitEur?: unknown;
  employees?: unknown;
  quote?: unknown;
  sourceUrl?: unknown;
}

interface RawExtraction {
  leaders?: RawLeader[];
  facts?: RawFact[];
  financials?: RawFinancials | null;
}

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const FACT_KINDS: FactKind[] = [
  "strategy_goal",
  "financial",
  "hiring",
  "why_now",
  "leader_statement",
];

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export interface ExtractionResult {
  leaders: LeaderProfile[];
  facts: SourcedFact[];
  /** Only set when its quote verified against a fetched page. */
  financials?: CompanyFinancials;
  rejected: number;
  usedLlm: boolean;
  note: string;
}

const emptyLeader = (role: ExecRole): LeaderProfile => ({
  role,
  name: null,
  title: "",
  publicStatements: [],
  email: { address: null, method: "none", confidence: "low" },
  confidence: "low",
  evidence: null,
});

/** Keep one leader per role, preferring the best-evidenced one. */
const pickLeaders = (found: LeaderProfile[]): LeaderProfile[] => {
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return EXEC_ROLES.map((role) => {
    const options = found
      .filter((leader) => leader.role === role)
      .sort((a, b) => rank[a.confidence] - rank[b.confidence]);
    return options[0] ?? emptyLeader(role);
  });
};

/** "Johanna Hamro-Drotz", "Mikko Keskinen", "Anna-Maija Virtanen". */
const NAME_WORD = "[A-ZÅÄÖ][a-zåäöé']+(?:-[A-ZÅÄÖ][a-zåäöé']+)?";
const NAME_PATTERN = new RegExp(`(${NAME_WORD}(?: ${NAME_WORD}){1,2})`, "g");

/** Capitalised words that appear in titles and headings, never in names. */
const NOT_NAME_WORDS = new Set([
  "chief", "officer", "director", "manager", "coordinator", "head", "vice", "president",
  "senior", "executive", "operations", "operating", "financial", "finance", "sales",
  "marketing", "export", "supply", "chain", "production", "business", "group", "board",
  "team", "management", "leadership", "contact", "contacts", "yhteystiedot", "johtoryhmä",
  "hallitus", "toimitusjohtaja", "talousjohtaja", "johtaja", "oy", "oyj", "ab", "ltd",
  "finland", "suomi", "customer", "service", "read", "more", "lue", "lisää",
  "pohjoismaat", "nordic", "nordics", "europe", "eurooppa", "skandinavia", "baltia", "koneenrakennus",
]);

const hostOfUrl = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

const looksLikePersonName = (name: string): boolean =>
  name
    .split(/[\s-]+/)
    .every((word) => !NOT_NAME_WORDS.has(word.toLowerCase()));

/**
 * Find a role keyword in text. Acronyms (CEO, CFO, COO) must match as whole
 * upper-case words so "COO" never matches inside "Coordinator".
 */
const keywordIndexes = (text: string, keyword: string): number[] => {
  const isAcronym = /^[A-Z]{2,4}$/.test(keyword);
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    isAcronym ? `\\b${escaped}\\b` : `(?<![\\p{L}])${escaped}(?![\\p{L}])`,
    isAcronym ? "gu" : "giu",
  );
  return [...text.matchAll(pattern)].map((match) => match.index ?? 0).slice(0, 5);
};

/**
 * Key-free fallback: find "Toimitusjohtaja Matti Meikäläinen" or
 * "Matti Meikäläinen, CEO" on leadership-like pages.
 */
export const heuristicLeaders = (
  pages: FetchedPage[],
  /** Company website host; pages elsewhere must name the company near the title. */
  ownHost = "",
  companyName = "",
): LeaderProfile[] => {
  const found: LeaderProfile[] = [];
  const retrievedAt = nowIso();
  const candidates = pages.filter((page) => priorityOf(page.url) <= 3);
  const host = ownHost.replace(/^www\./, "").toLowerCase();
  const core = coreName(companyName);

  for (const page of candidates) {
    // A news or directory page lists people from many companies: there, the
    // company name must appear within 200 characters of the title.
    const pageHost = hostOfUrl(page.url);
    const offSite = host !== "" && pageHost !== host && !pageHost.endsWith(`.${host}`);
    for (const role of EXEC_ROLES) {
      for (const keyword of ROLE_KEYWORDS[role]) {
        for (const index of keywordIndexes(page.text, keyword)) {
          if (offSite) {
            const near = page.text.slice(Math.max(0, index - 200), index + keyword.length + 200);
            if (core.length < 3 || !foldText(near).includes(core)) continue;
          }
          const start = Math.max(0, index - 60);
          const end = Math.min(page.text.length, index + keyword.length + 60);
          const windowText = page.text.slice(start, end);
          // Pick the capitalised name closest to the title keyword.
          const keywordOffset = index - start;
          const closest = [...windowText.matchAll(NAME_PATTERN)]
            .map((m) => ({ name: m[1] ?? "", offset: m.index ?? 0 }))
            .filter(({ name }) => name && looksLikePersonName(name))
            .sort(
              (a, b) =>
                Math.abs(a.offset - keywordOffset) - Math.abs(b.offset - keywordOffset),
            )[0];
          const name = closest?.name;
          if (name && closest) {
            const title = page.text.slice(index, index + keyword.length);
            const nameIndex = start + closest.offset;
            if (mapTitleToRole(title) === role) {
              const quoteStart = Math.min(index, nameIndex);
              const quoteEnd = Math.max(index + keyword.length, nameIndex + name.length);
              const quote = page.text.slice(quoteStart, quoteEnd).trim();
              if (quote.length >= 12 && quote.length <= 160 && quoteAppearsIn(quote, page.text)) {
                const evidence: SourcedFact = {
                  id: nextFactId("lead"),
                  kind: "company",
                  text: `${name} — ${title}`,
                  quote,
                  quoteLang: "fi",
                  sourceUrl: page.url,
                  retrievedAt,
                };
                found.push({
                  ...emptyLeader(role),
                  name,
                  title,
                  confidence: "low",
                  evidence,
                });
              }
            }
          }
        }
      }
    }
  }
  return found;
};

export const extractFactsAndLeaders = async (
  companyName: string,
  pages: FetchedPage[],
  ownHost = "",
): Promise<ExtractionResult> => {
  const sourceTexts = new Map(pages.map((page) => [page.url, page.text]));
  const fallbackLeaders = pickLeaders(heuristicLeaders(pages, ownHost, companyName));

  if (!isLlmConfigured() || pages.length === 0) {
    return {
      leaders: fallbackLeaders,
      facts: [],
      rejected: 0,
      usedLlm: false,
      note: pages.length === 0
        ? "No pages to read"
        : "No LLM key: leaders found by keyword heuristic only",
    };
  }

  const context = buildExtractionContext(pages);
  let raw: RawExtraction | null = null;
  try {
    const response = await callLlm({
      messages: [
        { role: "system", content: EXTRACT_SYSTEM },
        { role: "user", content: `Company: ${companyName}\n\n${context}` },
      ],
      json: true,
      temperature: 0.1,
    });
    raw = extractJson<RawExtraction>(response);
  } catch (error) {
    return {
      leaders: fallbackLeaders,
      facts: [],
      rejected: 0,
      usedLlm: false,
      note: `Extraction fell back to heuristic: ${
        error instanceof Error ? error.message.slice(0, 120) : "LLM error"
      }`,
    };
  }

  const retrievedAt = nowIso();
  const leaderCandidates: { leader: LeaderProfile; fact: SourcedFact }[] = [];
  for (const item of raw?.leaders ?? []) {
    const name = str(item.name);
    const title = str(item.title);
    const role = mapTitleToRole(title);
    if (!name || !title || !role) continue;
    const fact: SourcedFact = {
      id: nextFactId("lead"),
      kind: "company",
      text: `${name} — ${title}`,
      quote: str(item.quote),
      quoteLang: "fi",
      sourceUrl: str(item.sourceUrl),
      retrievedAt,
    };
    leaderCandidates.push({
      fact,
      leader: {
        ...emptyLeader(role),
        name,
        title,
        inRoleSince: str(item.inRoleSince) || undefined,
        confidence: "high",
        evidence: fact,
      },
    });
  }

  // A leader is accepted only if the quote verifies AND names the person.
  const verifiedLeaders: LeaderProfile[] = [];
  let rejected = 0;
  for (const { leader, fact } of leaderCandidates) {
    const { verified } = verifyFacts([fact], sourceTexts);
    const proof = verified[0];
    const namesPerson =
      proof !== undefined &&
      leader.name !== null &&
      normalizeForMatch(proof.quote).includes(normalizeForMatch(leader.name));
    if (proof && namesPerson) {
      verifiedLeaders.push({ ...leader, evidence: proof });
    } else {
      rejected += 1;
    }
  }

  const factCandidates: SourcedFact[] = (raw?.facts ?? [])
    .map((item): SourcedFact | null => {
      const kind = str(item.kind) as FactKind;
      if (!FACT_KINDS.includes(kind)) return null;
      const text = str(item.text);
      const quote = str(item.quote);
      if (!text || !quote) return null;
      return {
        id: nextFactId("fact"),
        kind,
        text,
        quote,
        quoteLang: str(item.quoteLang) || "fi",
        sourceUrl: str(item.sourceUrl),
        retrievedAt,
      };
    })
    .filter((fact): fact is SourcedFact => fact !== null);

  // Structured financials: accepted only if their quote verifies.
  let financials: CompanyFinancials | undefined;
  const rawFinancials = raw?.financials;
  const year = num(rawFinancials?.year);
  if (rawFinancials && year && str(rawFinancials.quote)) {
    const revenue = num(rawFinancials.revenueEur);
    const profit = num(rawFinancials.operatingProfitEur);
    const employees = num(rawFinancials.employees);
    const parts = [
      revenue !== undefined ? `Revenue ${(revenue / 1e6).toFixed(1)} MEUR` : null,
      profit !== undefined ? `operating profit ${(profit / 1e6).toFixed(1)} MEUR` : null,
      employees !== undefined ? `${employees} employees` : null,
    ].filter((part): part is string => part !== null);
    const proof: SourcedFact = {
      id: nextFactId("fin"),
      kind: "financial",
      text: `${parts.join(", ")} (${year}).`,
      quote: str(rawFinancials.quote),
      quoteLang: "fi",
      sourceUrl: str(rawFinancials.sourceUrl),
      retrievedAt,
    };
    const check = verifyFacts([proof], sourceTexts);
    const verifiedProof = check.verified[0];
    if (verifiedProof && parts.length > 0) {
      financials = {
        year,
        revenueEur: revenue,
        operatingProfitEur: profit,
        employees,
        sourceUrl: verifiedProof.sourceUrl,
      };
      factCandidates.push(verifiedProof);
    } else {
      rejected += 1;
    }
  }

  const { verified, rejected: rejectedFacts } = verifyFacts(factCandidates, sourceTexts);
  rejected += rejectedFacts.length;

  const leaders = pickLeaders([...verifiedLeaders, ...heuristicLeaders(pages, ownHost, companyName)]);
  // Leader statements become public statements of the matching leader.
  for (const fact of verified) {
    if (fact.kind !== "leader_statement") continue;
    const owner = leaders.find(
      (leader) => leader.name && (fact.quote.includes(leader.name) || fact.text.includes(leader.name)),
    );
    owner?.publicStatements.push(fact);
  }

  return {
    leaders,
    facts: dedupeFacts(verified),
    financials,
    rejected,
    usedLlm: true,
    note: `Verified ${verified.length} fact(s) and ${verifiedLeaders.length} leader(s); rejected ${rejected} unverifiable item(s)`,
  };
};
