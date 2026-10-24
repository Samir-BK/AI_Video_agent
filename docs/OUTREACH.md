# Velho Outreach — role-personalized video emails

An add-on to the Velho Outreach Engine. For one company it writes a separate,
sourced email for each decision-maker — **CEO, COO and CFO** — and each email
links to a personal page with the company's 45-second video.

The aim is that each executive opens the video because the email speaks to what
their role cares about, using real public facts about the company:
*"they understand our company"*, never *"they are watching me"*.

Open it at **`/outreach`**. The original dashboard at `/` is unchanged.

---

## 1. What happens when you enter a domain

```
domain ──► company website (leadership, investor, news, careers pages)
       ├─► legacy pipeline: Discovery → Problem → Solution → Video Script
       ├─► trade register (PRH open data): domain → legal company
       ├─► job ads (Duunitori public search)
       ├─► optional web search (Tavily, only with a key)
       │
       ├─► extraction (1 LLM call): leaders, goals, "why now", financials
       │      └─ every quote checked against the fetched page text
       ├─► work addresses from the company's own site (+ MX check)
       ├─► sufficiency: ready / weak / insufficient
       └─► role emails (1 LLM call) ──► /v/<domain>?r=<role>&t=<token>
```

Progress is streamed to the dashboard as it happens (Server-Sent Events).

**LLM budget: 6 calls per run** — 4 legacy agents + 1 extraction + 1 email
call. The legacy Email agent is not called by this flow.

---

## 2. Rules the code enforces

| Rule | How |
|---|---|
| Work information only | Types have no fields for private life. Prompts forbid it. Social networks are never scraped; Tavily results from LinkedIn/Facebook/Instagram/X are dropped. |
| Every fact has a source | `SourcedFact.quote` is verbatim (original language). `verifyFacts` checks it appears in the fetched text (NFC, case and whitespace normalised). Failures are dropped and counted as "rejected". |
| Estimates are labelled | One `CostEstimate` with its formula, e.g. `≈165 h/month × €40/h (assumption) ≈ €6,600/month`. No payback period (Velho pricing unknown). |
| Same numbers for all roles | CEO, COO and CFO emails share one fact set and one estimate. |
| Never invent an address | Published address for the person, or the site's `firstname.lastname@` format **with** MX records. Otherwise `no_address`. |
| Never an error screen | Every source and LLM call has a deadline (≤6 s each, research ≤20 s, in parallel) and a labelled fallback (templates, sample video page). |
| Nothing is sent by default | Drafts only. Sending needs an admin secret and is a dry run to a test inbox unless explicitly disabled. |

---

## 3. Company match

The input is a website; registers work by name or business ID. The tool:

1. reads legal names printed on the site (`© Sinituote Oy`, `Lassila & Tikanoja Oyj`),
2. searches PRH with those plus the model's name guess,
3. prefers the company whose **registered website** matches the domain,
   then an exact legal-name match.

A weak, name-only match is **never auto-selected**: the dashboard shows
"Wrong company? Pick:" with candidates, and re-runs with the chosen business ID.
Renamed companies are handled (PRH keeps name history; a rename in the last
3 years becomes a "why now" fact).

---

## 4. Roles and sufficiency

- **CEO** — growth and strategy; ties the bottleneck to a stated goal or a "why now" signal.
- **COO** — operations, hours, where the bottleneck sits; "free up your team's hours".
- **CFO** — EUR/month (labelled estimate) and % of operating profit when verified financials exist.

Finnish titles are mapped (`toimitusjohtaja` → CEO, `talousjohtaja` → CFO,
`toimitusketjujohtaja` / `tuotantojohtaja` / "SVP Operations" → COO).
Deputies are ignored.

| Level | Condition | Emails |
|---|---|---|
| `ready` | ≥ 2 verified substantive facts **and** a named CEO | One per named leader; missing roles fold into the CEO email |
| `weak` | ≥ 1 verified substantive fact | CEO email only (covers the other angles), low confidence |
| `insufficient` | none | No email; the dashboard shows what was searched |

Register facts (company age, line of business) are shown but do not count as
substance.

---

