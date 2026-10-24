import "server-only";

import { randomBytes } from "node:crypto";

import {
  runDiscoveryAgent,
  runProblemAgent,
  runSolutionAgent,
  runVideoScriptAgent,
} from "@/lib/agents";
import { companyNameFromDomain, normalizeDomain } from "@/lib/mockData";
import { writeRoleEmails, type RoleLinks, type RoleRequest } from "@/lib/outreach/emails";
import { buildCostEstimate, parseHourlyCost } from "@/lib/outreach/pure/estimate";
import { assessSufficiency } from "@/lib/outreach/pure/sufficiency";
import { dedupeFacts, verifyFacts } from "@/lib/outreach/pure/verify";
import { assignLeaderEmails } from "@/lib/outreach/research/contacts";
import { legalNamesFromText, resolveEntity } from "@/lib/outreach/research/entity";
import { extractFactsAndLeaders } from "@/lib/outreach/research/extract";
import { jobAdsSource } from "@/lib/outreach/research/jobAds";
import { runSource, type ResearchContext } from "@/lib/outreach/research/source";
import { tavilySource } from "@/lib/outreach/research/tavily";
import { websiteSource } from "@/lib/outreach/research/website";
import { getOutreachStore } from "@/lib/outreach/store";
import { normalizeOrigin, scrapeDomain } from "@/lib/scraper";
import type {
  CompanySignals,
  ExecRole,
  OutreachLanguage,
  OutreachProgressEvent,
  OutreachRequest,
  OutreachResult,
  ResearchLogEntry,
  SourcedFact,
} from "@/types/outreach";
import { EXEC_ROLES } from "@/types/outreach";

/**
 * Runs the outreach layer end to end:
 *   legacy pipeline (discovery, problem, solution, video script)
 *   + public-source research with verified quotes
 *   + one email per decision-maker.
 *
 * LLM budget per run: 4 legacy agents + 1 extraction + 1 email call = 6.
 * The legacy Email agent is intentionally not called.
 */

export interface RunOptions {
  /** Base URL for video / unsubscribe links (public URL in production). */
  appOrigin: string;
  onProgress?: (event: OutreachProgressEvent) => void;
  /** Roles to write. Roles without a named leader fold into the CEO email. */
  roles?: ExecRole[];
}

const newToken = (): string => randomBytes(9).toString("base64url");

const titleHead = (title: string): string =>
  (title.split(/[|–—:-]/)[0] ?? "").trim();

const groupSignals = (facts: SourcedFact[]): CompanySignals => ({
  strategyGoals: facts.filter((f) => f.kind === "strategy_goal" || f.kind === "financial"),
  hiring: facts.filter((f) => f.kind === "hiring"),
  whyNow: facts.filter((f) => f.kind === "why_now" || f.kind === "leader_statement"),
  company: facts.filter((f) => f.kind === "company"),
});

