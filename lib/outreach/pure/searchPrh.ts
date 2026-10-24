/**
 * Parse PRH / YTJ open-data company records into search summaries.
 * Pure module (type-only imports) so it runs under `node --test`.
 *
 * Observed API behaviour this relies on (probed 24 Oct 2026):
 * - official names have type "1"; the current one has no endDate,
 * - dissolved companies carry a top-level endDate (and often no current name),
 * - companySituations lists liquidation / bankruptcy entries,
 * - companies registered before the electronic register share 1978-03-15.
 */

import type { CompanyStatus, CompanySummary } from "@/types/outreach";

export const REGISTER_START_DATE = "1978-03-15";

export const ytjPageUrl = (businessId: string): string =>
  `https://tietopalvelu.ytj.fi/yritys/${encodeURIComponent(businessId)}`;

interface PrhName {
  name?: string;
  type?: string;
  registrationDate?: string;
  endDate?: string;
}

interface PrhDescription {
  languageCode?: string;
  description?: string;
}

interface PrhAddress {
  type?: number;
  postOffices?: { city?: string; languageCode?: string }[];
}

export interface PrhCompanyRecord {
  businessId?: { value?: string; registrationDate?: string };
  names?: PrhName[];
  website?: { url?: string } | null;
  mainBusinessLine?: { type?: string; descriptions?: PrhDescription[] } | null;
  companyForms?: { type?: string; descriptions?: PrhDescription[] }[];
  companySituations?: { type?: string }[];
  addresses?: PrhAddress[];
  endDate?: string | null;
}

const describe = (descriptions: PrhDescription[] | undefined): string | null => {
  const english = descriptions?.find((d) => d.languageCode === "3")?.description;
  const finnish = descriptions?.find((d) => d.languageCode === "1")?.description;
  return english ?? finnish ?? null;
};

const titleCaseCity = (city: string): string =>
  city.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());

export const statusOf = (record: PrhCompanyRecord): CompanyStatus => {
  if (record.endDate) return "ended";
  const situations = (record.companySituations ?? []).map((s) => (s.type ?? "").toUpperCase());
  if (situations.some((s) => s.includes("KONK"))) return "bankruptcy";
  if (situations.some((s) => s.includes("SEL"))) return "liquidation";
  return "active";
};

export const toCompanySummary = (record: PrhCompanyRecord): CompanySummary | null => {
  const businessId = record.businessId?.value;
  if (!businessId) return null;

  const official = (record.names ?? []).filter((n) => n.type === "1" && n.name);
  const sorted = [...official].sort((a, b) =>
    (b.registrationDate ?? "").localeCompare(a.registrationDate ?? ""),
  );
  const current = official.find((n) => !n.endDate) ?? sorted[0];
  if (!current?.name) return null;

  const previousNames = sorted
    .filter((n) => n !== current && n.name)
    .map((n) => n.name as string);

  // Prefer the street address (type 1), Finnish city name (languageCode "1").
  const address =
    record.addresses?.find((a) => a.type === 1) ?? record.addresses?.[0];
  const city =
    address?.postOffices?.find((p) => p.languageCode === "1")?.city ??
    address?.postOffices?.[0]?.city ??
    null;

  const registeredSince = record.businessId?.registrationDate ?? null;
  // "Osoite tuntematon" / "Adress okänd" = address unknown, not a city.
  const knownCity = city && !/^(osoite tuntematon|adress okänd)$/i.test(city.trim()) ? city : null;

  return {
    businessId,
    name: current.name,
    previousNames,
    renamedOn: previousNames.length > 0 ? (current.registrationDate ?? null) : null,
    city: knownCity ? titleCaseCity(knownCity) : null,
    businessLineCode: record.mainBusinessLine?.type ?? null,
    businessLine: describe(record.mainBusinessLine?.descriptions),
    registeredSince,
    registeredBefore1978: registeredSince === REGISTER_START_DATE,
    website: record.website?.url?.trim() || null,
    companyForm: describe(record.companyForms?.[0]?.descriptions),
    status: statusOf(record),
    sourceUrl: ytjPageUrl(businessId),
  };
};
