/**
 * Velho Outreach — contracts for role-personalized video emails.
 *
 * This layer sits on top of the existing 5-agent pipeline (types/pipeline.ts).
 * It adds company research with sourced facts, leadership discovery, and one
 * email per decision-maker (CEO / COO / CFO), each linking to a personal video
 * page. Only professional, public information is modelled here — there are
 * deliberately no fields for private-life data.
 */

import type {
  DiscoveryOutput,
  ProblemOutput,
  ResultSource,
  SolutionOutput,
  VideoScriptOutput,
} from "@/types/pipeline";

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

/**
 * Company-level roles that can get their own email. CEO, COO and CFO are the
 * core three (COO/CFO fold into the CEO email when not found); the others get
 * an email only when a named person is published for them.
 * SALES = sales / commercial, HR = people, SERVICE = customer service,
 * purchasing and supply chain.
 */
export type ExecRole = "CEO" | "COO" | "CFO" | "CTO" | "SALES" | "HR" | "SERVICE";

export const EXEC_ROLES: readonly ExecRole[] = [
  "CEO",
  "COO",
  "CFO",
  "CTO",
  "SALES",
  "HR",
  "SERVICE",
] as const;

/** Roles that are always considered; the rest only when a person is found. */
export const CORE_ROLES: readonly ExecRole[] = ["CEO", "COO", "CFO"] as const;

/** Short labels for buttons and tables. */
export const ROLE_LABELS: Record<ExecRole, string> = {
  CEO: "CEO",
  COO: "COO",
  CFO: "CFO",
  CTO: "CTO / IT",
  SALES: "Sales",
  HR: "HR",
  SERVICE: "Service & supply",
};

/** Zero count for every role (views, stats). */
export const emptyRoleCounts = (): Record<ExecRole, number> =>
  Object.fromEntries(EXEC_ROLES.map((role) => [role, 0])) as Record<ExecRole, number>;

export type Confidence = "high" | "medium" | "low";

export type OutreachLanguage = "en" | "fi";

/** What a fact is about; drives which role email leans on it. */
export type FactKind =
  | "strategy_goal"
  | "financial"
  | "hiring"
  | "why_now"
  | "leader_statement"
  | "company";

/** Fact kinds that count towards the sufficiency threshold. */
export const SUBSTANTIVE_FACT_KINDS: readonly FactKind[] = [
  "strategy_goal",
  "financial",
  "hiring",
  "why_now",
  "leader_statement",
] as const;

/**
 * A claim we are allowed to put in front of an executive. `quote` is kept
 * verbatim in the source language and is checked against the fetched source
 * text before the fact is accepted.
 */
export interface SourcedFact {
  id: string;
  kind: FactKind;
  /** The claim in the email's language (may be a translation). */
  text: string;
  /** Verbatim excerpt from the source, in its original language. */
  quote: string;
  /** BCP-47-ish language tag of the quote, e.g. "fi" or "en". */
  quoteLang: string;
  /** Human-readable source shown to the reader. */
  sourceUrl: string;
  /** Where the quote was actually verified, when it differs from sourceUrl. */
  verifiedAgainstUrl?: string;
  retrievedAt: string;
}

/* ------------------------------------------------------------------ */
/* Research                                                            */
/* ------------------------------------------------------------------ */

export type SocialPlatform = "instagram" | "facebook" | "linkedin" | "x" | "youtube" | "tiktok";

/** A link to an official account (company) or a work profile listed on the site (person). */
export interface SocialLink {
  platform: SocialPlatform;
  url: string;
  kind: "company" | "person";
  /** Visible text around the link (used to match a person's name). */
  context: string;
}

export interface FetchedPage {
  url: string;
  title: string;
  /**
   * Full visible text (not truncated like the legacy scraper), followed by
   * the page's structured data (meta description, JSON-LD) so sites that
   * render in the browser still have readable content.
   */
  text: string;
  /** Addresses found in mailto: links and visible text. */
  emails: string[];
  /** Same-host links found on the page, absolute URLs. */
  links: string[];
  /** Official social accounts and site-listed work profiles. */
  socialLinks: SocialLink[];
}

export interface ResearchLogEntry {
  source: string;
  ok: boolean;
  durationMs: number;
  note: string;
  url?: string;
}

/** One company from the Finnish trade register (PRH / YTJ). */
export interface EntityCandidate {
  name: string;
  businessId: string;
  registeredSince: string | null;
  website: string | null;
  previousNames: { name: string; until: string | null }[];
  /** Most recent name change, if any (ISO date). */
  renamedOn: string | null;
  businessLine: string | null;
}

export interface EntityMatch {
  candidate: EntityCandidate | null;
  confidence: Confidence;
  method: "website" | "name" | "override" | "none";
  alternatives: EntityCandidate[];
  note: string;
}

export interface LeaderEmail {
  address: string | null;
  method: "published" | "pattern" | "none";
  confidence: Confidence;
}

