// Unit tests for the Velho-only demo seed (Oskar + company LinkedIn).
// Run from the repo root with:  node --test tests/outreach/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isVelhoCompany,
  isVelhoLiveRecipient,
  seedVelhoDemo,
  VELHO_DEMO_EMAIL,
  VELHO_DEMO_LINKEDIN,
} from "../../lib/outreach/pure/velhoDemo.ts";

test("isVelhoCompany matches velho.io and the legal name only", () => {
  assert.equal(isVelhoCompany("velho.io"), true);
  assert.equal(isVelhoCompany("www.velho.io", "Anything"), true);
  assert.equal(isVelhoCompany("fazer.com", "Velho Applied Intelligence Oy"), true);
  assert.equal(isVelhoCompany("fazer.com", "Fazer"), false);
  assert.equal(isVelhoCompany("velho.fi", "Velho"), false);
});

test("isVelhoLiveRecipient requires Oskar and a velho.io video link", () => {
  assert.equal(
    isVelhoLiveRecipient(VELHO_DEMO_EMAIL, "http://localhost:3000/v/velho.io?r=ceo&t=abc"),
    true,
  );
  assert.equal(isVelhoLiveRecipient(VELHO_DEMO_EMAIL, "http://localhost:3000/v/fazer.com?r=ceo"), false);
  assert.equal(isVelhoLiveRecipient("ada@fazer.com", "http://localhost:3000/v/velho.io?r=ceo"), false);
});

test("seedVelhoDemo writes Oskar and the company LinkedIn page", () => {
  const { leaders, socials } = seedVelhoDemo(
    [
      {
        role: "CEO",
        name: null,
        title: "",
        publicStatements: [],
        email: { address: null, method: "none", confidence: "low" },
        confidence: "low",
        evidence: null,
      },
    ],
    [{ platform: "instagram", url: "https://www.instagram.com/velho", kind: "company", context: "" }],
  );
  const ceo = leaders.find((leader) => leader.role === "CEO");
  assert.equal(ceo?.name, "Oskar");
  assert.equal(ceo?.email.address, VELHO_DEMO_EMAIL);
  assert.equal(ceo?.email.method, "published");
  assert.equal(socials[0]?.url, VELHO_DEMO_LINKEDIN);
  assert.equal(socials[0]?.kind, "company");
  assert.equal(socials.some((link) => link.platform === "instagram"), true);
});
