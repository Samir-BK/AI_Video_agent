// Unit tests for key-free fact finding.
// Run from the repo root with:  node --test tests/outreach/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { ruleFacts, sentencesOf } from "../../lib/outreach/pure/ruleFacts.ts";

const PAGE = {
  url: "https://www.example.fi/yritys",
  text: [
    "Etusivu Yritys Uutiset",
    "Hyväksyn evästeet ja tietosuojaselosteen ehdot tällä sivustolla nyt.",
    "Example Oy:n liikevaihto vuonna 2025 oli 52,7 miljoonaa euroa ja se kasvoi selvästi.",
    "Tavoitteenamme on kaksinkertaistaa vienti Ruotsiin vuoteen 2028 mennessä.",
    "Yhtiö avaa uuden logistiikkakeskuksen Tampereelle ensi vuoden aikana.",
  ].join("\n"),
};

test("sentencesOf keeps sentences verbatim and drops short lines", () => {
  const sentences = sentencesOf(PAGE.text);
  assert.ok(!sentences.includes("Etusivu Yritys Uutiset"));
  assert.ok(sentences.every((sentence) => PAGE.text.includes(sentence)));
});

test("ruleFacts finds financial, goal and change sentences, skips cookie text", () => {
  const facts = ruleFacts([PAGE], "example.fi", ["example"]);
  const kinds = facts.map((fact) => fact.kind).sort();
  assert.deepEqual(kinds, ["financial", "strategy_goal", "why_now"]);
  assert.ok(facts.every((fact) => fact.quote === fact.text && PAGE.text.includes(fact.quote)));
  assert.ok(facts.every((fact) => fact.quoteLang === "fi"));
  assert.ok(!facts.some((fact) => /evästeet/.test(fact.quote)));
});

test("ruleFacts needs the company name on pages from other sites", () => {
  const news = { url: "https://news.example.com/a", text: "Toinen Oy:n liikevaihto kasvoi 20 prosenttia ja oli 12 miljoonaa euroa." };
  assert.equal(ruleFacts([news], "example.fi", ["example"]).length, 0);
  const about = { url: "https://news.example.com/b", text: "Example Oy:n liikevaihto kasvoi 20 prosenttia ja oli 12 miljoonaa euroa." };
  assert.equal(ruleFacts([about], "example.fi", ["example"]).length, 1);
});
