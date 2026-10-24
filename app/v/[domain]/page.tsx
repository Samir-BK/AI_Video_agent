import type { Metadata } from "next";

import VideoLanding from "@/app/v/[domain]/VideoLanding";
import { buildBookingUrl } from "@/lib/booking";
import { buildMockPipelineOutputs, companyNameFromDomain, normalizeDomain } from "@/lib/mockData";
import { buildCostEstimate, parseHourlyCost } from "@/lib/outreach/pure/estimate";
import { getOutreachStore } from "@/lib/outreach/store";
import type { ExecRole } from "@/types/outreach";
import { EXEC_ROLES } from "@/types/outreach";

/**
 * Personal video page: /v/<domain>?r=<role>&t=<token>
 *
 * This is the link every outreach email points to (it used to 404). It shows
 * the company's own video, the numbers for the reader's role with sources,
 * and a single booking button. A valid token records a view. If no research
 * is stored for the domain, a clearly labelled preview is shown instead of an
 * error.
 */

export const dynamic = "force-dynamic";

interface PageProps {
  params: { domain: string };
  searchParams: Record<string, string | string[] | undefined>;
}

// Every role with an email can have a video link (?r=cto, ?r=sales, ...).
const ROLES: readonly ExecRole[] = EXEC_ROLES;

const parseRole = (value: string | string[] | undefined): ExecRole | null => {
  const upper = typeof value === "string" ? value.toUpperCase() : "";
  return ROLES.find((role) => role === upper) ?? null;
};

export const generateMetadata = ({ params }: PageProps): Metadata => {
  const domain = normalizeDomain(decodeURIComponent(params.domain));
  const stored = getOutreachStore().getResult(domain);
  const name = stored?.entity.candidate?.name ?? companyNameFromDomain(domain);
  return {
    title: `A 45-second video for ${name} — Velho`,
    robots: { index: false, follow: false },
  };
};

export default function VideoPage({ params, searchParams }: PageProps) {
  const domain = normalizeDomain(decodeURIComponent(params.domain));
  const store = getOutreachStore();
  const result = store.getResult(domain);

  const token = typeof searchParams.t === "string" ? searchParams.t : null;
  const record = token ? store.resolveToken(token) : null;
  const tokenValid = record !== null && record.domain === domain;
  if (tokenValid && token) store.recordView(token);

  const role: ExecRole = (tokenValid ? record.role : null) ?? parseRole(searchParams.r) ?? "CEO";

  if (!result) {
    const mock = buildMockPipelineOutputs(domain);
    const companyName = companyNameFromDomain(domain);
    return (
      <VideoLanding
        role={role}
        language={searchParams.lang === "fi" ? "fi" : "en"}
        companyName={companyName}
        discovery={mock.discovery}
        problem={mock.problem}
        solution={mock.solution}
        videoScript={mock.videoScript}
        estimate={buildCostEstimate(
          mock.problem.impact.hoursLostPerWeek,
          parseHourlyCost(process.env.ASSUMED_HOURLY_COST_EUR),
        )}
        facts={[]}
        bookingUrl={buildBookingUrl(companyName, domain)}
        isPreview
      />
    );
  }

  const companyName = result.entity.candidate?.name ?? result.pipeline.discovery.companyName;
  return (
    <VideoLanding
      role={role}
      language={result.language}
      companyName={companyName}
      discovery={result.pipeline.discovery}
      problem={result.pipeline.problem}
      solution={result.pipeline.solution}
      videoScript={result.pipeline.videoScript}
      estimate={result.estimate}
      facts={result.facts.filter((fact) => fact.kind !== "company")}
      bookingUrl={buildBookingUrl(companyName, domain)}
      isPreview={false}
    />
  );
}
