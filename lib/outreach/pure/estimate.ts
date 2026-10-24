/**
 * EUR cost estimate. Every figure here is an estimate and carries its formula,
 * so an executive can see exactly how it was produced. Pure module.
 */

import type { CostEstimate, OutreachLanguage } from "@/types/outreach";

export const DEFAULT_HOURLY_COST_EUR = 40;

/** 52 weeks / 12 months. */
const WEEKS_PER_MONTH = 52 / 12;

export const parseHourlyCost = (raw: string | undefined): number => {
  const value = Number.parseFloat(raw ?? "");
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_HOURLY_COST_EUR;
};

export const formatEur = (amount: number, language: OutreachLanguage = "en"): string =>
  new Intl.NumberFormat(language === "fi" ? "fi-FI" : "en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Math.round(amount));

export const buildCostEstimate = (
  hoursPerWeek: number,
  hourlyCostEur: number,
  operatingProfitEur?: number,
  language: OutreachLanguage = "en",
): CostEstimate => {
  const safeHours = Number.isFinite(hoursPerWeek) && hoursPerWeek > 0 ? hoursPerWeek : 0;
  const hoursPerMonth = Math.round(safeHours * WEEKS_PER_MONTH);
  const eurPerMonth = hoursPerMonth * hourlyCostEur;

  const shareOfOperatingProfitPct =
    operatingProfitEur !== undefined && operatingProfitEur > 0 && eurPerMonth > 0
      ? Math.round(((eurPerMonth * 12) / operatingProfitEur) * 1000) / 10
      : null;

  const formula =
    language === "fi"
      ? `≈${hoursPerMonth} h/kk × ${formatEur(hourlyCostEur, language)}/h (oletus) ≈ ${formatEur(eurPerMonth, language)}/kk`
      : `≈${hoursPerMonth} h/month × ${formatEur(hourlyCostEur, language)}/h (assumption) ≈ ${formatEur(eurPerMonth, language)}/month`;

  return {
    estimate: true,
    hoursPerWeek: safeHours,
    hoursPerMonth,
    hourlyCostEur,
    eurPerMonth,
    formula,
    shareOfOperatingProfitPct,
  };
};
