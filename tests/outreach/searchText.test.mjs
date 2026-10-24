// Unit tests for company-search text helpers.
// Run from the repo root with:  node --test tests/outreach/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  containsFolded,
  coreName,
  domainGuesses,
  foldText,
  hostFromWebsite,
  nameMatchScore,
} from "../../lib/outreach/pure/searchText.ts";

test("foldText removes accents and punctuation", () => {
  assert.equal(foldText("Würth Oy"), "wurth oy");
  assert.equal(foldText("  Hämeen   Kuljetus-Palvelu Oy! "), "hameen kuljetus palvelu oy");
  assert.equal(foldText("Lassila & Tikanoja Oyj"), "lassila & tikanoja oyj");
});

test("coreName drops legal forms", () => {
  assert.equal(coreName("Berner Oy"), "berner");
  assert.equal(coreName("Tamtron Group Oyj"), "tamtron group");
});

test("nameMatchScore ranks exact > prefix > words > partial", () => {
  assert.equal(nameMatchScore("berner", "Berner Oy"), 100);
  assert.equal(nameMatchScore("berner", "Berner Logistics Oy"), 80);
  assert.equal(nameMatchScore("tikanoja lassila", "Lassila & Tikanoja Oyj"), 60);
  assert.equal(nameMatchScore("berner", "Christian Berner Oy"), 60);
  assert.equal(nameMatchScore("bern", "Christian Berner Oy"), 30);
  assert.equal(nameMatchScore("berner", "Valio Oy"), 0);
});

test("nameMatchScore counts previous names slightly lower", () => {
  assert.equal(nameMatchScore("polkky", "Pfeifer Nordics Oy", ["Pölkky Oy"]), 90);
});

test("containsFolded matches whole words only", () => {
  assert.equal(containsFolded("© 2026 Berner Oy. All rights reserved.", "Berner Oy"), true);
  assert.equal(containsFolded("Bernerson Oyster bar", "Berner Oy"), false);
  assert.equal(containsFolded("Y-tunnus 0107011-5", "0107011-5"), true);
});

test("hostFromWebsite normalises registered websites", () => {
  assert.equal(hostFromWebsite("www.Tamtron.fi"), "tamtron.fi");
  assert.equal(hostFromWebsite("https://www.lt.fi/en/"), "lt.fi");
  assert.equal(hostFromWebsite("not a url"), null);
  assert.equal(hostFromWebsite(""), null);
});

test("domainGuesses builds ordered .fi/.com candidates", () => {
  assert.deepEqual(domainGuesses("Berner Oy"), ["berner.fi", "berner.com"]);
  assert.deepEqual(domainGuesses("Lassila & Tikanoja Oyj").slice(0, 4), [
    "lassilatikanoja.fi",
    "lassilatikanoja.com",
    "lassila-tikanoja.fi",
    "lassila-tikanoja.com",
  ]);
  assert.ok(domainGuesses("Würth Oy").includes("wurth.fi"));
  assert.ok(domainGuesses("Tamtron Group Oyj").includes("tamtron.fi"));
  assert.ok(domainGuesses("A Very Long Company Name Group Oy").length <= 8);
  // Brand domain without the founder's first name: Oy Karl Fazer Ab -> fazer.com.
  assert.ok(domainGuesses("Oy Karl Fazer Ab").includes("fazer.com"));
});

test("queryFallbacks proposes accent variants and the longest word", async () => {
  const { queryFallbacks } = await import("../../lib/outreach/pure/searchText.ts");
  assert.deepEqual(queryFallbacks("wurth"), ["würth"]);
  assert.equal(queryFallbacks("lassila tikanoja")[0], "tikanoja");
  assert.ok(queryFallbacks("polkky").includes("pölkky"));
  assert.equal(queryFallbacks("xyz").length, 0);
});

test("filterHistory matches partially, ignores accents, filters and sorts", async () => {
  const { filterHistory } = await import("../../lib/outreach/pure/searchText.ts");
  const row = (domain, companyName, createdAt, totalViews, statuses) => ({
    domain, companyName, businessId: null, createdAt, totalViews,
    emails: statuses.map((status) => ({ status, recipient: null })),
  });
  const rows = [
    row("berner.fi", "Berner Oy", "2026-10-24T10:00:00Z", 1, ["draft"]),
    row("wurth.fi", "Würth Oy", "2026-10-24T12:00:00Z", 5, ["opted_out"]),
    row("kesla.com", "Kesla Oyj", "2026-10-24T11:00:00Z", 0, ["no_address"]),
  ];
  assert.deepEqual(filterHistory(rows, { q: "wurth" }).map((r) => r.domain), ["wurth.fi"]);
  assert.deepEqual(filterHistory(rows, { q: "BERN" }).map((r) => r.domain), ["berner.fi"]);
  assert.deepEqual(filterHistory(rows, {}).map((r) => r.domain), ["wurth.fi", "kesla.com", "berner.fi"]);
  assert.deepEqual(filterHistory(rows, { sort: "views" }).map((r) => r.totalViews), [5, 1, 0]);
  assert.deepEqual(filterHistory(rows, { status: "opted_out" }).map((r) => r.domain), ["wurth.fi"]);
  assert.deepEqual(filterHistory(rows, { minViews: 1 }).length, 2);
});
