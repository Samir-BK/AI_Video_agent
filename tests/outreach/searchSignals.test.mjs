// Unit tests for prospect signals (manual-work roles, employee counts).
// Run from the repo root with:  node --test tests/outreach/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { extractEmployeeCount, isManualWorkRole } from "../../lib/outreach/pure/searchSignals.ts";
import { scoreCompany } from "../../lib/outreach/pure/searchScore.ts";

test("isManualWorkRole spots admin-heavy roles in Finnish and English", () => {
  assert.equal(isManualWorkRole("Vientikoordinaattori Keslalle - Joensuu"), true);
  assert.equal(isManualWorkRole("Asiakaspalvelija, tilauskäsittely"), true);
  assert.equal(isManualWorkRole("Customer Service Specialist"), true);
  assert.equal(isManualWorkRole("Laskuttaja (määräaikainen)"), true);
  assert.equal(isManualWorkRole("Yhdistelmäautonkuljettaja"), false);
  assert.equal(isManualWorkRole("Senior Software Engineer"), false);
});

test("extractEmployeeCount reads Finnish and English statements", () => {
  assert.deepEqual(extractEmployeeCount("Työllistämme yli 200 ammattilaista Suomessa."), {
    employees: 200,
    quote: "yli 200 ammattilaista",
  });
  assert.equal(extractEmployeeCount("Konsernissa on noin 1 200 työntekijää.")?.employees, 1200);
  assert.equal(extractEmployeeCount("Henkilöstö: 85")?.employees, 85);
  assert.equal(extractEmployeeCount("We are over 150 employees in 4 countries")?.employees, 150);
});

test("extractEmployeeCount rejects years, money and nonsense", () => {
  assert.equal(extractEmployeeCount("Founded in 1985, people trust us"), null);
  assert.equal(extractEmployeeCount("Liikevaihto 52 M€ ja 5 %"), null);
  assert.equal(extractEmployeeCount("1 henkilö"), null);
  assert.equal(extractEmployeeCount("No numbers here"), null);
});

test("manual-work hiring scores higher than other hiring", () => {
  const now = new Date("2026-10-24T12:00:00Z");
  const company = {
    businessId: "x", name: "X Oy", previousNames: [], renamedOn: null, city: null,
    businessLineCode: "49410", businessLine: null, registeredSince: "2000-01-01",
    registeredBefore1978: false, website: null, companyForm: null, status: "active", sourceUrl: "",
  };
  const fact = (quote) => ({ id: quote, kind: "hiring", text: quote, quote, quoteLang: "fi", sourceUrl: "", retrievedAt: "" });
  const base = { status: "done", domain: null, size: null };
  const manual = scoreCompany(company, {
    ageYears: 26, now, enrichment: { ...base, hiring: [fact("Laskuttaja")], manualHiring: [fact("Laskuttaja")] },
  });
  const other = scoreCompany(company, {
    ageYears: 26, now, enrichment: { ...base, hiring: [fact("Kuljettaja")], manualHiring: [] },
  });
  assert.equal(manual.score - other.score, 20);
  assert.ok(manual.reasons.some((r) => r.reason.startsWith("Hiring for manual work: Laskuttaja")));
});