export const runOutreach = async (
  request: OutreachRequest,
  { appOrigin, onProgress, roles = [...EXEC_ROLES] }: RunOptions,
): Promise<OutreachResult> => {
  const startedAt = Date.now();
  const language: OutreachLanguage = request.language === "fi" ? "fi" : "en";
  const domain = normalizeDomain(request.domain);
  const origin = normalizeOrigin(domain) ?? `https://${domain}`;
  const log: ResearchLogEntry[] = [];
  let llmCalls = 0;

  const emit = (stage: OutreachProgressEvent["stage"], message: string) =>
    onProgress?.({ type: "progress", stage, message, at: Date.now() - startedAt });

  emit("start", `Researching ${domain}`);

  const baseContext: ResearchContext = {
    domain,
    origin,
    companyName: companyNameFromDomain(domain),
    entity: null,
  };

  // Website research and the legacy scrape run side by side.
  const websitePromise = runSource(websiteSource, baseContext);
  const scrape = await scrapeDomain(domain, 5000);
  emit("website", scrape.ok ? `Read ${scrape.pages.length} page(s) for the profile` : "Website unreachable — using fallback profile");

  const discovery = await runDiscoveryAgent(domain, scrape);

  const website = await websitePromise;
  log.push(...website.log);
  emit("website", website.log[0]?.note ?? "Website read");

  // Domain -> legal entity (operator override wins). Legal names printed on
  // the site ("© Example Oy") are the strongest hint, so they go first.
  const homeTitle = titleHead(scrape.pages[0]?.title ?? "");
  const legalNames = legalNamesFromText(
    website.pages.map((page) => page.text),
    domain,
  );
  const entity = await resolveEntity(
    domain,
    [...legalNames, discovery.data.companyName, homeTitle, baseContext.companyName],
    request.businessId,
  );
  log.push({
    source: "Trade register (PRH)",
    ok: entity.match.candidate !== null,
    durationMs: 0,
    note: entity.match.candidate
      ? `${entity.match.candidate.name} (${entity.match.candidate.businessId}) — ${entity.match.note}`
      : entity.match.note,
  });
  emit(
    "register",
    entity.match.candidate
      ? `Matched ${entity.match.candidate.name} (${entity.match.confidence} confidence)`
      : "No trade-register match — please pick the company",
  );

  const companyName = entity.match.candidate?.name ?? discovery.data.companyName;
  const context: ResearchContext = {
    ...baseContext,
    companyName,
    entity: entity.match.candidate,
  };

  // Job ads, the rest of the legacy pipeline and fact extraction in parallel.
  const jobsPromise = runSource(jobAdsSource, context);
  // Optional web search (only with TAVILY_API_KEY) feeds extra pages to extraction.
  const webPromise = runSource(tavilySource, context);
  const pipelinePromise = (async () => {
    const problem = await runProblemAgent(discovery.data);
    const solution = await runSolutionAgent(discovery.data, problem.data);
    const videoScript = await runVideoScriptAgent(discovery.data, problem.data, solution.data);
    return { problem, solution, videoScript };
  })();

  const web = await webPromise;
  log.push(...web.log);
  if (web.pages.length > 0) emit("website", web.log[0]?.note ?? "Web search done");

  const extractionPromise = extractFactsAndLeaders(companyName, [...website.pages, ...web.pages]);
  const jobs = await jobsPromise;
  log.push(...jobs.log);
  emit("jobs", jobs.log[0]?.note ?? "Job ads checked");

  const extraction = await extractionPromise;
  if (extraction.usedLlm) llmCalls += 1;
  log.push({ source: "Fact extraction", ok: extraction.usedLlm, durationMs: 0, note: extraction.note });
  emit("extract", extraction.note);

  const { problem, solution, videoScript } = await pipelinePromise;
  llmCalls += [discovery, problem, solution, videoScript].filter(
    (step) => step.meta.source !== "mock",
  ).length;
  emit("pipeline", "Bottleneck, fix and video script ready");

  // Deterministic facts (register, job ads) are verified like model facts.
  const deterministicTexts = new Map<string, string>(entity.sourceTexts);
  for (const page of jobs.pages) deterministicTexts.set(page.url, page.text);
  const deterministic = verifyFacts([...entity.facts, ...jobs.facts], deterministicTexts);

  const facts = dedupeFacts([...extraction.facts, ...deterministic.verified]);
  const rejectedFacts = extraction.rejected + deterministic.rejected.length;

  // Work addresses from the company's own site (never invented).
  const contacts = await assignLeaderEmails(extraction.leaders, website.pages, domain);
  const leaders = contacts.leaders;
  log.push(contacts.log);
  emit("extract", contacts.log.note);

  const ceo = leaders.find((leader) => leader.role === "CEO");
  const sufficiency = assessSufficiency(facts, Boolean(ceo?.name));

  // One estimate for every role, so CEO / COO / CFO see the same numbers.
  const estimate = buildCostEstimate(
    problem.data.impact.hoursLostPerWeek,
    parseHourlyCost(process.env.ASSUMED_HOURLY_COST_EUR),
    extraction.financials?.operatingProfitEur,
    language,
  );

  // Which emails to write: insufficient -> none; weak -> CEO only.
  const wanted: ExecRole[] = sufficiency === "insufficient" ? [] : sufficiency === "weak" ? ["CEO"] : roles;
  const ownEmailRoles = wanted.filter(
    (role) => role === "CEO" || leaders.some((l) => l.role === role && l.name),
  );
  // Every requested role without its own email folds into the CEO email
  // (leader not found, or only "weak" evidence).
  const roleRequests: RoleRequest[] = ownEmailRoles.map((role) => ({
    role,
    mergedRoles:
      role === "CEO"
        ? (["COO", "CFO"] as const).filter(
            (other) => roles.includes(other) && !ownEmailRoles.includes(other),
          )
        : [],
  }));

  const base = appOrigin.replace(/\/$/, "");
  const links: Partial<Record<ExecRole, RoleLinks>> = {};
  for (const { role } of roleRequests) {
    const token = newToken();
    links[role] = {
      token,
      videoUrl: `${base}/v/${encodeURIComponent(domain)}?r=${role.toLowerCase()}&t=${token}`,
      unsubscribeUrl: `${base}/unsubscribe?t=${token}`,
    };
  }

  let emails: OutreachResult["emails"] = [];
  if (roleRequests.length > 0) {
    emit("emails", `Writing ${roleRequests.map((r) => r.role).join(", ")} email(s)`);
    const written = await writeRoleEmails({
      companyName,
      language,
      leaders,
      facts: facts.filter((fact) => fact.kind !== "company"),
      estimate,
      problem: problem.data,
      solution: solution.data,
      roles: roleRequests,
      links,
      senderName: process.env.OUTREACH_SENDER_NAME?.trim() || "[Sender name], Velho",
      weak: sufficiency === "weak",
    });
    if (written.usedLlm) llmCalls += 1;
    // People who opted out earlier stay out, whatever channel they used.
    const store = getOutreachStore();
    emails = written.emails.map((email) =>
      email.recipient.email && store.isDoNotContact(email.recipient.email)
        ? { ...email, status: "opted_out" as const }
        : email,
    );
    log.push({ source: "Email writer", ok: written.usedLlm, durationMs: 0, note: written.note });
  } else {
    log.push({
      source: "Email writer",
      ok: false,
      durationMs: 0,
      note: "Not enough verified public information — no email written",
    });
  }

  const pipelineSources = {
    discovery: discovery.meta.source,
    problem: problem.meta.source,
    solution: solution.meta.source,
    videoScript: videoScript.meta.source,
  };

  const result: OutreachResult = {
    domain,
    createdAt: new Date().toISOString(),
    language,
    entity: entity.match,
    leaders,
    signals: { ...groupSignals(facts), financials: extraction.financials },
    facts,
    rejectedFacts,
    sufficiency,
    estimate,
    emails,
    companySocials: contacts.socials,
    pipeline: {
      discovery: discovery.data,
      problem: problem.data,
      solution: solution.data,
      videoScript: videoScript.data,
      sources: pipelineSources,
    },
    researchLog: log,
    llmCalls,
    usedFallback:
      Object.values(pipelineSources).some((source) => source !== "live") ||
      emails.some((email) => email.writtenBy === "template") ||
      !extraction.usedLlm,
    totalDurationMs: Date.now() - startedAt,
  };

  getOutreachStore().saveResult(result);
  emit("done", `Done in ${(result.totalDurationMs / 1000).toFixed(1)} s`);
  return result;
};
