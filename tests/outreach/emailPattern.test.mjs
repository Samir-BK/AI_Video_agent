// Unit tests for leader email resolution.
// Run from the repo root with:  node --test tests/outreach/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  asciiNamePart,
  buildLocalPart,
  detectPattern,
  personalAddresses,
  resolveLeaderEmail,
} from "../../lib/outreach/pure/emailPattern.ts";

const mxYes = () => true;
const mxNo = () => false;

test("asciiNamePart folds Finnish letters and keeps double-name hyphens", () => {
  assert.equal(asciiNamePart("Hämäläinen"), "hamalainen");
  assert.equal(asciiNamePart("Hamro-Droz"), "hamro-droz");
  assert.equal(asciiNamePart("Åkerlund"), "akerlund");
});

test("buildLocalPart supports common formats", () => {
  assert.equal(buildLocalPart("Mikko Keskinen", "first.last"), "mikko.keskinen");
  assert.equal(buildLocalPart("Mikko Keskinen", "f.last"), "m.keskinen");
  assert.equal(buildLocalPart("Mikko", "first.last"), null);
});

test("personalAddresses drops shared mailboxes", () => {
  assert.deepEqual(
    personalAddresses(["info@x.fi", "myynti@x.fi", "liisa.eerola@x.fi"]),
    ["liisa.eerola@x.fi"],
  );
});

test("detectPattern finds first.last and ignores team boxes", () => {
  const found = detectPattern([
    "info@acme.fi",
    "customer.service@acme.fi",
    "liisa.eerola@acme.fi",
    "petri.angervuori@acme.fi",
  ]);
  assert.deepEqual(found, { pattern: "first.last", domain: "acme.fi", support: 2 });
  assert.equal(detectPattern(["info@acme.fi", "customer.service@acme.fi"]), null);
});

test("resolveLeaderEmail prefers a published address for the person", () => {
  const result = resolveLeaderEmail("Liisa Eerola", ["liisa.eerola@acme.fi"], mxYes);
  assert.deepEqual(result, { address: "liisa.eerola@acme.fi", method: "published", confidence: "high" });
});

test("resolveLeaderEmail applies a detected pattern only when MX is valid", () => {
  const site = ["petri.angervuori@acme.fi"];
  assert.deepEqual(resolveLeaderEmail("Mikko Hämäläinen", site, mxYes), {
    address: "mikko.hamalainen@acme.fi",
    method: "pattern",
    confidence: "medium",
  });
  assert.equal(resolveLeaderEmail("Mikko Hämäläinen", site, mxNo).address, null);
});

test("resolveLeaderEmail never guesses without a pattern or a name", () => {
  assert.equal(resolveLeaderEmail("Mikko Keskinen", ["info@acme.fi"], mxYes).method, "none");
  assert.equal(resolveLeaderEmail(null, ["a.b@acme.fi"], mxYes).address, null);
});
