// Unit tests for LinkedIn search links and profile suggestions.
// Run from the repo root with:  node --test tests/outreach/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  displayCompanyName,
  linkedinSearchUrl,
  normalizeProfileUrl,
  pickLinkedinProfile,
} from "../../lib/outreach/pure/linkedin.ts";

test("displayCompanyName drops legal forms", () => {
  assert.equal(displayCompanyName("Lassila & Tikanoja Oyj"), "Lassila & Tikanoja");
  assert.equal(displayCompanyName("Oy Karl Fazer Ab"), "Karl Fazer");
});

test("linkedinSearchUrl builds a people search for name and company", () => {
  assert.equal(
    linkedinSearchUrl("Arttu Lindroos", "Lassila & Tikanoja Oyj"),
    "https://www.linkedin.com/search/results/people/?keywords=Arttu%20Lindroos%20Lassila%20%26%20Tikanoja",
  );
});

test("normalizeProfileUrl keeps only /in/ profiles", () => {
  assert.equal(
    normalizeProfileUrl("https://fi.linkedin.com/in/eero-hautaniemi-123/?trk=x"),
    "https://www.linkedin.com/in/eero-hautaniemi-123",
  );
  assert.equal(normalizeProfileUrl("https://www.linkedin.com/company/fazer"), null);
  assert.equal(normalizeProfileUrl("https://example.com/in/eero"), null);
  assert.equal(normalizeProfileUrl("not a url"), null);
});

const HITS = [
  { url: "https://www.linkedin.com/company/lassila-&-tikanoja", title: "Lassila & Tikanoja | LinkedIn", content: "" },
  { url: "https://fi.linkedin.com/in/eero-other", title: "Eero Hautaniemi - Acme Oy | LinkedIn", content: "Sales at Acme" },
  { url: "https://fi.linkedin.com/in/eero-h", title: "Eero Hautaniemi – Toimitusjohtaja – Lassila & Tikanoja Oyj | LinkedIn", content: "" },
];

test("pickLinkedinProfile needs the full name and the company", () => {
  assert.equal(
    pickLinkedinProfile(HITS, "Eero Hautaniemi", ["Lassila & Tikanoja Oyj", "lt"]),
    "https://www.linkedin.com/in/eero-h",
  );
  // Company only in the snippet is enough; accents fold ("Skärström").
  assert.equal(
    pickLinkedinProfile(
      [{ url: "https://linkedin.com/in/edward-s", title: "Edward Skarstrom | LinkedIn", content: "CIO at Lassila & Tikanoja" }],
      "Edward Skärström",
      ["Lassila & Tikanoja Oyj"],
    ),
    "https://www.linkedin.com/in/edward-s",
  );
  assert.equal(pickLinkedinProfile(HITS, "Eero Hautaniemi", ["Berner Oy"]), null);
  assert.equal(pickLinkedinProfile(HITS, "Eero", ["Lassila & Tikanoja Oyj"]), null);
  assert.equal(pickLinkedinProfile(HITS, "Eero Hautaniemi", ["lt"]), null);
});
