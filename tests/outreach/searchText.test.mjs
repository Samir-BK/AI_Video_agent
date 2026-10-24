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
  assert.ok(domainGuesses("A Very Long Company Name Group Oy").length <= 6);
});

test("queryFallbacks proposes accent variants and the longest word", async () => {
  const { queryFallbacks } = await import("../../lib/outreach/pure/searchText.ts");
  assert.deepEqual(queryFallbacks("wurth"), ["würth"]);
  assert.equal(queryFallbacks("lassila tikanoja")[0], "tikanoja");
  assert.ok(queryFallbacks("polkky").includes("pölkky"));
  assert.equal(queryFallbacks("xyz").length, 0);
});
