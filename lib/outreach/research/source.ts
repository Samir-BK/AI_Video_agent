import "server-only";

import { withTimeout } from "@/lib/outreach/fetchText";
import type {
  EntityCandidate,
  FetchedPage,
  ResearchLogEntry,
  SourcedFact,
} from "@/types/outreach";

/**
 * A research source is any key-free (or optional-key) place we read public
 * company information from. Sources run in parallel, each under its own
 * deadline, and never throw.
 */

/** Per-source budget (project rule: no single step waits more than 6s). */
export const SOURCE_TIMEOUT_MS = 6000;

/** Budget for the whole research phase. */
export const RESEARCH_BUDGET_MS = 20_000;

export interface ResearchContext {
  domain: string;
  /** https origin of the company site, e.g. "https://www.example.fi". */
  origin: string;
  /** Best current guess of the company name. */
  companyName: string;
  entity: EntityCandidate | null;
}

export interface SourceOutput {
  /** Pages whose text can back up quotes (key = page URL). */
  pages: FetchedPage[];
  /** Facts the source could produce deterministically (no LLM). */
  facts: SourcedFact[];
  log: ResearchLogEntry[];
}

export interface ResearchSource {
  id: string;
  label: string;
  run: (ctx: ResearchContext) => Promise<SourceOutput>;
}

export const emptyOutput = (): SourceOutput => ({ pages: [], facts: [], log: [] });

/** Run one source under a deadline; a timeout yields an empty, logged result. */
export const runSource = async (
  source: ResearchSource,
  ctx: ResearchContext,
  timeoutMs = SOURCE_TIMEOUT_MS,
): Promise<SourceOutput> => {
  const startedAt = Date.now();
  const timedOut: SourceOutput = {
    ...emptyOutput(),
    log: [
      {
        source: source.label,
        ok: false,
        durationMs: timeoutMs,
        note: `Timed out after ${timeoutMs} ms`,
      },
    ],
  };

  try {
    const output = await withTimeout(
      source.run(ctx).catch((error: unknown): SourceOutput => ({
        ...emptyOutput(),
        log: [
          {
            source: source.label,
            ok: false,
            durationMs: Date.now() - startedAt,
            note: error instanceof Error ? error.message.slice(0, 160) : "Failed",
          },
        ],
      })),
      timeoutMs,
      timedOut,
    );
    return output;
  } catch {
    return timedOut;
  }
};

/** Merge outputs from several sources. */
export const mergeOutputs = (outputs: SourceOutput[]): SourceOutput => ({
  pages: outputs.flatMap((output) => output.pages),
  facts: outputs.flatMap((output) => output.facts),
  log: outputs.flatMap((output) => output.log),
});

let factCounter = 0;

/** Short unique id for a fact within one run. */
export const nextFactId = (prefix: string): string => {
  factCounter = (factCounter + 1) % 1_000_000;
  return `${prefix}-${Date.now().toString(36)}-${factCounter.toString(36)}`;
};

export const nowIso = (): string => new Date().toISOString();
