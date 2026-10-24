import "server-only";

import type {
  AgentEnvelope,
  BottleneckCategory,
  CartoonActor,
  CartoonAnimationScene,
  CartoonAnimationType,
  DiscoveryOutput,
  EmailOutput,
  ProblemOutput,
  ProblemSeverity,
  ResultSource,
  SceneTransition,
  SolutionOutput,
  TextOverlay,
  VideoScene,
  VideoScriptOutput,
} from "@/types/pipeline";
import { createAgentMeta } from "@/types/pipeline";
import {
  callLlm,
  extractJson,
  isLlmConfigured,
  LlmModelRetiredError,
  LlmNotConfiguredError,
  LlmTimeoutError,
} from "@/lib/llm";
import {
  companyNameFromDomain,
  mockDiscovery,
  mockEmail,
  mockProblem,
  mockSolution,
  mockVideoScript,
  selectArchetype,
} from "@/lib/mockData";
import {
  buildCartoonScenes,
  CARTOON_TIMELINE,
  classifyBottleneck,
  isBottleneckCategory,
} from "@/lib/cartoonPresets";
import { personalizeScenes, sanitizeAuthoredScene } from "@/lib/cartoonPersonalize";
import { prepareVoiceover } from "@/lib/voiceoverBudget";
import { paletteFromColors, type ScrapeResult } from "@/lib/scraper";

/**
 * The 5-agent pipeline.
 *
 * Each runner:
 *   1. Builds a focused prompt.
 *   2. Calls the LLM under a 6s deadline (project rule).
 *   3. Validates + normalizes the JSON response against the strict type.
 *   4. Falls back to deterministic mock data on ANY failure.
 *
 * The `meta` on every envelope records which path was taken, so the UI can
 * show honest provenance instead of pretending everything ran live.
 */

const AGENT_TIMEOUT_MS = 6000;

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;

const asStringArray = (
  value: unknown,
  fallback: string[],
  max = 8,
): string[] => {
  if (!Array.isArray(value)) return fallback;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, max);
  return items.length > 0 ? items : fallback;
};

const asHex = (value: unknown, fallback: string): string => {
  if (typeof value !== "string") return fallback;
  const match = /^#(?:[0-9a-f]{6}|[0-9a-f]{3})$/i.exec(value.trim());
  return match ? value.trim().toLowerCase() : fallback;
};

const asSeverity = (
  value: unknown,
  fallback: ProblemSeverity,
): ProblemSeverity => {
  const allowed: ProblemSeverity[] = ["low", "medium", "high", "critical"];
  return allowed.includes(value as ProblemSeverity)
    ? (value as ProblemSeverity)
    : fallback;
};

const asNumber = (value: unknown, fallback: number, min = 0): number => {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.round(parsed));
};

const asTransition = (
  value: unknown,
  fallback: SceneTransition,
): SceneTransition => {
  const allowed: SceneTransition[] = ["fade", "slide", "zoom", "wipe"];
  return allowed.includes(value as SceneTransition)
    ? (value as SceneTransition)
    : fallback;
};

const asPosition = (
  value: unknown,
  fallback: TextOverlay["position"],
): TextOverlay["position"] => {
  const allowed: TextOverlay["position"][] = ["top", "center", "bottom"];
  return allowed.includes(value as TextOverlay["position"])
    ? (value as TextOverlay["position"])
    : fallback;
};

