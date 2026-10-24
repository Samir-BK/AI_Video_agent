// Unit tests for structured-data, social-link and sitemap helpers.
// Run from the repo root with:  node --test tests/outreach/*.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractSocialLinks,
  jsonTexts,
  metaTexts,
  robotsSitemaps,
  sitemapLocs,
  structuredText,
} from "../../lib/outreach/pure/htmlData.ts";

const JS_SITE = `<!doctype html><html><head>
<title>Fazer</title>
<meta name="description" content="Fazer is a family-owned food company &amp; bakery.">
<meta property="og:title" content="Fazer Group">
<script type="application/ld+json">{"@type":"Organization","legalName":"Oy Karl Fazer Ab","sameAs":["https:\\/\\/www.instagram.com\\/fazersuomi\\/","https://www.linkedin.com/company/fazer/posts/"]}</script>
<script id="__NEXT_DATA__" type="application/json">{"props":{"page":{"headline":"Our bakeries are going digital","items":[{"text":"We employ around 15000 people in eight countries."}]}}}</script>
</head><body><div id="root"></div>
<footer>Follow us <a href="https://www.facebook.com/fazersuomi">Facebook</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">Share</a>
<p>Anna Example, CEO</p><a href="https://fi.linkedin.com/in/anna-example-123/">LinkedIn</a></footer>
</body></html>`;

test("metaTexts reads description and Open Graph tags", () => {
  assert.deepEqual(metaTexts(JS_SITE), [
    "Fazer is a family-owned food company & bakery.",
    "Fazer Group",
  ]);
});

test("jsonTexts reads JSON-LD and __NEXT_DATA__ prose", () => {
  const texts = jsonTexts(JS_SITE);
  assert.ok(texts.includes("Oy Karl Fazer Ab"));
  assert.ok(texts.includes("Our bakeries are going digital"));
  assert.ok(texts.includes("We employ around 15000 people in eight countries."));
  assert.ok(!texts.some((value) => value.startsWith("http")));
});

test("structuredText is empty for plain pages", () => {
  assert.equal(structuredText("<html><body><p>Hi</p></body></html>"), "");
  assert.match(structuredText(JS_SITE), /Karl Fazer/);
});

test("extractSocialLinks finds accounts, skips share buttons, marks people", () => {
  const links = extractSocialLinks(JS_SITE);
  const urls = links.map((link) => link.url);
  assert.ok(urls.includes("https://www.instagram.com/fazersuomi"));
  assert.ok(urls.includes("https://www.linkedin.com/company/fazer"));
  assert.ok(urls.includes("https://www.facebook.com/fazersuomi"));
  assert.ok(!urls.some((url) => url.includes("sharer")));
  const person = links.find((link) => link.kind === "person");
  assert.equal(person?.url, "https://fi.linkedin.com/in/anna-example-123");
  assert.match(person?.context ?? "", /Anna Example, CEO/);
});

test("sitemapLocs separates pages from a sitemap index", () => {
  const urlset = `<urlset><url><loc>https://a.fi/fi/meista/</loc></url><url><loc> https://a.fi/en/about-us/ </loc></url></urlset>`;
  assert.deepEqual(sitemapLocs(urlset), {
    pages: ["https://a.fi/fi/meista/", "https://a.fi/en/about-us/"],
    sitemaps: [],
  });
  const index = `<sitemapindex><sitemap><loc><![CDATA[https://a.fi/page-sitemap.xml]]></loc></sitemap></sitemapindex>`;
  assert.deepEqual(sitemapLocs(index), { pages: [], sitemaps: ["https://a.fi/page-sitemap.xml"] });
});

test("robotsSitemaps reads Sitemap lines", () => {
  assert.deepEqual(robotsSitemaps("User-agent: *\nDisallow: /x\nSitemap: https://a.fi/sitemap.xml\n"), [
    "https://a.fi/sitemap.xml",
  ]);
});

test("personLinkFor only accepts a profile linked next to the full name", async () => {
  const { personLinkFor } = await import("../../lib/outreach/pure/htmlData.ts");
  const links = [
    { platform: "linkedin", kind: "person", url: "https://www.linkedin.com/in/xyz-123", context: "Anna Example, CEO" },
    { platform: "linkedin", kind: "person", url: "https://www.linkedin.com/in/mikko-meikalainen", context: "Team" },
    { platform: "linkedin", kind: "company", url: "https://www.linkedin.com/company/acme", context: "Anna Example" },
  ];
  assert.equal(personLinkFor("Anna Example", links), "https://www.linkedin.com/in/xyz-123");
  assert.equal(personLinkFor("Mikko Meikäläinen", links), "https://www.linkedin.com/in/mikko-meikalainen");
  assert.equal(personLinkFor("Anna", links), null);
  assert.equal(personLinkFor("Liisa Other", links), null);
  assert.equal(personLinkFor(null, links), null);
});

test("companySocials keeps one account per platform, preferring the brand", async () => {
  const { companySocials } = await import("../../lib/outreach/pure/htmlData.ts");
  const link = (platform, url) => ({ platform, kind: "company", url, context: "" });
  const socials = companySocials(
    [
      link("instagram", "https://www.instagram.com/partnerbrand"),
      link("instagram", "https://www.instagram.com/fazersuomi"),
      link("facebook", "https://www.facebook.com/fazersuomi"),
      { platform: "linkedin", kind: "person", url: "https://www.linkedin.com/in/a-b", context: "" },
    ],
    "fazer",
  );
  assert.deepEqual(
    socials.map((s) => s.url),
    ["https://www.instagram.com/fazersuomi", "https://www.facebook.com/fazersuomi"],
  );
});

test("hiddenEmails decodes Cloudflare protection and (at) forms", async () => {
  const { hiddenEmails } = await import("../../lib/outreach/pure/htmlData.ts");
  // "a.b@c.fi" XOR 0x42.
  const key = 0x42;
  const hex =
    key.toString(16) +
    [..."a.b@c.fi"].map((ch) => (ch.charCodeAt(0) ^ key).toString(16).padStart(2, "0")).join("");
  const html = `<a class="__cf_email__" data-cfemail="${hex}">[email protected]</a>
    <p>Matti Meikäläinen, matti.meikalainen(at)example.fi</p>
    <p>Liisa: liisa.virtanen [at] example (dot) fi</p>
    <p>Contact us at example.fi for more.</p>`;
  const found = hiddenEmails(html);
  assert.ok(found.includes("a.b@c.fi"));
  assert.ok(found.includes("matti.meikalainen@example.fi"));
  assert.ok(found.includes("liisa.virtanen@example.fi"));
  assert.ok(!found.some((address) => address.startsWith("us@")));
});
