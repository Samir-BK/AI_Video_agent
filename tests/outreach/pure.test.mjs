// Unit tests for the pure outreach helpers.
// Run from the repo root with:  node --test tests/outreach/*.test.mjs
// (Node 22.6+ strips TypeScript types natively; no extra dependencies.)

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  dedupeFacts,
  normalizeForMatch,
  quoteAppearsIn,
  verifyFacts,
} from "../../lib/outreach/pure/verify.ts";
import { mapTitleToRole } from "../../lib/outreach/pure/roles.ts";
import { assessSufficiency } from "../../lib/outreach/pure/sufficiency.ts";
import { buildCostEstimate, parseHourlyCost } from "../../lib/outreach/pure/estimate.ts";

const fact = (overrides = {}) => ({
  id: "f1",
  kind: "strategy_goal",
  text: "Revenue target of 100 MEUR by 2030",
  quote: "liikevaihtotavoite 100 miljoonaa euroa vuoteen 2030 mennessä",
  quoteLang: "fi",
  sourceUrl: "https://example.fi/sijoittajat",
  retrievedAt: "2026-10-24T12:00:00.000Z",
  ...overrides,
});

test("normalizeForMatch handles NFC, case, whitespace and typographic marks", () => {
  const decomposed = "Hyvä   PÄIVÄ “moi” – ok";
  assert.equal(normalizeForMatch(decomposed), 'hyvä päivä "moi" - ok');
});

test("quoteAppearsIn finds Finnish quotes across line breaks and case", () => {
  const page = "Strategia\n\nYhtiön   LIIKEVAIHTOTAVOITE 100 miljoonaa euroa\nvuoteen 2030 mennessä.";
  assert.equal(quoteAppearsIn(fact().quote, page), true);
});

test("quoteAppearsIn rejects short or absent quotes", () => {
  assert.equal(quoteAppearsIn("2030", "vuoteen 2030"), false);
  assert.equal(quoteAppearsIn("kasvu 50 prosenttia vuodessa", "kasvu 5 prosenttia"), false);
});

test("quoteAppearsIn tolerates surrounding quote marks and ellipses", () => {
  assert.equal(quoteAppearsIn("“liikevaihtotavoite 100 miljoonaa euroa…”", "Liikevaihtotavoite 100 miljoonaa euroa"), true);
});

test("verifyFacts keeps verified facts, relocates mis-cited ones, rejects the rest", () => {
  const texts = new Map([
    ["https://example.fi/sijoittajat", "Muuta tekstiä."],
    ["https://example.fi/strategia", "Liikevaihtotavoite 100 miljoonaa euroa vuoteen 2030 mennessä."],
  ]);
  const invented = fact({ id: "f2", quote: "we will triple exports next year" });
  const { verified, rejected } = verifyFacts([fact(), invented], texts);
  assert.equal(verified.length, 1);
  assert.equal(verified[0].sourceUrl, "https://example.fi/strategia");
  assert.deepEqual(rejected.map((f) => f.id), ["f2"]);
});

test("dedupeFacts drops repeated quotes", () => {
  assert.equal(dedupeFacts([fact(), fact({ id: "dup" })]).length, 1);
});

test("mapTitleToRole maps English, Finnish and operations titles", () => {
  assert.equal(mapTitleToRole("Toimitusjohtaja"), "CEO");
  assert.equal(mapTitleToRole("President and CEO"), "CEO");
  assert.equal(mapTitleToRole("talousjohtaja"), "CFO");
  assert.equal(mapTitleToRole("Chief Financial Officer"), "CFO");
  assert.equal(mapTitleToRole("SVP Operations"), "COO");
  assert.equal(mapTitleToRole("Logistiikkajohtaja"), "COO");
  assert.equal(mapTitleToRole("Chief Operating Officer"), "COO");
});

test("mapTitleToRole maps IT, sales, HR and service titles", () => {
  assert.equal(mapTitleToRole("CIO"), "CTO");
  assert.equal(mapTitleToRole("Tietohallintojohtaja"), "CTO");
  assert.equal(mapTitleToRole("IT-johtaja"), "CTO");
  assert.equal(mapTitleToRole("Chief Digital Officer"), "CTO");
  assert.equal(mapTitleToRole("Myyntijohtaja"), "SALES");
  assert.equal(mapTitleToRole("Kaupallinen johtaja"), "SALES");
  assert.equal(mapTitleToRole("Chief Commercial Officer"), "SALES");
  assert.equal(mapTitleToRole("Henkilöstöjohtaja"), "HR");
  assert.equal(mapTitleToRole("HR Director"), "HR");
  assert.equal(mapTitleToRole("Asiakaspalvelujohtaja"), "SERVICE");
  assert.equal(mapTitleToRole("Hankintajohtaja"), "SERVICE");
  assert.equal(mapTitleToRole("Toimitusketjujohtaja"), "SERVICE");
  assert.equal(mapTitleToRole("Supply Chain Director"), "SERVICE");
  // Specific functions win over the generic "operations" and "CEO".
  assert.equal(mapTitleToRole("CFO, deputy to the CEO"), "CFO");
  assert.equal(mapTitleToRole("Director, Sales Operations"), "SALES");
});

test("mapTitleToRole ignores deputies and unrelated titles", () => {
  assert.equal(mapTitleToRole("Varatoimitusjohtaja"), null);
  assert.equal(mapTitleToRole("Deputy CEO"), null);
  assert.equal(mapTitleToRole("Marketing Manager"), null);
  assert.equal(mapTitleToRole(""), null);
});

test("assessSufficiency follows ready / weak / insufficient rules", () => {
  const goal = fact();
  const hiring = fact({ id: "h", kind: "hiring", quote: "Order coordinator wanted" });
  const company = fact({ id: "c", kind: "company", quote: "registered 1992-09-10" });
  assert.equal(assessSufficiency([goal, hiring], true), "ready");
  assert.equal(assessSufficiency([goal, hiring], false), "weak");
  assert.equal(assessSufficiency([goal], true), "weak");
  assert.equal(assessSufficiency([company, company], true), "insufficient");
  assert.equal(assessSufficiency([], true), "insufficient");
});

test("buildCostEstimate computes monthly EUR with a visible formula", () => {
  const estimate = buildCostEstimate(30, 40, 2_000_000);
  assert.equal(estimate.estimate, true);
  assert.equal(estimate.hoursPerMonth, 130);
  assert.equal(estimate.eurPerMonth, 5200);
  assert.match(estimate.formula, /130 h\/month/);
  assert.match(estimate.formula, /assumption/);
  assert.equal(estimate.shareOfOperatingProfitPct, 3.1);
});

test("buildCostEstimate handles missing profit and bad input", () => {
  assert.equal(buildCostEstimate(10, 40).shareOfOperatingProfitPct, null);
  assert.equal(buildCostEstimate(Number.NaN, 40).eurPerMonth, 0);
  assert.equal(parseHourlyCost("abc"), 40);
  assert.equal(parseHourlyCost("55"), 55);
});
