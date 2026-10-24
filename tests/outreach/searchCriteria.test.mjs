// Unit tests for criteria-search filters, exclusions and scoring.
// Run from the repo root with:  node --test tests/outreach/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ageInYears,
  applyExclusions,
  codeMatches,
  expandIndustries,
  expandTowns,
  registrationDateEnd,
} from "../../lib/outreach/pure/searchFilters.ts";
import { compareScored, scoreCompany } from "../../lib/outreach/pure/searchScore.ts";
import { toCompanySummary } from "../../lib/outreach/pure/searchPrh.ts";

const NOW = new Date("2026-10-24T12:00:00Z");

const company = (overrides = {}) => ({
  businessId: "1234567-8",
  name: "Esimerkki Logistiikka Oy",
  previousNames: [],
  renamedOn: null,
  city: "Vantaa",
  businessLineCode: "49410",
  businessLine: "Freight transport by road",
  registeredSince: "2001-05-02",
  registeredBefore1978: false,
  website: null,
  companyForm: "Limited company",
  status: "active",
  sourceUrl: "https://tietopalvelu.ytj.fi/yritys/1234567-8",
  ...overrides,
});

test("expandIndustries merges groups and raw codes without duplicates", () => {
  const codes = expandIndustries(["logistics", "52100", "4669", "abc"]);
  assert.deepEqual(codes, ["49410", "52100", "52291", "53200", "4669"]);
});

test("expandTowns keeps region order and adds typed towns once", () => {
  const towns = expandTowns("paijat-hame", ["Lahti", "Mikkeli"]);
  assert.deepEqual(towns, ["Lahti", "Hollola", "Orimattila", "Heinola", "Mikkeli"]);
  assert.deepEqual(expandTowns(undefined, ["  Oulu "]), ["Oulu"]);
});

test("codeMatches is a prefix match (the API matches substrings)", () => {
  assert.equal(codeMatches("52100", ["5210"]), true);
  assert.equal(codeMatches("25210", ["5210"]), false);
  assert.equal(codeMatches(null, ["5210"]), false);
});

test("registrationDateEnd and ageInYears", () => {
  assert.equal(registrationDateEnd(10, NOW), "2016-10-24");
  assert.equal(ageInYears(company(), NOW), 25);
  assert.equal(ageInYears(company({ registeredSince: null }), NOW), null);
});

test("applyExclusions removes non-prospects and counts the reasons", () => {
  const { kept, excluded } = applyExclusions([
    company(),
    company({ businessId: "a", name: "Asunto Oy Puistola 3", businessLineCode: "68201" }),
    company({ businessId: "b", name: "Kiinteistö Oy Teollisuustie 4" }),
    company({ businessId: "c", status: "ended" }),
    company({ businessId: "d", status: "liquidation" }),
    company({ businessId: "e", name: "Kuljetusyrittäjät ry" }),
  ]);
  assert.deepEqual(kept.map((c) => c.businessId), ["1234567-8"]);
  assert.deepEqual(
    Object.fromEntries(excluded.map((e) => [e.id, e.count])),
    { housing: 2, dissolved: 1, insolvent: 1, non_profit: 1 },
  );
});

test("scoreCompany is explained, bounded and deterministic", () => {
  const first = scoreCompany(company(), { ageYears: 25, now: NOW });
  const second = scoreCompany(company(), { ageYears: 25, now: NOW });
  assert.deepEqual(first, second);
  assert.equal(first.score, 30 + 15 + 10);
  assert.ok(first.reasons.every((r) => typeof r.reason === "string" && r.reason.length > 0));

  const old = scoreCompany(company({ registeredBefore1978: true, registeredSince: "1978-03-15" }), {
    ageYears: 48,
    now: NOW,
  });
  assert.ok(old.reasons.some((r) => r.reason === "Registered before 1978"));

  const renamed = scoreCompany(
    company({ previousNames: ["Pölkky Oy"], renamedOn: "2026-06-01" }),
    { ageYears: 25, now: NOW },
  );
  assert.ok(renamed.reasons.some((r) => r.reason.includes("formerly Pölkky Oy")));
});

test("enrichment adds hiring, website and size points; score stays within 0–100", () => {
  const hiringFact = { id: "h", kind: "hiring", text: "", quote: "Varastotyöntekijä", quoteLang: "fi", sourceUrl: "", retrievedAt: "" };
  const rich = scoreCompany(company(), {
    ageYears: 25,
    now: NOW,
    enrichment: {
      status: "done",
      domain: { businessId: "x", domain: "esimerkki.fi", method: "verified_guess", evidence: "", checks: [], durationMs: 1 },
      hiring: [hiringFact],
      manualHiring: [hiringFact],
      size: { employees: 80, fact: hiringFact },
    },
  });
  assert.equal(rich.score, 100);
  const none = scoreCompany(company({ companyForm: null }), {
    ageYears: 11,
    now: NOW,
    enrichment: { status: "done", domain: null, hiring: [], manualHiring: [], size: null },
  });
  assert.equal(none.score, 30 + 10 - 20);
});

test("compareScored orders by score, then age, then name", () => {
  const rows = [
    { score: 50, ageYears: 10, company: company({ name: "B Oy" }) },
    { score: 70, ageYears: 5, company: company({ name: "C Oy" }) },
    { score: 50, ageYears: 30, company: company({ name: "A Oy" }) },
  ].sort(compareScored);
  assert.deepEqual(rows.map((r) => r.company.name), ["C Oy", "A Oy", "B Oy"]);
});

test("toCompanySummary parses a PRH record, including renames and unknown city", () => {
  const summary = toCompanySummary({
    businessId: { value: "0186388-7", registrationDate: "1978-03-15" },
    names: [
      { name: "Pfeifer Nordics Oy", type: "1", registrationDate: "2026-06-01" },
      { name: "Pölkky Oy", type: "1", registrationDate: "1990-01-01", endDate: "2026-05-31" },
    ],
    mainBusinessLine: { type: "16100", descriptions: [{ languageCode: "3", description: "Sawmilling" }] },
    companyForms: [{ type: "16", descriptions: [{ languageCode: "3", description: "Limited company" }] }],
    addresses: [{ type: 1, postOffices: [{ city: "OSOITE TUNTEMATON", languageCode: "1" }] }],
  });
  assert.equal(summary.name, "Pfeifer Nordics Oy");
  assert.deepEqual(summary.previousNames, ["Pölkky Oy"]);
  assert.equal(summary.renamedOn, "2026-06-01");
  assert.equal(summary.registeredBefore1978, true);
  assert.equal(summary.city, null);
  assert.equal(summary.status, "active");
});