export interface LeaderProfile {
  role: ExecRole;
  /** null when not found — never guessed. */
  name: string | null;
  /** Exact title as published, e.g. "SVP Operations" or "Toimitusjohtaja". */
  title: string;
  inRoleSince?: string;
  publicStatements: SourcedFact[];
  email: LeaderEmail;
  confidence: Confidence;
  /** Fact that proves this person holds this title. */
  evidence: SourcedFact | null;
  /**
   * LinkedIn profile linked from the company's own website next to this
   * person's name. Never looked up elsewhere; personal social accounts are
   * out of scope (work information only).
   */
  linkedinUrl?: string | null;
}

export interface CompanyFinancials {
  revenueEur?: number;
  operatingProfitEur?: number;
  employees?: number;
  year: number;
  sourceUrl: string;
}

export interface CompanySignals {
  strategyGoals: SourcedFact[];
  financials?: CompanyFinancials;
  hiring: SourcedFact[];
  whyNow: SourcedFact[];
  /** Register-level context (age, business line); not counted as substance. */
  company: SourcedFact[];
}

export type Sufficiency = "ready" | "weak" | "insufficient";

/** Every number that is not taken from a source is an explicit estimate. */
export interface CostEstimate {
  estimate: true;
  hoursPerWeek: number;
  hoursPerMonth: number;
  hourlyCostEur: number;
  eurPerMonth: number;
  /** Human-readable formula, always shown next to the number. */
  formula: string;
  /** Yearly cost as a share of operating profit, when financials exist. */
  shareOfOperatingProfitPct: number | null;
}

/* ------------------------------------------------------------------ */
/* Emails                                                              */
/* ------------------------------------------------------------------ */

export type RoleEmailStatus =
  | "draft"
  | "dry_run_sent"
  | "sent"
  | "no_address"
  | "opted_out"
  | "skipped";

