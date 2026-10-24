/**
 * Velho Outreach Engine — strict contracts for the 5-agent pipeline.
 *
 * Flow: Discovery -> Problem -> Solution -> VideoScript -> Email
 *
 * Every agent output carries a `meta` block so the UI can honestly report
 * whether a step ran live or fell back to mock data (critical on stage).
 */

/* ------------------------------------------------------------------ */
/* Shared primitives                                                   */
/* ------------------------------------------------------------------ */

export type AgentId =
  | "discovery"
  | "problem"
  | "solution"
  | "videoScript"
  | "email";

/** Pipeline order — the single source of truth for step indexing. */
export const AGENT_ORDER: readonly AgentId[] = [
  "discovery",
  "problem",
  "solution",
  "videoScript",
  "email",
] as const;

export const AGENT_LABELS: Record<AgentId, string> = {
  discovery: "Discovery",
  problem: "Problem",
  solution: "Solution",
  videoScript: "Video Script",
  email: "Email Draft",
};

export const AGENT_DESCRIPTIONS: Record<AgentId, string> = {
  discovery: "Scrapes the domain and extracts brand + business model",
  problem: "Finds the operational bottleneck costing them hours",
  solution: "Maps Velho's AI capabilities onto that bottleneck",
  videoScript: "Writes the 20-second 3-scene voiceover + overlays",
  email: "Drafts the 4-sentence CEO cold email",
};

/** How a given agent result was produced. */
export type ResultSource = "live" | "mock" | "partial";

/** Provenance attached to every agent result. */
export interface AgentMeta {
  source: ResultSource;
  /** Wall-clock duration of the step in milliseconds. */
  durationMs: number;
  /** True when the step hit the 6s deadline and degraded gracefully. */
  timedOut: boolean;
  /** Human-readable note shown in the pipeline log. */
  note: string;
  /** Non-fatal errors collected while running the step. */
  warnings: string[];
}

export interface AgentEnvelope<T> {
  data: T;
  meta: AgentMeta;
}

export const createAgentMeta = (
  source: ResultSource,
  overrides: Partial<AgentMeta> = {},
): AgentMeta => ({
  source,
  durationMs: 0,
  timedOut: false,
  note: "",
  warnings: [],
  ...overrides,
});

/* ------------------------------------------------------------------ */
/* Step 1 — Discovery Agent                                            */
/* ------------------------------------------------------------------ */

export interface BrandPalette {
  /** Primary hex, e.g. "#0EA5E9". */
  primary: string;
  /** Secondary hex used for gradients. */
  secondary: string;
  /** Accent hex for highlights / CTA. */
  accent: string;
}

export interface DiscoveryOutput {
  /** Normalized domain, e.g. "fazer.com". */
  domain: string;
  companyName: string;
  /** One-line positioning statement. */
  tagline: string;
  /** 2-3 sentence summary of how the company makes money. */
  businessModel: string;
  industry: string;
  /** Inferred employee-count band, e.g. "50-200". */
  companySize: string;
  /** Locations / markets served. */
  markets: string[];
  /** Signals that hint at automation pain (careers posts, tech stack, etc.). */
  operationalSignals: string[];
  /** Product or service lines pulled from the site. */
  offerings: string[];
  brand: {
    palette: BrandPalette;
    /** Emoji or single glyph used when no logo asset is available. */
    glyph: string;
    tone: string;
  };
}

/* ------------------------------------------------------------------ */
/* Step 2 — Problem Agent                                              */
/* ------------------------------------------------------------------ */

export type ProblemSeverity = "low" | "medium" | "high" | "critical";

export interface ProblemOutput {
  /** Punchy name for the bottleneck, e.g. "Manual Quote Intake". */
  title: string;
  /** One sentence framing the bottleneck. */
  summary: string;
  severity: ProblemSeverity;
  /** Where the bottleneck physically lives. */
  department: string;
  /** Observable symptoms / evidence. */
  symptoms: string[];
  /** The quantified cost of inaction. */
  impact: {
    /** Estimated hours lost per week across the team. */
    hoursLostPerWeek: number;
    /** Short label for the money impact, e.g. "$18k/mo in delayed quotes". */
    estimatedCost: string;
    /** Downstream business risk. */
    risk: string;
  };
  /** Systems that don't talk to each other. */
  brokenSystems: string[];
}

/* ------------------------------------------------------------------ */
/* Step 3 — Solution Agent                                             */
/* ------------------------------------------------------------------ */