## 5. Delivery

| Action | Where | Notes |
|---|---|---|
| Copy email | dashboard | Plain text with subject |
| Download .eml | `GET /api/outreach/eml?t=<token>` | Unsent draft (`X-Unsent: 1`), opens in Outlook / Apple Mail / Thunderbird, includes `List-Unsubscribe` headers |
| Open in mail app | `mailto:` link | Uses the operator's own mail account |
| Send | `POST /api/outreach/send` | Needs `x-admin-secret`; checks opt-outs and the daily limit; needs `RESEND_API_KEY`; **dry run by default** |
| Unsubscribe | `/unsubscribe?t=<token>` | Confirm click (a GET never opts out) + RFC 8058 one-click POST at `/api/outreach/unsubscribe` |
| Views | `GET /api/outreach/views?domain=` | Video-page views per role and live email statuses |

Opt-outs are stored by address and by token, persist across regenerations,
and block every send.

---

## 6. Configuration

All optional — without any keys the app runs end to end on key-free sources and
templates, and labels what fell back.

| Variable | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` / `GROQ_API_KEY` | Extraction + emails (existing team key) | templates |
| `TAVILY_API_KEY` | Extra web search for leadership/news | off |
| `ASSUMED_HOURLY_COST_EUR` | Hourly cost in the estimate (always shown as an assumption) | `40` |
| `OUTREACH_SENDER_NAME` | Real Velho person in the signature | `[Sender name], Velho` |
| `OUTREACH_SENDER_EMAIL` | From address (an outreach subdomain in production) | placeholder |
| `OUTREACH_ADMIN_SECRET` | Required to send at all | sending disabled |
| `RESEND_API_KEY` | Demo sending provider | draft-only |
| `OUTREACH_DRY_RUN` | `false` sends to real recipients | `true` |
| `OUTREACH_TEST_EMAIL` | Team inbox for dry runs | — |
| `OUTREACH_DAILY_LIMIT_PER_INBOX` | Daily cap | `40` |
| `NEXT_PUBLIC_APP_URL` | Public base URL for video/unsubscribe links | request origin |
| `NEXT_PUBLIC_BOOKING_URL` | Calendar opened by "Book 15 minutes" and the video CTA | `https://ops.velho.io/book/patrik/intro` |

---

## 7. Running locally

```bash
npm ci
npm run dev                              # then open http://localhost:3000/outreach
npm run typecheck
node --test tests/outreach/*.test.mjs    # 45 unit tests, no extra dependencies
```

Stored results, views and opt-outs live in memory and in
`<OS temp dir>/velho-outreach/store.json` (outside the repo).

---

## 8. Files

All new; no existing file was modified.

```
types/outreach.ts                     contracts
lib/outreach/orchestrator.ts          end-to-end run
lib/outreach/emails.ts                role emails (LLM + validated templates)
lib/outreach/senders.ts               draft / dry-run / Resend adapter
lib/outreach/store.ts                 results, tokens, views, opt-outs
lib/outreach/fetchText.ts             full-text page fetcher
lib/outreach/research/*.ts            website, PRH, entity, job ads, Tavily, extraction, contacts
lib/outreach/search/*.ts              PRH search client, website resolution, criteria engine, enrichment
lib/outreach/pure/*.ts                verification, roles, sufficiency, estimate, email pattern, .eml,
                                      search text/filters/scoring/signals, PRH record parsing
app/api/outreach/**                   stream, send, eml, unsubscribe, views, result
app/api/outreach/search/**            companies, resolve, criteria (SSE), history
app/outreach/**                       dashboard + search page (/outreach/search)
app/v/[domain]/**                     personal video page (fixes the former 404)
app/unsubscribe/page.tsx              unsubscribe confirmation
tests/outreach/*.test.mjs             node:test unit tests
```

---

## 9. Search (`/outreach/search`)

Three tabs, all ending in the existing per-company outreach (no batch runs).
Company data only — there is no search by person. Data: PRH / YTJ open data,
CC BY 4.0 (attribution shown on the page).

