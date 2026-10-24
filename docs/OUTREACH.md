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
| `NEXT_PUBLIC_BOOKING_URL` | Calendly/Cal.com link for "Book 15 minutes" (existing) | mailto fallback |

---

## 7. Running locally

```bash
npm ci
npm run dev                              # then open http://localhost:3000/outreach
npm run typecheck
node --test tests/outreach/*.test.mjs    # 23 unit tests, no extra dependencies
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
lib/outreach/pure/*.ts                verification, roles, sufficiency, estimate, email pattern, .eml
app/api/outreach/**                   stream, send, eml, unsubscribe, views
app/outreach/**                       dashboard
app/v/[domain]/**                     personal video page (fixes the former 404)
app/unsubscribe/page.tsx              unsubscribe confirmation
tests/outreach/*.test.mjs             node:test unit tests
```

---

## 9. Known limitations

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