export interface SolutionStep {
  /** 1-based ordering. */
  order: number;
  title: string;
  description: string;
  /** Velho capability being applied, e.g. "Document Intelligence". */
  velhoCapability: string;
  /** Concrete outcome, ideally quantified. */
  outcome: string;
}

export interface SolutionOutput {
  /** Name of the proposed system, e.g. "Velho Quote Engine". */
  architectureName: string;
  /** Elevator pitch for the whole architecture. */
  summary: string;
  /** Exactly the 3-step solution architecture. */
  steps: SolutionStep[];
  /** Headline metric the CEO will care about. */
  headlineMetric: {
    label: string;
    value: string;
    /** e.g. "12x faster" */
    delta: string;
  };
  integrations: string[];
  /** Realistic time-to-value framing, e.g. "3 weeks to production". */
  timeToValue: string;
}

/* ------------------------------------------------------------------ */
/* Step 4 — Video Script Agent                                         */
/* ------------------------------------------------------------------ */

export type SceneTransition = "fade" | "slide" | "zoom" | "wipe";

export interface TextOverlay {
  text: string;
  /** Vertical placement of the overlay in the scene. */
  position: "top" | "center" | "bottom";
  /** Emphasis drives font size / color in the renderer. */
  emphasis: "primary" | "secondary" | "accent";
}

export interface VideoScene {
  /** 1-based scene index. */
  id: number;
  /** Inclusive start second within the 20s timeline. */
  startSec: number;
  /** Exclusive end second within the 20s timeline. */
  endSec: number;
  title: string;
  /** Voiceover script spoken by speechSynthesis during this scene. */
  voiceover: string;
  /** On-screen text layers. */
  overlays: TextOverlay[];
  /** Direction for the graphic/animation layer. */
  graphicCue: string;
  /** Lucide icon name the renderer should draw, e.g. "Search". */
  icon: string;
  transition: SceneTransition;
}

export interface VideoScriptOutput {
  /** Total runtime in seconds. */
  durationSec: number;
  /** Title used on the video landing page. */
  headline: string;
  scenes: VideoScene[];
  /** Voiceover delivery direction. */
  voiceStyle: string;
}

/* ------------------------------------------------------------------ */
/* Step 5 — Email Agent                                                */
/* ------------------------------------------------------------------ */

export interface EmailOutput {
  /** Recipient persona, e.g. "CEO". */
  recipientRole: string;
  subject: string;
  /** Greeting line, e.g. "Hi Sarah,". */
  greeting: string;
  /** Exactly 4 sentences of no-fluff body copy. */
  bodySentences: string[];
  /** CTA line containing the video link. */
  callToAction: string;
  /** Sign-off block. */
  signoff: string;
  /** Personalized video landing page URL. */
  videoUrl: string;
  /** Plain-text version for clipboard / mail clients. */
  plainText: string;
}

/* ------------------------------------------------------------------ */
/* Pipeline orchestration                                              */
/* ------------------------------------------------------------------ */

export interface PipelineRequest {
  domain: string;
}

export interface PipelineStepStatus {
  agent: AgentId;
  label: string;
  description: string;
  status: "pending" | "running" | "complete" | "fallback" | "error";
  durationMs: number;
  note: string;
}

export interface PipelineResult {
  domain: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  discovery: AgentEnvelope<DiscoveryOutput>;
  problem: AgentEnvelope<ProblemOutput>;
  solution: AgentEnvelope<SolutionOutput>;
  videoScript: AgentEnvelope<VideoScriptOutput>;
  email: AgentEnvelope<EmailOutput>;
  steps: PipelineStepStatus[];
  /** True when any step degraded to mock data. */
  usedFallback: boolean;
}

export interface PipelineErrorResponse {
  error: string;
  detail?: string;
  /** Present when the pipeline still produced a usable mock result. */
  fallback?: PipelineResult;
}

/* ------------------------------------------------------------------ */
/* Type guards                                                         */
/* ------------------------------------------------------------------ */

export const isPipelineResult = (
  value: unknown,
): value is PipelineResult => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<PipelineResult>;
  return (
    typeof candidate.domain === "string" &&
    typeof candidate.discovery === "object" &&
    typeof candidate.email === "object"
  );
};

export const isPipelineError = (
  value: unknown,
): value is PipelineErrorResponse => {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as PipelineErrorResponse).error === "string";
};