const asEmphasis = (
  value: unknown,
  fallback: TextOverlay["emphasis"],
): TextOverlay["emphasis"] => {
  const allowed: TextOverlay["emphasis"][] = ["primary", "secondary", "accent"];
  return allowed.includes(value as TextOverlay["emphasis"])
    ? (value as TextOverlay["emphasis"])
    : fallback;
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const asBottleneckCategory = (
  value: unknown,
  fallback: BottleneckCategory,
): BottleneckCategory => (isBottleneckCategory(value) ? value : fallback);

const ANIMATION_TYPES: readonly CartoonAnimationType[] = [
  "shake",
  "bounce",
  "pulse",
  "slide_in",
  "spin_gear",
  "fade_red_to_green",
];

const asAnimationType = (
  value: unknown,
  fallback: CartoonAnimationType,
): CartoonAnimationType => {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  const match = ANIMATION_TYPES.find((type) => type === normalized);
  return match ?? fallback;
};

/**
 * Normalize model-authored actors, keeping only well-formed entries. An empty
 * result means the caller should fall back to the deterministic preset.
 */
const asActors = (value: unknown, max = 4): CartoonActor[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((candidate): CartoonActor | null => {
      const name = asString(candidate.name, "");
      const icon = asString(candidate.icon, "");
      if (!name || !icon) return null;
      return {
        name,
        icon,
        animation_type: asAnimationType(candidate.animation_type, "pulse"),
      };
    })
    .filter((actor): actor is CartoonActor => actor !== null)
    .slice(0, max);
};

/**
 * Validate the cartoon storyboard. Returns null when the model produced
 * nothing usable, so the caller can substitute the category preset.
 */
const asCartoonScenes = (
  value: unknown,
): CartoonAnimationScene[] | null => {
  if (!Array.isArray(value)) return null;

  const scenes = value
    .filter(isRecord)
    .map((candidate, index): CartoonAnimationScene | null => {
      const actors = asActors(candidate.actors);
      const flow = asStringArray(candidate.flow_diagram_steps, [], 10);
      const caption = asString(candidate.text_caption, "");
      if (actors.length === 0 || flow.length === 0 || !caption) return null;

      const isProblem =
        asString(candidate.type, "") === "problem_animation" || index === 0;

      return {
        scene_index: index + 1,
        time_range: asString(
          candidate.time_range,
          isProblem
            ? `${CARTOON_TIMELINE.problemStart}s-${CARTOON_TIMELINE.problemEnd}s`
            : `${CARTOON_TIMELINE.solutionStart}s-${CARTOON_TIMELINE.solutionEnd}s`,
        ),
        type: isProblem ? "problem_animation" : "solution_animation",
        actors,
        visual_metaphor: asString(candidate.visual_metaphor, ""),
        flow_diagram_steps: flow,
        text_caption: caption,
      };
    })
    .filter((scene): scene is CartoonAnimationScene => scene !== null)
    .slice(0, 2);

  return scenes.length >= 1 ? scenes : null;
};

/* ------------------------------------------------------------------ */
/* Envelope helper                                                     */
/* ------------------------------------------------------------------ */

const envelope = <T,>(
  data: T,
  source: ResultSource,
  durationMs: number,
  note: string,
  extra: Partial<{ timedOut: boolean; warnings: string[] }> = {},
): AgentEnvelope<T> => ({
  data,
  meta: createAgentMeta(source, {
    durationMs,
    note,
    timedOut: extra.timedOut ?? false,
    warnings: extra.warnings ?? [],
  }),
});

/** Run an agent body with timing + graceful degradation. */
const runAgent = async <T,>(
  agentName: string,
  body: () => Promise<{ data: T; source: ResultSource; warnings?: string[] }>,
  fallback: () => T,
  fallbackNote: string,
): Promise<AgentEnvelope<T>> => {
  const startedAt = Date.now();
  try {
    const { data, source, warnings } = await body();
    const durationMs = Date.now() - startedAt;
    return envelope(
      data,
      source,
      durationMs,
      source === "live"
        ? `${agentName} completed live`
        : `${agentName} completed with partial live data`,
      { warnings },
    );
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const timedOut = error instanceof LlmTimeoutError;

    // Surface the actionable cause instead of a blanket "failed" note, so the
    // pipeline log distinguishes "you never set a key" from "your model was
    // retired" from "the key errored".
    const note =
      error instanceof LlmNotConfiguredError
        ? error.message
        : error instanceof LlmModelRetiredError
          ? error.message
          : error instanceof LlmTimeoutError
            ? `${agentName} hit the ${AGENT_TIMEOUT_MS}ms deadline; served fallback data`
            : timedOut
              ? `${agentName} timed out; served fallback data`
              : fallbackNote;

    const reason =
      error instanceof Error ? error.message.slice(0, 160) : "unknown error";

    return envelope(fallback(), "mock", durationMs, note, {
      timedOut,
      warnings: [`${agentName} fell back: ${reason}`],
    });
  }
};

/* ------------------------------------------------------------------ */
/* Step 1 — Discovery                                                  */
/* ------------------------------------------------------------------ */

const DISCOVERY_SYSTEM = `You are the Discovery Agent for Velho Applied Intelligence, a B2B AI automation company.
You analyze a target company's website content and extract a precise, factual company profile.
Respond with ONLY a JSON object, no prose, no markdown fences.
Schema:
{
  "companyName": string,
  "tagline": string (one sentence positioning line),
  "businessModel": string (2-3 sentences on how they make money),
  "industry": string,
  "companySize": string (employee band like "50-200"),
  "markets": string[] (2-4 markets served),
  "operationalSignals": string[] (3-4 observable clues about manual/operational pain: careers posts, tech stack, contact flows),
  "offerings": string[] (3-5 product or service lines),
  "brand": {
    "palette": { "primary": string hex, "secondary": string hex, "accent": string hex },
    "glyph": string (single emoji fitting the industry),
    "tone": string (short voice description)
  }
}
Be specific and grounded in the provided content (or, when no content is available, in well-known public facts about the company). Never invent figures.`;

export const runDiscoveryAgent = async (
  domain: string,
  scrape: ScrapeResult,
): Promise<AgentEnvelope<DiscoveryOutput>> => {
  const fallback = () => mockDiscovery(domain);

  return runAgent(
    "Discovery Agent",
    async () => {
      // Check credentials first: it is the only failure with a clear fix, and
      // the scrape error is meaningless if we could never call the model.
      if (!isLlmConfigured()) throw new LlmNotConfiguredError();
      // A blocked scrape (bot walls on big brands) must not drop us onto a
      // domain-keyword guess: the model usually knows the company already.
      const siteContent = scrape.ok
        ? scrape.combinedText
        : `(The website could not be fetched: ${scrape.error ?? "no content"}. Use your own knowledge of the company at ${domain}. If you do not recognise it, infer conservatively from the domain name.)`;

      const mock = mockDiscovery(domain);
      const scrapedColors = scrape.pages.flatMap((page) => page.colors);
      const palette = paletteFromColors(scrapedColors, mock.brand.palette);

      const raw = await callLlm({
        timeoutMs: AGENT_TIMEOUT_MS,
        temperature: 0.4,
        json: true,
        messages: [
          { role: "system", content: DISCOVERY_SYSTEM },
          {
            role: "user",
            content: `Target domain: ${domain}

Scraped website content:
${siteContent}

Detected brand colours from CSS: ${scrapedColors.slice(0, 5).join(", ") || "none detected"}

Extract the company profile JSON now.`,
          },
        ],
      });

      const parsed = extractJson<Record<string, unknown>>(raw);
      if (!parsed) throw new Error("Discovery returned unparseable JSON");

      const brand = isRecord(parsed.brand) ? parsed.brand : {};
      const brandPalette = isRecord(brand.palette) ? brand.palette : {};

      const data: DiscoveryOutput = {
        domain,
        companyName: asString(parsed.companyName, mock.companyName),
        tagline: asString(parsed.tagline, mock.tagline),
        businessModel: asString(parsed.businessModel, mock.businessModel),
        industry: asString(parsed.industry, mock.industry),
        companySize: asString(parsed.companySize, mock.companySize),
        markets: asStringArray(parsed.markets, mock.markets, 5),
        operationalSignals: asStringArray(
          parsed.operationalSignals,
          mock.operationalSignals,
          5,
        ),
        offerings: asStringArray(parsed.offerings, mock.offerings, 6),
        brand: {
          palette: {
            primary: asHex(brandPalette.primary, palette.primary),
            secondary: asHex(brandPalette.secondary, palette.secondary),
            accent: asHex(brandPalette.accent, palette.accent),
          },
          glyph: asString(brand.glyph, mock.brand.glyph).slice(0, 4),
          tone: asString(brand.tone, mock.brand.tone),
        },
      };

      return { data, source: "live" as ResultSource };
    },
    fallback,
    scrape.ok
      ? "Discovery used fallback profile (LLM unavailable or failed)"
      : `Discovery used fallback profile — ${scrape.error ?? "scrape unavailable"}`,
  );
};

/* ------------------------------------------------------------------ */
/* Step 2 — Problem                                                    */
/* ------------------------------------------------------------------ */

const PROBLEM_SYSTEM = `You are the Problem Agent for Velho Applied Intelligence.
Given a company profile, identify the single most expensive operational bottleneck that AI automation can remove.
Prefer concrete, unglamorous back-office pain (manual quote intake, field reporting, cross-system data entry, document chasing) over vague "digital transformation".
Respond with ONLY a JSON object, no prose, no markdown fences.
Schema:
{
  "title": string (3-5 words, e.g. "Manual Quote Intake"),
  "summary": string (one plain-English sentence a CEO would recognise from their own week: WHO does WHAT by hand, in WHICH tool, and what it delays. Bad: "Inefficient data workflows hinder scalability." Good: "Your planners copy every customer order from email into SAP by hand, so production waits a day for each change."),
  "severity": "low" | "medium" | "high" | "critical",
  "department": string (where the bottleneck lives, 1-3 words, e.g. "Order Desk"),
  "symptoms": string[] (3 specific observable symptoms, each a short sentence naming the manual action, e.g. "Orders are re-typed from PDF into SAP"),
  "impact": {
    "hoursLostPerWeek": number (realistic integer, 5-60),
    "estimatedCost": string (short money framing, e.g. "$18k/mo in delayed quotes"),
    "risk": string (downstream business risk in one sentence)
  },
  "brokenSystems": string[] (3-5 short names of the real tools involved, 1-2 words each, e.g. "Outlook", "SAP", "Excel", "WhatsApp" — these are drawn as characters in the video)
}
The bottleneck must fit THIS company's actual business (a bank is not a construction firm; a clinic is not a SaaS company). Avoid jargon such as "synergy", "digital transformation", "streamline", "leverage".`;

export const runProblemAgent = async (
  discovery: DiscoveryOutput,
): Promise<AgentEnvelope<ProblemOutput>> => {
  const domain = discovery.domain;
  const fallback = () => mockProblem(domain, { discovery });

  return runAgent(
    "Problem Agent",
    async () => {
      if (!isLlmConfigured()) throw new LlmNotConfiguredError();

      const mock = mockProblem(domain, { discovery });

      const raw = await callLlm({
        timeoutMs: AGENT_TIMEOUT_MS,
        temperature: 0.6,
        json: true,
        messages: [
          { role: "system", content: PROBLEM_SYSTEM },
          {
            role: "user",
            content: `Company profile:
- Name: ${discovery.companyName}
- Industry: ${discovery.industry}
- Size: ${discovery.companySize}
- Business model: ${discovery.businessModel}
- Offerings: ${discovery.offerings.join(", ")}
- Markets: ${discovery.markets.join(", ")}
- Operational signals: ${discovery.operationalSignals.join(" | ")}

Identify the single highest-cost operational bottleneck.`,
          },
        ],
      });

      const parsed = extractJson<Record<string, unknown>>(raw);
      if (!parsed) throw new Error("Problem Agent returned unparseable JSON");

      const impact = isRecord(parsed.impact) ? parsed.impact : {};

      const data: ProblemOutput = {
        title: asString(parsed.title, mock.title),
        summary: asString(parsed.summary, mock.summary),
        severity: asSeverity(parsed.severity, mock.severity),
        department: asString(parsed.department, mock.department),
        symptoms: asStringArray(parsed.symptoms, mock.symptoms, 5),
        impact: {
          hoursLostPerWeek: clamp(
            asNumber(impact.hoursLostPerWeek, mock.impact.hoursLostPerWeek, 1),
            1,
            200,
          ),
          estimatedCost: asString(
            impact.estimatedCost,
            mock.impact.estimatedCost,
          ),
          risk: asString(impact.risk, mock.impact.risk),
        },
        brokenSystems: asStringArray(
          parsed.brokenSystems,
          mock.brokenSystems,
          6,
        ),
      };

      return { data, source: "live" as ResultSource };
    },
    fallback,
    "Problem Agent used fallback diagnosis (LLM unavailable or failed)",
  );
};

/* ------------------------------------------------------------------ */
/* Step 3 — Solution                                                   */
/* ------------------------------------------------------------------ */

const SOLUTION_SYSTEM = `You are the Solution Agent for Velho Applied Intelligence.
Map Velho's AI automation capabilities onto the identified bottleneck and produce a 3-step solution architecture.
Velho capabilities include: Document Intelligence, Decision Automation, Workflow Orchestration, System Integration, Process Automation, Mobile Capture, Document Generation, Ambient Capture, Quality Analytics, Analytics Layer.
Respond with ONLY a JSON object, no prose, no markdown fences.
Schema:
{
  "architectureName": string (e.g. "Acme Bid Engine"),
  "summary": string (one sentence elevator pitch),
  "steps": [
    { "order": 1, "title": string (2 words), "description": string (one sentence, specific to this company), "velhoCapability": string, "outcome": string (quantified result) }
  ] (exactly 3 steps),
  "headlineMetric": { "label": string, "value": string, "delta": string (e.g. "12x faster") },
  "integrations": string[] (3-5 real systems this company likely uses),
  "timeToValue": string (e.g. "3 weeks to production")
}`;

export const runSolutionAgent = async (
  discovery: DiscoveryOutput,
  problem: ProblemOutput,
): Promise<AgentEnvelope<SolutionOutput>> => {
  const domain = discovery.domain;
  const fallback = () => mockSolution(domain, { discovery, problem });

  return runAgent(
    "Solution Agent",
    async () => {
      if (!isLlmConfigured()) throw new LlmNotConfiguredError();

      const mock = mockSolution(domain, { discovery, problem });

      const raw = await callLlm({
        timeoutMs: AGENT_TIMEOUT_MS,
        temperature: 0.6,
        json: true,
        messages: [
          { role: "system", content: SOLUTION_SYSTEM },
          {
            role: "user",
            content: `Company: ${discovery.companyName} (${discovery.industry})
Business model: ${discovery.businessModel}
Offerings: ${discovery.offerings.join(", ")}

Bottleneck to solve: ${problem.title}
Summary: ${problem.summary}
Department: ${problem.department}
Symptoms: ${problem.symptoms.join(" | ")}
Broken systems: ${problem.brokenSystems.join(", ")}
Impact: ${problem.impact.hoursLostPerWeek} hrs/week lost; ${problem.impact.estimatedCost}

Design the 3-step Velho solution architecture.`,
          },
        ],
      });

      const parsed = extractJson<Record<string, unknown>>(raw);
      if (!parsed) throw new Error("Solution Agent returned unparseable JSON");

      const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
      const steps = mock.steps.map((mockStep, index) => {
        const candidate = rawSteps[index];
        if (!isRecord(candidate)) return mockStep;
        return {
          order: index + 1,
          title: asString(candidate.title, mockStep.title),
          description: asString(candidate.description, mockStep.description),
          velhoCapability: asString(
            candidate.velhoCapability,
            mockStep.velhoCapability,
          ),
          outcome: asString(candidate.outcome, mockStep.outcome),
        };
      });

      const metric = isRecord(parsed.headlineMetric)
        ? parsed.headlineMetric
        : {};

      const data: SolutionOutput = {
        architectureName: asString(
          parsed.architectureName,
          mock.architectureName,
        ),
        summary: asString(parsed.summary, mock.summary),
        steps,
        headlineMetric: {
          label: asString(metric.label, mock.headlineMetric.label),
          value: asString(metric.value, mock.headlineMetric.value),
          delta: asString(metric.delta, mock.headlineMetric.delta),
        },
        integrations: asStringArray(
          parsed.integrations,
          mock.integrations,
          6,
        ),
        timeToValue: asString(parsed.timeToValue, mock.timeToValue),
      };

      return { data, source: "live" as ResultSource };
    },
    fallback,
    "Solution Agent used fallback architecture (LLM unavailable or failed)",
  );
};

/* ------------------------------------------------------------------ */
/* Step 4 — Video Script                                               */
/* ------------------------------------------------------------------ */

const VIDEO_SYSTEM = `You are the Video Script Agent for Velho Applied Intelligence. Write a 45-second video script personalized to the target company, shown to its CEO. Reply with ONLY a JSON object — no prose, no markdown fences.

Timing is FIXED: scene 1 = 0-6s (company identity), scene 2 = 6-24s (the problem), scene 3 = 24-38s (the solution), scene 4 = 38-45s (book a meeting, one click).

VOICEOVER RULES (this is spoken aloud by a neural narrator):
- Pace: roughly 2.4 words per second. Scene 1 about 14 words, scene 2 about 42 words, scene 3 about 32 words, scene 4 about 16 words. Narration that runs long is cut off mid-sentence.
- Use only WORDS: no numbers, symbols, ampersands, arrows, URLs, parentheses or abbreviations. Write "forty hours", never "40 hours"; "four systems", never "4 systems".
- Write complete grammatical sentences, because a narrator cannot repair a broken one.
- Speak in the second person about the listener's own team, and never say you studied or analysed anything.

NARRATIVE ARC (mandatory):
- Scene 1: greet the company by name and say this video was made for them.
- Scene 2: open with "Here is the problem." then describe it in plain language a CEO recognises from their own week: what the work looks like, who is stuck, and what it costs. Name the concrete manual step (re-typing, chasing, double entry), never a category of software.
- Scene 3: open with "Now, the solution." then answer THAT SAME problem directly — the fix must pick up the exact manual step named in scene 2 and say what happens to it instead. Then the outcome and the time to go live. Do not book the meeting in this scene.
- Scene 4: invite them to book a fifteen-minute walkthrough with one click. No new problem or product claims.
The problem and solution must be two halves of one argument.

Also classify the bottleneck into exactly one of: "quoting_and_order_intake" (quotes, RFQs, orders, bids), "field_reporting" (field/job reports, proof of delivery, inspections), "scheduling" (appointments, dispatch, rosters, shifts), "cross_system_data" (the same data re-keyed across disconnected systems).

Then author exactly two CARTOON beats. The visuals are wordless flat vector diagrams, so these fields describe SHAPES and MOTION only — never a sentence to be read on screen. Ground every actor and flow step in this company's real tools from the input, never a generic placeholder like "System A" or "Manual Spreadsheet".

Schema:
{
  "headline": string (landing page headline),
  "bottleneckCategory": "quoting_and_order_intake" | "field_reporting" | "scheduling" | "cross_system_data",
  "scenes": [
    { "id": 1, "title": string (3-5 words), "voiceover": string },
    { "id": 2, "title": string (3-5 words), "voiceover": string },
    { "id": 3, "title": string (3-5 words), "voiceover": string },
    { "id": 4, "title": "Book a meeting", "voiceover": string }
  ],
  "cartoonScenes": [
    {
      "type": "problem_animation",
      "actors": [ { "name": string (1-3 words, e.g. "Inbound RFQ PDF", "Stressed Estimator"), "icon": string (a real Lucide React icon name, e.g. "FileSpreadsheet", "UserX", "Clock"), "animation_type": "shake" | "bounce" | "pulse" } ] (2-4 actors),
      "visual_metaphor": string (one vivid sentence describing THIS company's specific manual bottleneck),
      "flow_diagram_steps": string[] (a chain of 3 or 4 node labels alternating with "-->", each label 1-3 words, e.g. ["Unstructured Email", "-->", "Manual Copy-Paste", "-->", "Excel Error"]),
      "text_caption": string (6-10 words)
    },
    {
      "type": "solution_animation",
      "actors": [ same shape, and MUST include an actor named "Velho AI Engine" with icon "Cog" and animation_type "spin_gear" ] (3 actors),
      "visual_metaphor": string (one vivid sentence: messy inputs flowing into the Velho AI Engine and emerging as clean automated outputs),
      "flow_diagram_steps": string[] (chain of 3 or 4 nodes ending in the automated outcome, e.g. ["RFQ PDF", "-->", "Velho AI Engine", "-->", "Auto ERP Entry"]),
      "text_caption": string (6-10 words)
    }
  ]
}
Output no other fields. Keep every string short — this response has a hard time limit.`;

export const runVideoScriptAgent = async (
  discovery: DiscoveryOutput,
  problem: ProblemOutput,
  solution: SolutionOutput,
): Promise<AgentEnvelope<VideoScriptOutput>> => {
  const domain = discovery.domain;
  const fallback = () => mockVideoScript(domain, { discovery, problem, solution });

  return runAgent(
    "Video Script Agent",
    async () => {
      if (!isLlmConfigured()) throw new LlmNotConfiguredError();

      const mock = mockVideoScript(domain, { discovery, problem, solution });
      const archetype = selectArchetype(domain, discovery.industry);

      const raw = await callLlm({
        // The script agent writes the largest payload in the pipeline; the
        // problem/solution agents it depends on have already consumed part of
        // the 6s budget, so it gets its own full window plus headroom.
        // No maxTokens: on a reasoning model the cap includes thinking tokens,
        // which truncates the JSON before it is complete.
        timeoutMs: AGENT_TIMEOUT_MS + 4000,
        temperature: 0.8,
        json: true,
        messages: [
          { role: "system", content: VIDEO_SYSTEM },
          {
            role: "user",
            content: `Company: ${discovery.companyName} (${discovery.industry})
Tagline: ${discovery.tagline}
Department that hurts: ${problem.department}
Their systems: ${problem.brokenSystems.join(", ")}

Bottleneck (drives the 6-24s cartoon): ${problem.title} — ${problem.summary}
Symptoms: ${problem.symptoms.join(" | ")}
Impact: ${problem.impact.hoursLostPerWeek} hrs/week, ${problem.impact.estimatedCost}

Solution (drives the 24-38s cartoon): ${solution.architectureName} — ${solution.summary}
Step 1 outcome: ${solution.steps[0]?.outcome ?? ""}
Integrations: ${solution.integrations.join(", ")}
Time to value: ${solution.timeToValue}

Classify the bottleneck, then write the 4-scene script with the two cartoon beats. Speak directly to ${discovery.companyName}'s leadership.`,
          },
        ],
      });

      const parsed = extractJson<Record<string, unknown>>(raw);
      if (!parsed) throw new Error("Video Script Agent returned unparseable JSON");

      const rawScenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
      if (rawScenes.length === 0) {
        throw new Error("Video Script Agent returned no scenes");
      }

      // Category: trust the model, otherwise classify locally — falling back
      // to the matched domain archetype — so the cartoon renderer always has
      // a specific layout to draw.
      const category = asBottleneckCategory(
        parsed.bottleneckCategory,
        classifyBottleneck(
          [
            domain,
            discovery.industry,
            problem.title,
            problem.summary,
            problem.department,
            ...problem.symptoms,
          ],
          domain,
          archetype.bottleneckCategory,
        ),
      );

      // Fixed timeline — never let the model drift off the 45s storyboard.
      const timeline = [
        { start: 0, end: CARTOON_TIMELINE.problemStart },
        { start: CARTOON_TIMELINE.problemStart, end: CARTOON_TIMELINE.problemEnd },
        { start: CARTOON_TIMELINE.solutionStart, end: CARTOON_TIMELINE.solutionEnd },
        { start: CARTOON_TIMELINE.bookingStart, end: CARTOON_TIMELINE.bookingEnd },
      ] as const;

      const scenes: VideoScene[] = timeline.map((slot, index) => {
        const candidate = isRecord(rawScenes[index]) ? rawScenes[index] : {};
        const mockScene = mock.scenes[index] ?? mock.scenes[0]!;

        const rawOverlays = Array.isArray(candidate.overlays)
          ? candidate.overlays
          : [];

        const overlays: TextOverlay[] =
          rawOverlays.length > 0
            ? rawOverlays
                .filter(isRecord)
                .slice(0, 4)
                .map((overlay) => ({
                  text: asString(overlay.text, ""),
                  position: asPosition(overlay.position, "center"),
                  emphasis: asEmphasis(overlay.emphasis, "primary"),
                }))
                .filter((overlay) => overlay.text !== "")
            : mockScene.overlays;

        return {
          id: index + 1,
          startSec: slot.start,
          endSec: slot.end,
          title: asString(candidate.title, mockScene.title),
          // Fitted to this scene's own slot: a spoken line that overruns its
          // window gets cut off mid-sentence by the next beat.
          voiceover: prepareVoiceover(
            asString(candidate.voiceover, mockScene.voiceover),
            slot.end - slot.start,
          ),
          overlays: overlays.length > 0 ? overlays : mockScene.overlays,
          graphicCue: asString(candidate.graphicCue, mockScene.graphicCue),
          icon: asString(candidate.icon, archetype.scenes[index]?.icon ?? "Sparkles"),
          transition: asTransition(
            candidate.transition,
            mockScene.transition,
          ),
        };
      });

      // Cartoon storyboard: prefer the model's authored beats, otherwise use
      // the hand-authored preset for the classified category. Either way the
      // video is specific to this company's bottleneck.
      // The preset is personalised with this company's own systems and solution
      // steps, so even the fallback beat is about them, not a stock example.
      const presetScenes = personalizeScenes(
        buildCartoonScenes(category, discovery.companyName),
        { companyName: discovery.companyName, problem, solution },
      );
      const authoredScenes = asCartoonScenes(parsed.cartoonScenes);

      const cartoonScenes: CartoonAnimationScene[] = [0, 1].map((index) => {
        const fallbackBeat = presetScenes[index]!;
        const authored = authoredScenes?.[index];
        return authored ? sanitizeAuthoredScene(authored, fallbackBeat) : fallbackBeat;
      });

      const data: VideoScriptOutput = {
        durationSec: CARTOON_TIMELINE.bookingEnd,
        headline: asString(parsed.headline, mock.headline),
        scenes,
        voiceStyle: asString(parsed.voiceStyle, mock.voiceStyle),
        bottleneckCategory: category,
        cartoonScenes,
      };

      return { data, source: "live" as ResultSource };
    },
    fallback,
    "Video Script Agent used fallback script (LLM unavailable or failed)",
  );
};

/* ------------------------------------------------------------------ */
/* Step 5 — Email                                                      */
/* ------------------------------------------------------------------ */

const EMAIL_SYSTEM = `You are the Copywriter Agent for Velho Applied Intelligence.
Write an ultra-concise cold email to the target company's CEO. NO fluff, no "I hope this finds you well", no buzzwords.
Hard rules:
- EXACTLY 4 body sentences. Not 3, not 5.
- Sentence 1: the specific bottleneck you found.
- Sentence 2: what it costs them, quantified.
- Sentence 3: what Velho built, in plain language.
- Sentence 4: the personalized 45-second video link.
- Then a short CTA and a sign-off.
Respond with ONLY a JSON object, no prose, no markdown fences.
Schema:
{
  "subject": string (under 60 chars, specific, no hype),
  "greeting": string,
  "bodySentences": [string, string, string, string],
  "callToAction": string,
  "signoff": string
}`;

export const runEmailAgent = async (
  discovery: DiscoveryOutput,
  problem: ProblemOutput,
  solution: SolutionOutput,
  videoUrl: string,
): Promise<AgentEnvelope<EmailOutput>> => {
  const domain = discovery.domain;
  const fallback = () => mockEmail(domain, videoUrl, { discovery, problem, solution });

  return runAgent(
    "Copywriter Agent",
    async () => {
      if (!isLlmConfigured()) throw new LlmNotConfiguredError();

      const mock = mockEmail(domain, videoUrl, { discovery, problem, solution });

      const raw = await callLlm({
        timeoutMs: AGENT_TIMEOUT_MS,
        temperature: 0.7,
        json: true,
        messages: [
          { role: "system", content: EMAIL_SYSTEM },
          {
            role: "user",
            content: `Company: ${discovery.companyName} (${discovery.industry})
Recipient: CEO

Bottleneck: ${problem.title} — ${problem.summary}
Symptoms: ${problem.symptoms.join(" | ")}
Impact: ${problem.impact.hoursLostPerWeek} hrs/week, ${problem.impact.estimatedCost}, risk: ${problem.impact.risk}

Solution: ${solution.architectureName} — ${solution.summary}
Outcome: ${solution.steps[0]?.outcome ?? ""}; ${solution.headlineMetric.delta}

Video link to include in sentence 4: ${videoUrl}

Write the 4-sentence email.`,
          },
        ],
      });

      const parsed = extractJson<Record<string, unknown>>(raw);
      if (!parsed) throw new Error("Copywriter Agent returned unparseable JSON");

      // Enforce exactly 4 sentences regardless of what the model returned.
      const rawSentences = asStringArray(parsed.bodySentences, [], 8);
      const bodySentences: string[] = [0, 1, 2, 3].map(
        (index) => rawSentences[index] ?? mock.bodySentences[index] ?? "",
      );

      // Guarantee the video link is present.
      if (!bodySentences.some((sentence) => sentence.includes(videoUrl))) {
        bodySentences[3] = `${bodySentences[3]} ${videoUrl}`.trim();
      }

      const subject = asString(parsed.subject, mock.subject).slice(0, 90);
      const greeting = asString(parsed.greeting, mock.greeting);
      const callToAction = asString(parsed.callToAction, mock.callToAction);
      const signoff = asString(parsed.signoff, mock.signoff);

      const data: EmailOutput = {
        recipientRole: "CEO",
        subject,
        greeting,
        bodySentences,
        callToAction,
        signoff,
        videoUrl,
        plainText: [
          `Subject: ${subject}`,
          "",
          greeting,
          "",
          ...bodySentences,
          "",
          callToAction,
          "",
          signoff,
        ].join("\n"),
      };

      return { data, source: "live" as ResultSource };
    },
    fallback,
    "Copywriter Agent used fallback email (LLM unavailable or failed)",
  );
};

/** Default video landing URL for a domain. */
export const buildVideoUrl = (domain: string): string => {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  const path = `/v/${encodeURIComponent(domain)}`;
  return base ? `${base}${path}` : `https://velho.ai${path}`;
};

export { companyNameFromDomain };
