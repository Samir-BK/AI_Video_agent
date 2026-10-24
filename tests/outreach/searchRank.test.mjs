// Unit tests for name-suggestion ranking.
// Run from the repo root with:  node --test tests/outreach/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { compareSuggestions, prominenceScore } from "../../lib/outreach/pure/searchRank.ts";

const company = (name, matchScore, extra = {}) => ({
  businessId: name,
  name,
  previousNames: [],
  renamedOn: null,
  city: null,
  businessLineCode: null,
  businessLine: null,
  registeredSince: null,
  registeredBefore1978: false,
  website: null,
  companyForm: "Limited company",
  status: "active",
  sourceUrl: "",
  matchScore,
  ...extra,
});

// Real register data for the query "fazer" (PRH, October 2026).
const FAZER = [
  company("Fazer Konserttitoimisto Oy", 80, { businessLineCode: "90209", registeredSince: "1991-02-21", website: "www.fazerartists.fi" }),
  company("Fazer Finland Oy", 80, { businessLineCode: "10610", registeredSince: "2017-09-25" }),
  company("Fazer Makeiset Oy", 80, { businessLineCode: "10820", registeredSince: "1989-01-30" }),
  company("Lakiasiaintoimisto Pia Fazer Oy", 60, { businessLineCode: "69102", registeredSince: "2017-03-26" }),
  company("Oy Karl Fazer Ab", 60, { businessLineCode: "70100", registeredSince: "1978-06-30" }),
  company("Fazer Invest Oy", 80, { businessLineCode: "64990", registeredSince: "2011-11-21", status: "ended" }),
];

test("the group head office ranks first for a brand query", () => {
  const sorted = [...FAZER].sort(compareSuggestions).map((c) => c.name);
  assert.equal(sorted[0], "Oy Karl Fazer Ab");
  assert.equal(sorted.at(-1), "Fazer Invest Oy");
  assert.ok(sorted.indexOf("Fazer Konserttitoimisto Oy") > sorted.indexOf("Fazer Makeiset Oy"));
});

test("personal service firms are penalised", () => {
  assert.ok(prominenceScore(FAZER[3]) < 0);
  assert.ok(prominenceScore(FAZER[0]) < prominenceScore(FAZER[2]));
});

test("an exact name match still wins over prominence", () => {
  const exact = company("Berner Oy", 100, { businessLineCode: "46900", registeredSince: "1990-01-01" });
  const parent = company("Christian Berner Oy", 60, { businessLineCode: "70100", registeredSince: "1970-01-01" });
  assert.equal([parent, exact].sort(compareSuggestions)[0].name, "Berner Oy");
});
