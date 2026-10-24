import "server-only";

import type {
  AgentEnvelope,
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
import { callLlm, extractJson, isLlmConfigured, LlmTimeoutError } from "@/lib/llm";
import {
  companyNameFromDomain,
  mockDiscovery,
  mockEmail,
  mockProblem,
  mockSolution,
  mockVideoScript,
  selectArchetype,
} from "@/lib/mockData";
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
    const reason =
      error instanceof Error ? error.message.slice(0, 160) : "unknown error";
    return envelope(fallback(), "mock", durationMs, fallbackNote, {
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
Be specific and grounded in the provided content. Never invent facts not supported by it.`;

export const runDiscoveryAgent = async (
  domain: string,
  scrape: ScrapeResult,
): Promise<AgentEnvelope<DiscoveryOutput>> => {
  const fallback = () => mockDiscovery(domain);

  return runAgent(
    "Discovery Agent",
    async () => {
      if (!isLlmConfigured() || !scrape.ok) {
        throw new Error(
          !isLlmConfigured()
            ? "No LLM key configured"
            : `Scrape failed: ${scrape.error ?? "no content"}`,
        );
      }

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
${scrape.combinedText}

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
  "summary": string (one sentence naming the bottleneck and why it costs them),
  "severity": "low" | "medium" | "high" | "critical",
  "department": string (where the bottleneck lives),
  "symptoms": string[] (3 specific observable symptoms),
  "impact": {
    "hoursLostPerWeek": number (realistic integer, 5-60),
    "estimatedCost": string (short money framing, e.g. "$18k/mo in delayed quotes"),
    "risk": string (downstream business risk in one sentence)
  },
  "brokenSystems": string[] (3-5 named systems/tools that don't talk to each other)
}`;

export const runProblemAgent = async (
  discovery: DiscoveryOutput,
): Promise<AgentEnvelope<ProblemOutput>> => {
  const domain = discovery.domain;
  const fallback = () => mockProblem(domain);

  return runAgent(
    "Problem Agent",
    async () => {
      if (!isLlmConfigured()) throw new Error("No LLM key configured");

      const mock = mockProblem(domain);

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
  const fallback = () => mockSolution(domain);

  return runAgent(
    "Solution Agent",
    async () => {
      if (!isLlmConfigured()) throw new Error("No LLM key configured");

      const mock = mockSolution(domain);

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

const VIDEO_SYSTEM = `You are the Video Script Agent for Velho Applied Intelligence.
Write a 20-second, 3-scene video script personalized to the target company.
The video is shown to the CEO. It must feel like it was made only for them.
Timing is FIXED: scene 1 = 0-7s, scene 2 = 7-14s, scene 3 = 14-20s.
Voiceover must be speakable in the allotted seconds: roughly 2.5 words per second (scene 1 ~18 words, scene 2 ~18 words, scene 3 ~15 words).
Respond with ONLY a JSON object, no prose, no markdown fences.
Schema:
{
  "headline": string (landing page headline),
  "voiceStyle": string (delivery direction),
  "scenes": [
    {
      "id": 1,
      "startSec": 0, "endSec": 7,
      "title": string (short scene label),
      "voiceover": string (spoken words only, no stage directions),
      "overlays": [
        { "text": string, "position": "top"|"center"|"bottom", "emphasis": "primary"|"secondary"|"accent" }
      ] (2-3 overlays),
      "graphicCue": string (what the visual layer shows),
      "icon": string (a Lucide React icon name, e.g. "FileStack"),
      "transition": "fade"|"slide"|"zoom"|"wipe"
    }
  ] (exactly 3 scenes),
}`;

export const runVideoScriptAgent = async (
  discovery: DiscoveryOutput,
  problem: ProblemOutput,
  solution: SolutionOutput,
): Promise<AgentEnvelope<VideoScriptOutput>> => {
  const domain = discovery.domain;
  const fallback = () => mockVideoScript(domain);

  return runAgent(
    "Video Script Agent",
    async () => {
      if (!isLlmConfigured()) throw new Error("No LLM key configured");

      const mock = mockVideoScript(domain);
      const archetype = selectArchetype(domain);

      const raw = await callLlm({
        timeoutMs: AGENT_TIMEOUT_MS,
        temperature: 0.8,
        json: true,
        messages: [
          { role: "system", content: VIDEO_SYSTEM },
          {
            role: "user",
            content: `Company: ${discovery.companyName} (${discovery.industry})
Tagline: ${discovery.tagline}

Problem (scene 1): ${problem.title} — ${problem.summary}
Impact: ${problem.impact.hoursLostPerWeek} hrs/week, ${problem.impact.estimatedCost}

Solution (scene 2): ${solution.architectureName} — ${solution.summary}
Step 1 outcome: ${solution.steps[0]?.outcome ?? ""}

Outcome (scene 3): ${solution.steps[2]?.outcome ?? solution.headlineMetric.delta}
Time to value: ${solution.timeToValue}

Write the 3-scene script. Speak directly to ${discovery.companyName}'s leadership.`,
          },
        ],
      });

      const parsed = extractJson<Record<string, unknown>>(raw);
      if (!parsed) throw new Error("Video Script Agent returned unparseable JSON");

      const rawScenes = Array.isArray(parsed.scenes) ? parsed.scenes : [];
      if (rawScenes.length === 0) {
        throw new Error("Video Script Agent returned no scenes");
      }

      // Fixed timeline — never let the model drift off the 20s budget.
      const timeline = [
        { start: 0, end: 7 },
        { start: 7, end: 14 },
        { start: 14, end: 20 },
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
          voiceover: asString(candidate.voiceover, mockScene.voiceover),
          overlays: overlays.length > 0 ? overlays : mockScene.overlays,
          graphicCue: asString(candidate.graphicCue, mockScene.graphicCue),
          icon: asString(candidate.icon, archetype.scenes[index]?.icon ?? "Sparkles"),
          transition: asTransition(
            candidate.transition,
            mockScene.transition,
          ),
        };
      });

      const data: VideoScriptOutput = {
        durationSec: 20,
        headline: asString(parsed.headline, mock.headline),
        scenes,
        voiceStyle: asString(parsed.voiceStyle, mock.voiceStyle),
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
- Sentence 4: the personalized 20-second video link.
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
  const fallback = () => mockEmail(domain, videoUrl);

  return runAgent(
    "Copywriter Agent",
    async () => {
      if (!isLlmConfigured()) throw new Error("No LLM key configured");

      const mock = mockEmail(domain, videoUrl);

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
