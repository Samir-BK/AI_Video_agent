// Unit tests for the "share proposal on found channels" helper.
// Run from the repo root with:  node --test tests/outreach/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  channelOpenUrl,
  officialCompanyAccounts,
  proposalCaption,
  sharePlan,
} from "../../lib/outreach/pure/socialShare.ts";

const company = (platform, url) => ({
  platform,
  url,
  kind: "company",
  context: "",
});

test("officialCompanyAccounts drops person profiles and duplicate platforms", () => {
  const links = [
    company("linkedin", "https://www.linkedin.com/company/velho"),
    {
      platform: "linkedin",
      url: "https://www.linkedin.com/in/someone",
      kind: "person",
      context: "CEO",
    },
    company("instagram", "https://www.instagram.com/velho"),
    company("linkedin", "https://www.linkedin.com/company/velho-other"),
  ];
  assert.deepEqual(
    officialCompanyAccounts(links).map((link) => link.platform),
    ["linkedin", "instagram"],
  );
});

test("proposalCaption is one line with the company, CTA and video URL", () => {
  const text = proposalCaption(
    "Velho",
    "https://app.example/v/velho.ai",
    "Watch and book a 15-minute walkthrough.",
  );
  assert.match(text, /Velho/);
  assert.match(text, /https:\/\/app\.example\/v\/velho\.ai/);
  assert.match(text, /15-minute/);
  assert.equal(text.includes("\n"), false);
});

test("LinkedIn, X and Facebook open a share dialog; Instagram opens the profile", () => {
  const video = "https://app.example/v/velho.ai";
  const caption = "A 45-second video for Velho. Watch. " + video;
  assert.equal(
    channelOpenUrl(company("linkedin", "https://www.linkedin.com/company/velho"), caption, video),
    `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(video)}`,
  );
  assert.ok(
    channelOpenUrl(company("x", "https://x.com/velho"), caption, video).startsWith(
      "https://twitter.com/intent/tweet?text=",
    ),
  );
  assert.ok(
    channelOpenUrl(company("facebook", "https://www.facebook.com/velho"), caption, video).includes(
      encodeURIComponent(video),
    ),
  );
  assert.equal(
    channelOpenUrl(company("instagram", "https://www.instagram.com/velho"), caption, video),
    "https://www.instagram.com/velho",
  );
});

test("sharePlan lists one target per official company account", () => {
  const plan = sharePlan(
    [
      company("tiktok", "https://www.tiktok.com/@velho"),
      { platform: "linkedin", url: "https://www.linkedin.com/in/x", kind: "person", context: "" },
    ],
    "Velho",
    "https://app.example/v/velho.ai",
    "Book a meeting.",
  );
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.targets[0].platform, "tiktok");
  assert.equal(plan.targets[0].openUrl, "https://www.tiktok.com/@velho");
  assert.match(plan.caption, /velho\.ai/);
});
