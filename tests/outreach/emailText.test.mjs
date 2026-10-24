// Unit tests for email text renderings (.eml, mailto, plain text).
// Run from the repo root with:  node --test tests/outreach/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildEml,
  emailToPlainText,
  emlFileName,
  encodeHeader,
  mailtoUrl,
} from "../../lib/outreach/pure/emailText.ts";

const email = {
  role: "CFO",
  recipient: { name: "Tomi Virtanen", title: "Talousjohtaja", email: "tomi.virtanen@berner.fi" },
  theme: "Cost",
  subject: "Berner Oy: kuukausikustannus",
  greeting: "Hi Tomi,",
  body: ["Sentence one.", "Sentence two.", "Sentence three."],
  callToAction: "Watch the 45-second video:",
  footer: ["Sources: duunitori.fi", "Not relevant? Unsubscribe here: https://x.test/unsubscribe?t=abc", "Oskar, Velho"],
  videoUrl: "https://x.test/v/berner.fi?r=cfo&t=abc",
  unsubscribeUrl: "https://x.test/unsubscribe?t=abc",
  token: "abc",
  usedFacts: [],
  language: "en",
  status: "draft",
  writtenBy: "template",
  mergedRoles: [],
};

const decodeBody = (eml) => {
  const body = eml.split("\r\n\r\n")[1].replace(/\r\n/g, "");
  return Buffer.from(body, "base64").toString("utf8");
};

test("encodeHeader leaves ASCII alone and RFC 2047-encodes the rest", () => {
  assert.equal(encodeHeader("Hello"), "Hello");
  assert.match(encodeHeader("Hämeenlinna"), /^=\?UTF-8\?B\?.+\?=$/);
});

test("buildEml produces an unsent draft with unsubscribe headers", () => {
  const eml = buildEml(email, {
    fromName: "Oskar Kallio",
    fromAddress: "oskar@velho.test",
    date: new Date("2026-10-24T12:00:00Z"),
  });
  assert.match(eml, /^From: Oskar Kallio <oskar@velho\.test>\r\n/);
  assert.match(eml, /\r\nTo: Tomi Virtanen <tomi\.virtanen@berner\.fi>\r\n/);
  assert.match(eml, /\r\nList-Unsubscribe: <https:\/\/x\.test\/unsubscribe\?t=abc>\r\n/);
  assert.match(eml, /\r\nX-Unsent: 1\r\n/);
  const body = decodeBody(eml);
  assert.match(body, /^Hi Tomi,/);
  assert.match(body, /https:\/\/x\.test\/v\/berner\.fi\?r=cfo&t=abc/);
});

test("buildEml leaves To empty when there is no address", () => {
  const eml = buildEml(
    { ...email, recipient: { ...email.recipient, email: null } },
    { fromName: "Velho", fromAddress: "a@velho.test", date: new Date(0) },
  );
  assert.match(eml, /\r\nTo: \r\n/);
});

test("mailtoUrl and plain text carry subject, body and link", () => {
  const url = mailtoUrl(email);
  assert.ok(url.startsWith("mailto:tomi.virtanen@berner.fi?subject="));
  assert.ok(decodeURIComponent(url).includes("https://x.test/v/berner.fi?r=cfo&t=abc"));
  assert.ok(emailToPlainText(email).startsWith("Subject: Berner Oy: kuukausikustannus"));
});

test("emlFileName is filesystem-safe", () => {
  assert.equal(emlFileName("Würth Oy", email), "wurth-oy-cfo.eml");
});