export interface RoleEmail {
  role: ExecRole;
  recipient: { name: string | null; title: string; email: string | null };
  /** One-line angle for this role. */
  theme: string;
  subject: string;
  /** e.g. "Hi Mikko," — built in code from the verified name. */
  greeting: string;
  body: string[];
  callToAction: string;
  /** Footer lines: sources note, unsubscribe, sender. Built in code. */
  footer: string[];
  videoUrl: string;
  unsubscribeUrl: string;
  token: string;
  usedFacts: SourcedFact[];
  language: OutreachLanguage;
  status: RoleEmailStatus;
  /** "live" = written by the model, "template" = deterministic fallback. */
  writtenBy: "live" | "template";
  /** Roles whose angle was folded into this email (missing leaders). */
  mergedRoles: ExecRole[];
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

export interface OutreachRequest {
  domain: string;
  /** Operator override from the "change company" picker. */
  businessId?: string;
  language?: OutreachLanguage;
}

export type OutreachStage =
  | "start"
  | "website"
  | "register"
  | "jobs"
  | "pipeline"
  | "extract"
  | "emails"
  | "done";

export interface OutreachProgressEvent {
  type: "progress";
  stage: OutreachStage;
  message: string;
  at: number;
}

export interface OutreachResultEvent {
  type: "result";
  result: OutreachResult;
}

export interface OutreachErrorEvent {
  type: "error";
  message: string;
}

export type OutreachStreamEvent =
  | OutreachProgressEvent
  | OutreachResultEvent
  | OutreachErrorEvent;

export interface OutreachPipelineData {
  discovery: DiscoveryOutput;
  problem: ProblemOutput;
  solution: SolutionOutput;
  videoScript: VideoScriptOutput;
  sources: {
    discovery: ResultSource;
    problem: ResultSource;
    solution: ResultSource;
    videoScript: ResultSource;
  };
}

export interface OutreachResult {
  domain: string;
  createdAt: string;
  language: OutreachLanguage;
  entity: EntityMatch;
  leaders: LeaderProfile[];
  signals: CompanySignals;
  /** All verified facts, deduplicated (the shared fact set). */
  facts: SourcedFact[];
  /** Candidate facts that failed quote verification, for transparency. */
  rejectedFacts: number;
  sufficiency: Sufficiency;
  estimate: CostEstimate;
  emails: RoleEmail[];
  /** The company's official social accounts, as linked from its own website. */
  companySocials?: SocialLink[];
  pipeline: OutreachPipelineData;
  researchLog: ResearchLogEntry[];
  llmCalls: number;
  /** True when any part degraded to fallback/template content. */
  usedFallback: boolean;
  totalDurationMs: number;
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

/** Register status relevant for prospecting. */
export type CompanyStatus = "active" | "liquidation" | "bankruptcy" | "ended";

/** One company from the trade register, as shown in search results. */
export interface CompanySummary {
  businessId: string;
  name: string;
  /** Earlier official names, newest first. */
  previousNames: string[];
  /** Date the current name was registered, when the company has older names. */
  renamedOn: string | null;
  city: string | null;
  businessLineCode: string | null;
  businessLine: string | null;
  /**
   * ISO date the business ID was registered. Companies registered before the
   * electronic register started all carry 1978-03-15 — see `registeredBefore1978`.
   */
  registeredSince: string | null;
  registeredBefore1978: boolean;
  /** Website as registered in PRH (often missing). */
  website: string | null;
  companyForm: string | null;
  status: CompanyStatus;
  /** Public register page (attribution: PRH / YTJ open data, CC BY 4.0). */
  sourceUrl: string;
}

export interface CompanySuggestion extends CompanySummary {
  /** 0–100, how well the name matches the query. */
  matchScore: number;
}

export interface CompanySearchResponse {
  query: string;
  suggestions: CompanySuggestion[];
  totalResults: number;
  /** Set when the register could not be reached. */
  note?: string;
}

export interface DomainCheck {
  domain: string;
  /** What happened when we checked this candidate. */
  outcome: "no_dns" | "unreachable" | "name_not_found" | "verified" | "registered";
}

/**
 * Website for a company. "registered" = from the trade register;
 * "verified_guess" = a guessed domain whose homepage contains the company's
 * legal name or business ID. Never an unverified guess.
 */
export interface DomainResolution {
  businessId: string;
  domain: string | null;
  method: "registered" | "verified_guess" | "none";
  /** Exact text found on the homepage that proves the match. */
  evidence: string | null;
  checks: DomainCheck[];
  durationMs: number;
}

/* ---------------------------- Criteria search ---------------------------- */

export interface CriteriaRequest {
  /** Industry group ids (see INDUSTRY_GROUPS) and/or raw TOL codes (3–5 digits). */
  industries: string[];
  /** Region id (see REGIONS) — expands to its main towns. */
  region?: string;
  /** Extra / alternative towns typed by the operator. */
  cities?: string[];
  /** Minimum company age in years (default 10). */
  minAgeYears?: number;
  /** M3: only keep companies with an open manual-work job ad. */
  requireHiring?: boolean;
  /** M3: only keep companies whose size is known from a sourced quote. */
  onlyKnownSize?: boolean;
}

export interface ScoreReason {
  points: number;
  reason: string;
}

export interface ScoredCompany {
  company: CompanySummary;
  /** 0–100, deterministic for the same input. */
  score: number;
  reasons: ScoreReason[];
  ageYears: number | null;
  /** Filled by enrichment (M3). */
  enrichment?: CompanyEnrichment;
}

export interface CompanyEnrichment {
  domain: DomainResolution | null;
  /** All verified open positions. */
  hiring: SourcedFact[];
  /** The subset that is mostly repetitive admin work (Velho's sweet spot). */
  manualHiring: SourcedFact[];
  /** Employee count stated on the site or in a job ad, with its quote. */
  size: { employees: number; fact: SourcedFact } | null;
  /** The website check ran out of time: unknown, not "no website". */
  websiteTimedOut?: boolean;
  status: "pending" | "done" | "timed_out";
}

export interface ExclusionCount {
  id: string;
  label: string;
  count: number;
}

export interface CriteriaSearchLogEntry {
  query: string;
  ok: boolean;
  results: number;
  durationMs: number;
  note?: string;
}

export interface CriteriaResult {
  request: CriteriaRequest;
  /** Ranked, after exclusions. */
  companies: ScoredCompany[];
  scanned: number;
  excluded: ExclusionCount[];
  /** True when a limit stopped the scan before all combinations. */
  truncated: boolean;
  /** Which limit: the candidate cap or the register-query budget. */
  truncatedBy?: "candidates" | "queries";
  queriesRun: number;
  queriesPlanned: number;
  log: CriteriaSearchLogEntry[];
  createdAt: string;
  durationMs: number;
  /** Set when the same search was served from the 30-minute cache. */
  cached?: boolean;
}

export type CriteriaStreamEvent =
  | { type: "progress"; message: string; done: number; total: number }
  | { type: "result"; result: CriteriaResult }
  | { type: "enriched"; businessId: string; scored: ScoredCompany }
  | { type: "enrichment_done"; done: number; timedOut: number; durationMs: number }
  | { type: "error"; message: string };

/* ---------------------------- History search ----------------------------- */

export interface HistoryRow {
  domain: string;
  companyName: string;
  businessId: string | null;
  createdAt: string;
  language: OutreachLanguage;
  sufficiency: Sufficiency;
  /** Role -> email status for the emails written in that run. */
  emails: { role: ExecRole; status: RoleEmailStatus; recipient: string | null }[];
  views: Record<ExecRole, number>;
  totalViews: number;
}

export interface HistoryQuery {
  q?: string;
  status?: RoleEmailStatus;
  minViews?: number;
  sort?: "date" | "views";
}
