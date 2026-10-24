# Outreach — suggested changes for the leader

The outreach feature was built by a team member **without modifying any existing
file** (no edits to shared code, `package.json`, `.env.example` or configs). The
items below need a change to a shared file or an account, so they are proposed
here for the leader to decide on.

---

## 1. Link the new dashboard from the main page (optional)

`app/page.tsx`, footer (around line 477):

```diff
           <span className="flex items-center gap-1.5">
             <Github className="h-3 w-3" strokeWidth={2} />
             Built for the hackathon
           </span>
+          <a href="/outreach" className="text-sky-300 hover:text-sky-200">
+            Role-personalized emails →
+          </a>
         </div>
       </footer>
```

## 2. Document the new environment variables

Append to `.env.example`:

```bash
# --- Outreach (role-personalized emails, /outreach) -------------------------
# Optional web search for leadership and news.
TAVILY_API_KEY=
# Hourly cost used in estimates (always shown as an assumption).
ASSUMED_HOURLY_COST_EUR=40
# Real Velho person shown as the sender.
OUTREACH_SENDER_NAME=
OUTREACH_SENDER_EMAIL=
# Sending is disabled unless this is set; send requests must carry it.
OUTREACH_ADMIN_SECRET=
# Demo provider. Dry run (default) sends everything to OUTREACH_TEST_EMAIL.
RESEND_API_KEY=
OUTREACH_DRY_RUN=true
OUTREACH_TEST_EMAIL=
OUTREACH_DAILY_LIMIT_PER_INBOX=40
```

## 3. Add a test script

`package.json`:

```diff
-    "typecheck": "tsc --noEmit"
+    "typecheck": "tsc --noEmit",
+    "test:outreach": "node --test tests/outreach/*.test.mjs"
```

Needs Node 22.6+ (type stripping); no new dependencies.

## 4. Public URL so links open on phones

Video links in emails use `NEXT_PUBLIC_APP_URL`, falling back to the request
origin. On `localhost` a judge's phone cannot open them.

- Deploy (e.g. Vercel) and set `NEXT_PUBLIC_APP_URL=https://<deployment>`.
- The legacy `buildVideoUrl` in `lib/agents.ts` defaults to `https://velho.ai`
  when the variable is unset; with it set, the legacy email's link now opens the
  new `/v/<domain>` page instead of a 404.

## 5. Shared storage on serverless

`lib/outreach/store.ts` keeps data in memory plus a temp-dir JSON file. On
Vercel, instances don't share that file, so a video view or opt-out recorded on
one instance is invisible to another. Implement the same `OutreachStore`
interface on a KV store (e.g. Upstash Redis via its REST API) and return it from
`getOutreachStore()`:

```ts
// Sketch — keys: result:<domain>, token:<token>, views:<token>, dnc (set), sends:<date>
export const createKvStore = (url: string, token: string): OutreachStore => { /* … */ };
```

Opt-outs must live in shared storage before any real sending.

### Search caches on serverless
The search tabs keep PRH responses (10–30 min), website resolutions and
enrichment results in process memory, and its rate limiter is per process.
On serverless each instance has its own cache and limiter, so the register
may see more parallel requests than the ~5/s target. If the search is used
heavily after deployment, move these caches to the same KV store and keep the
search routes on a single region/instance.

## 6. A real sending provider

Resend is wired in for **dry-run demos only**: its terms do not allow
unsolicited bulk email. For real cold outreach, add an `EmailSender` for a
provider built for it (e.g. Instantly, Smartlead), send from a **separate
outreach subdomain** with SPF/DKIM/DMARC, warm the inbox up, and keep
`OUTREACH_DAILY_LIMIT_PER_INBOX` low (30–50). Each email is already unique per
company and role.

## 7. Architecture note (`.cursorrules`)

The 5-step rule is kept: research extends **Step 1 (Discovery)** and the role
emails replace **Step 5 (Email)** in this flow. The legacy pipeline and
`/api/generate-outreach` are untouched and still work as before.

## 8. Before contacting real companies

Hackathon rule: **no contact with real companies, and nothing published in
Velho's name, without Velho's approval.** Keep `OUTREACH_DRY_RUN=true` and leave
`OUTREACH_ADMIN_SECRET` unset on any public deployment until Velho agrees.