### By name
Live suggestions from the trade register (300 ms debounce, stale requests
cancelled, ↑ ↓ Enter Esc). Shows current and previous names, business ID,
city, business line, age and status (dissolved / liquidation / bankruptcy).
When nothing matches it retries the longest word ("lassila tikanoja" →
Lassila & Tikanoja Oyj) and accent variants ("wurth" → Würth Oy).
Picking a company resolves its website (below) and hands off to
`/outreach?domain=…&businessId=…&auto=1`, so the entity match is exact.
Typing a company name instead of a domain on `/outreach` opens this tab.

### Website resolution — never an unverified guess
1. The website registered in PRH, if it responds.
2. Otherwise candidates from the legal name (`berner.fi`, `lassila-tikanoja.fi`, …),
   each accepted only when DNS resolves **and** the homepage contains the legal
   name (current or previous) or the business ID. The matching excerpt is shown.
3. Otherwise "website not found" and the operator can type it.
This is deliberately strict: a site that says "Kesla" but never "Kesla Oyj" is
not accepted automatically.

### By criteria
Industry groups (or raw TOL codes), region (largest towns first) plus extra
towns, minimum age (default 10 years).

| Observed PRH behaviour (probed 24 Oct 2026) | How the code handles it |
|---|---|
| Classification is **TOL 2025**, with some TOL 2008 codes still present | Groups list verified codes from both (e.g. 41000 and 41200) |
| `mainBusinessLine` matches **substrings** ("5210" also returns 25210) | Results post-filtered by code prefix |
| `location` takes a town, and matches **any** registered address | Regions expand to towns; ~1 % of rows show a head office elsewhere |
| 100 rows per page; a page beyond the end returns nothing; 429 exists | Paged by `totalResults`, ≤3 in flight, ~5 req/s, one retry |
| Pre-1978 companies share registration date 1978-03-15 | Shown as "registered before 1978" |
| Only ~20 % of companies have a registered website | Website resolution above, top 25 only |

Limits: ≤24 register queries, ≤300 candidates, 30-minute cache. The result
says when and why it stopped early (candidate cap or query budget).

Excluded by default (and counted): dissolved, liquidation/bankruptcy,
housing / real-estate companies, foundations / associations.

**Score (0–100), every point explained** — weights in `SCORE_WEIGHTS`
(`lib/outreach/pure/searchScore.ts`): base 30 · age +10/+15/+20 · limited
company +10 · rename in last 3 years +10 · registered/verified website +5 ·
no website −20 · hiring manual-work roles +30 / other roles +10 · stated size
20–250 +10, outside −10.

**Enrichment of the top 25**, streamed row by row (5 in parallel, job board 2
at a time, ≤6 s per company, ≤40 s total): website, Duunitori open positions
(manual-work roles flagged ●), and an employee count only when the company's
own site states it (quote + source). A timed-out website check is "unknown",
not penalised. "Only hiring" and "only known size" filter the checked rows.
CSV export includes all signals and the score explanation.

### History
Companies already researched on this server, searchable by partial,
accent-insensitive company name, domain or contact, filterable by email status
and minimum video views, sortable by date or views. "Open" reloads the stored
result in `/outreach` without new research (`/api/outreach/result`).
The default store is per machine — see `docs/OUTREACH_INTEGRATION.md` §5.

---

## 10. Known limitations

- **Model path untested on this branch** — it was developed without an LLM key, so
  every email in testing came from validated templates. With a key, goals,
  news and financials should lift more companies to `ready`.
- Some sites block automated reading (e.g. HTTP 403). The tool logs it and does
  not try to get around it; register and job-ad data still work.
- Job ads come from one board (Duunitori) and are matched by company name.
- The video itself (legacy player) is English; the page labels and emails
  support Finnish.
- The default store is a temp-dir JSON file: fine locally, **not shared between
  serverless instances** — see `docs/OUTREACH_INTEGRATION.md`.
- Resend and Tavily adapters are implemented but untested here (no keys).
- Search: stated employee counts are rare on Finnish company sites (0 of 16
  checked in one wholesale test), so "only known size" is off by default.
  Industry groups cover five Velho-relevant sectors; other sectors work via
  raw TOL 2025 codes.
