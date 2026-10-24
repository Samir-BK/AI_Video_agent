import { NextResponse } from "next/server";

import {
  buildVideoUrl,
  runDiscoveryAgent,
  runEmailAgent,
  runProblemAgent,
  runSolutionAgent,
  runVideoScriptAgent,
} from "@/lib/agents";
import { buildMockPipelineOutputs, normalizeDomain } from "@/lib/mockData";
import { scrapeDomain } from "@/lib/scraper";
import type {
  AgentEnvelope,
  AgentId,
  PipelineResult,
  PipelineStepStatus,
} from "@/types/pipeline";
import {
  AGENT_DESCRIPTIONS,
  AGENT_LABELS,
  AGENT_ORDER,
  createAgentMeta,
} from "@/types/pipeline";

/**
 * POST /api/generate-outreach
 *
 * Runs the strict 5-agent pipeline: Discovery -> Problem -> Solution ->
 * VideoScript -> Email. The route is engineered so it ALWAYS returns a
 * complete, renderable payload — a live stage demo must never show an error
 * screen, even if scraping and the LLM both fail.
 */

export const runtime = "nodejs";
/** Scraping + 5 sequential agents needs headroom. */
export const maxDuration = 60;

interface RequestBody {
  domain?: unknown;
}

const DOMAIN_PATTERN =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

const stepStatusFromEnvelope = (
  agent: AgentId,
  envelope: AgentEnvelope<unknown>,
): PipelineStepStatus => ({
  agent,
  label: AGENT_LABELS[agent],
  description: AGENT_DESCRIPTIONS[agent],
  status: envelope.meta.source === "live" ? "complete" : "fallback",
  durationMs: envelope.meta.durationMs,
  note: envelope.meta.note,
});

/** Build a fully-mocked result used when input is invalid or fatal. */
const buildFallbackResult = (domain: string): PipelineResult => {
  const started = Date.now();
  const outputs = buildMockPipelineOutputs(domain);
  const note = "Instant fallback profile (pipeline bypassed)";
  const env = <T,>(data: T): AgentEnvelope<T> => ({
    data,
    meta: createAgentMeta("mock", { note, durationMs: 0 }),
  });

  const steps = AGENT_ORDER.map((agent) =>
    stepStatusFromEnvelope(agent, env(null)),
  );

  return {
    domain,
    startedAt: new Date(started).toISOString(),
    completedAt: new Date().toISOString(),
    totalDurationMs: Date.now() - started,
    discovery: env(outputs.discovery),
    problem: env(outputs.problem),
    solution: env(outputs.solution),
    videoScript: env(outputs.videoScript),
    email: env(outputs.email),
    steps,
    usedFallback: true,
  };
};

export async function POST(request: Request): Promise<NextResponse> {
  const startedAt = Date.now();

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Expected { domain: string }." },
      { status: 400 },
    );
  }

  const rawDomain = typeof body.domain === "string" ? body.domain : "";
  const domain = normalizeDomain(rawDomain);

  if (!domain) {
    return NextResponse.json(
      { error: "A domain is required, e.g. { \"domain\": \"fazer.com\" }." },
      { status: 400 },
    );
  }

  if (!DOMAIN_PATTERN.test(domain)) {
    return NextResponse.json(
      {
        error: `"${domain}" doesn't look like a valid domain.`,
        detail: "Use a bare hostname like fazer.com — no paths or spaces.",
      },
      { status: 400 },
    );
  }

  try {
    // ---- Step 1: Discovery (scrape + profile) -----------------------
    const scrape = await scrapeDomain(domain, 5000);
    const discovery = await runDiscoveryAgent(domain, scrape);

    // ---- Step 2: Problem -------------------------------------------
    const problem = await runProblemAgent(discovery.data);

    // ---- Step 3: Solution ------------------------------------------
    const solution = await runSolutionAgent(discovery.data, problem.data);

    // ---- Step 4: Video Script --------------------------------------
    const videoScript = await runVideoScriptAgent(
      discovery.data,
      problem.data,
      solution.data,
    );

    // ---- Step 5: Email ---------------------------------------------
    const videoUrl = buildVideoUrl(domain);
    const email = await runEmailAgent(
      discovery.data,
      problem.data,
      solution.data,
      videoUrl,
    );

    const steps: PipelineStepStatus[] = [
      stepStatusFromEnvelope("discovery", discovery),
      stepStatusFromEnvelope("problem", problem),
      stepStatusFromEnvelope("solution", solution),
      stepStatusFromEnvelope("videoScript", videoScript),
      stepStatusFromEnvelope("email", email),
    ];

    const result: PipelineResult = {
      domain,
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - startedAt,
      discovery,
      problem,
      solution,
      videoScript,
      email,
      steps,
      usedFallback: steps.some((step) => step.status === "fallback"),
    };

    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    // Last-resort net: still return a usable payload so the UI renders.
    const detail =
      error instanceof Error ? error.message.slice(0, 200) : "Unknown error";
    const fallback = buildFallbackResult(domain);

    return NextResponse.json(
      {
        error: "Pipeline hit an unexpected error; serving fallback data.",
        detail,
        fallback,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    {
      error: "Method not allowed. POST { domain: string } to run the pipeline.",
    },
    { status: 405 },
  );
}
