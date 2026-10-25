// Public origin for video links inside outreach emails.
// Run from the repo root with:  node --test tests/outreach/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import { publicAppOrigin } from "../../lib/outreach/pure/publicOrigin.ts";
import { gmailComposeUrl, rewriteLocalOrigins } from "../../lib/outreach/pure/emailText.ts";

test("publicAppOrigin ignores a localhost app URL when the request is public", () => {
  assert.equal(
    publicAppOrigin({
      configured: "http://localhost:3000",
      forwardedHost: "video-and-outreach-agent.vercel.app",
      forwardedProto: "https",
      requestOrigin: "http://localhost:3000",
    }),
    "https://video-and-outreach-agent.vercel.app",
  );
});

test("publicAppOrigin keeps an explicit public app URL", () => {
  assert.equal(
    publicAppOrigin({
      configured: "https://outreach.velho.io",
      forwardedHost: "video-and-outreach-agent.vercel.app",
      forwardedProto: "https",
    }),
    "https://outreach.velho.io",
  );
});

test("publicAppOrigin stays on localhost in local development", () => {
  assert.equal(
    publicAppOrigin({
      configured: "http://localhost:3000",
      requestOrigin: "http://localhost:3000",
    }),
    "http://localhost:3000",
  );
});

test("rewriteLocalOrigins swaps localhost links for the page origin", () => {
  const email = {
    role: "CEO",
    recipient: { name: null, title: "CEO", email: null },
    theme: "Growth",
    subject: "Hello",
    greeting: "Hello,",
    body: ["See http://localhost:3000/v/velho.io"],
    callToAction: "Watch",
    footer: ["Unsubscribe: http://localhost:3000/unsubscribe?t=abc"],
    videoUrl: "http://localhost:3000/v/velho.io?r=ceo&t=abc",
    unsubscribeUrl: "http://localhost:3000/unsubscribe?t=abc",
    token: "abc",
    usedFacts: [],
    language: "en",
    status: "draft",
    writtenBy: "template",
    mergedRoles: [],
  };
  const rewritten = rewriteLocalOrigins(email, "https://video-and-outreach-agent.vercel.app");
  assert.equal(
    rewritten.videoUrl,
    "https://video-and-outreach-agent.vercel.app/v/velho.io?r=ceo&t=abc",
  );
  assert.match(rewritten.footer[0], /^Unsubscribe: https:\/\/video-and-outreach-agent\.vercel\.app/);
});

test("gmailComposeUrl opens Gmail with the draft filled in", () => {
  const url = gmailComposeUrl({
    role: "CEO",
    recipient: { name: "Ada", title: "CEO", email: "ada@example.com" },
    theme: "Growth",
    subject: "Hello Ada",
    greeting: "Hi Ada,",
    body: ["One line."],
    callToAction: "Watch:",
    footer: ["Velho"],
    videoUrl: "https://example.com/v",
    unsubscribeUrl: "https://example.com/u",
    token: "t",
    usedFacts: [],
    language: "en",
    status: "draft",
    writtenBy: "template",
    mergedRoles: [],
  });
  assert.match(url, /^https:\/\/mail\.google\.com\/mail\/\?extsrc=mailto&url=/);
  const mailto = decodeURIComponent(url.split("url=")[1]);
  assert.match(mailto, /^mailto:ada@example.com\?/);
  assert.match(mailto, /subject=Hello%20Ada/);
});

test("gmailComposeUrl can address the operator inbox instead of the company", () => {
  const url = gmailComposeUrl(
    {
      role: "CEO",
      recipient: { name: "Ada", title: "CEO", email: "ada@example.com" },
      theme: "Growth",
      subject: "Hello Ada",
      greeting: "Hi Ada,",
      body: ["One line."],
      callToAction: "Watch:",
      footer: ["Velho"],
      videoUrl: "https://example.com/v",
      unsubscribeUrl: "https://example.com/u",
      token: "t",
      usedFacts: [],
      language: "en",
      status: "draft",
      writtenBy: "template",
      mergedRoles: [],
    },
    "operator@example.com",
  );
  const mailto = decodeURIComponent(url.split("url=")[1]);
  assert.match(mailto, /^mailto:operator@example.com\?/);
});
