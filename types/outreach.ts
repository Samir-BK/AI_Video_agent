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

export type ExecRole = "CEO" | "COO" | "CFO";

export const EXEC_ROLES: readonly ExecRole[] = ["CEO", "COO", "CFO"] as const;

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

export interface FetchedPage {
  url: string;
  title: string;
  /** Full visible text (not truncated like the legacy scraper). */
  text: string;
  /** Addresses found in mailto: links and visible text. */
  emails: string[];
  /** Same-host links found on the page, absolute URLs. */
  links: string[];
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
  pipeline: OutreachPipelineData;
  researchLog: ResearchLogEntry[];
  llmCalls: number;
  /** True when any part degraded to fallback/template content. */
  usedFallback: boolean;
  totalDurationMs: number;
}
