# Velho Outreach Engine

An AI B2B video-outreach platform. You give it a company domain; five agents
research that company, diagnose an operational bottleneck, design a fix inspired
by the company's own website, script a 45-second personalized video, and draft a
CEO cold email — all rendered in a dark, broadcast-style dashboard.

Built with Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, and
Framer Motion. No database, no queue, no auth — it is a single-request pipeline
with a strict "never show an error screen" engineering rule.

---

## 1. The one rule that shapes everything

> **A live stage demo must never show an error screen.**

Every design decision below flows from that. Scraping is deadline-bounded, every
LLM call is capped, every agent has a deterministic mock fallback, and the API
route has a last-resort catch that still returns a renderable payload. If the
whole pipeline fails, the dashboard still renders a complete fake company.

This is verified, not aspirational: with no API key configured, the app returns
`HTTP 200` with a full payload and an honest "fallback" badge on every step.

---

## 2. Architecture at a glance

```
Browser
  │
  ├─ app/page.tsx ────────── dashboard shell (client component)
  │     ├─ DomainInput          domain entry + sample chips
  │     ├─ VideoPlayer          45s player: cartoon + subtitles + audio
  │     ├─ InsightCards         Discovery / Problem / Solution cards
  │     ├─ EmailPreview         CEO email + plain-text view
  │     ├─ PipelineProgress     5-step live tracker
  │     └─ MobileModal          iPhone-framed landing page preview
  │
  └─ POST /api/generate-outreach ── the pipeline (server-only)
        │
        ├─ scrapeDomain()            plain-HTTP scrape, 5s budget
        │
        ├─ 1. Discovery Agent  ─┐
        ├─ 2. Problem Agent     │  each: LLM call capped at 6s,
        ├─ 3. Solution Agent    │  catch → deterministic mock
        ├─ 4. Video Script Agent│
        └─ 5. Email Agent      ─┘
```

Each agent returns an `AgentEnvelope<T>`: the data plus a `meta` block recording
whether it ran live, how long it took, and whether it timed out. The UI renders
that provenance honestly instead of pretending everything ran live.

---

## 3. The five agents

All five live in `lib/agents.ts` (924 lines). Each has a system prompt defining a
JSON contract, a validator that coerces the model's output, and a mock fallback.

| # | Agent | Produces | Fallback source |
|---|-------|----------|-----------------|
| 1 | Discovery | Company profile, brand palette, operational signals | `mockDiscovery` |
| 2 | Problem | The bottleneck, symptoms, quantified impact | `mockProblem` |
| 3 | Solution | 3-step architecture, headline metric, time-to-value | `mockSolution` |
| 4 | Video Script | 3 scenes, voiceovers, 2 cartoon beats | `mockVideoScript` |
| 5 | Email Draft | 4-sentence CEO email + plain text | `mockEmail` |

**Deadline discipline.** `AGENT_TIMEOUT_MS = 6000`. `callLlm` wraps `fetch` in an
`AbortController`; when the deadline fires it throws a typed `LlmTimeoutError`
which `runAgent` catches and converts into fallback data with a note. Nothing can
hang.

**Why the mocks are not throwaway.** On stage the LLM frequently returns nothing
useful. So the mock layer is a full deterministic engine, not lorem ipsum:
`lib/mockData.ts` derives a stable hash from the domain, picks one of four
industry archetypes (construction, logistics, saas, manufacturing), and generates
a coherent, company-specific-looking profile. The same domain always produces the
same output.

---

## 4. The 45-second video

This is the most intricate part of the project, spanning four files.

### Timeline

Defined once, in `lib/cartoonPresets.ts`, and consumed everywhere:

```ts
export const CARTOON_TIMELINE: CartoonTimeline = {
  problemStart: 6,
  problemEnd: 24,
  solutionStart: 24,
  solutionEnd: 45,
};
export const VIDEO_DURATION_SEC = CARTOON_TIMELINE.solutionEnd;
```

Three beats: **intro (0-6s) → problem (6-24s) → solution (24-45s)**.

The player derives the current phase from the *scene boundaries themselves*
rather than hardcoded seconds, so retiming the storyboard can never desync the
visuals from the script:

```ts
const phaseForSecond = (second, scenes) => {
  const scene = scenes.find(s => second >= s.startSec && second < s.endSec);
  if (!scene) return "solution";
  if (scene.id <= 1) return "intro";
  return scene.id === 2 ? "problem" : "solution";
};
```

### The cartoon layer — `CartoonAnimator.tsx`

Not a canvas loop and not stock footage. Every beat is hand-authored **inline SVG**
on a 640×360 viewBox, animated with declarative CSS keyframes in `globals.css`:

- `velho-shake`, `velho-pulse-warning`, `velho-bounce` — problem-mode agitation
- `velho-spin-gear`, `velho-fade-red-to-green` — solution
- `velho-rise`, `velho-float`, `velho-dash-march`, `velho-slide-in`, `velho-pop-in`
  — ambient motion and entrance
- `velho-anim-paused` — freezes every animation when the player pauses
- `@media (prefers-reduced-motion: reduce)` — degrades to a static diagram

One keyframe, `velho-flow-success`, is declared in `globals.css` but never
applied to any element — see Known Issues.

Because motion is CSS-driven it runs on the compositor and keeps animating even
when React re-renders, which matters because the player syncs state every 60ms.

**Category-aware layouts.** Four bottleneck families each get a tailored
composition (`PROBLEM_PLACEMENTS` in `CartoonAnimator.tsx`), so the artwork is
specific rather than generic:

| Category | Hue | Problem visual |
|----------|-----|----------------|
| `quoting_and_order_intake` | rose | A PDF slides off an overflowing inbox onto a spreadsheet that explodes into red cells as the estimator re-types it |
| `field_reporting` | amber | A clipboard of paper job sheets missing half its checks; dispatch phones drivers one by one |
| `scheduling` | rose | Two appointments land on the same slot while three phones ring and the technician is double-booked |
| `cross_system_data` | purple | A copy-paste arrow snaps mid-air between two disconnected systems, so records drift out of sync |

`bottleneckCategory` is embedded in the `VideoScriptOutput` contract specifically
so the renderer always knows which layout to draw, even if the LLM returns no
usable SVG instructions at all.

### The stage is deliberately wordless

An earlier version put three competing text layers on the video — a metaphor
paragraph, a bold caption strip, and a large center headline. They covered the
cartoon and defeated the point of the animation.

The fix was to make the artwork carry the story alone. `CartoonAnimator` renders
**no prose**; the only text in the SVG is a faint corner watermark. All narration
lives in the voiceover and a single lower-third caption owned by `VideoPlayer`.
The largest text on screen is now a ~12px subtitle, down from a ~34px headline.

The text system in `VideoPlayer.tsx`:

- **Top rail** — identity glyph, company name, timecode. No sentences.
- **Lower third** — a color-coded kicker (`Company Snapshot` / `The Bottleneck` /
  `The Velho Fix`), one measured subtitle line, a quantified hook pill, and the
  CTA once the solution lands.
- **Subtitles** — the voiceover split into sentence-sized cues, each timed in
  proportion to its word count by `buildCaptionCues`, so lines advance like real
  broadcast captions instead of dumping a paragraph.

Two gradient scrims (top and bottom) preserve legibility while leaving the middle
of the frame completely clear for the cartoon.

### The audio layer — `lib/audioEngine.ts`

The video has a real soundtrack with **no media files**. `VideoAudioEngine`
synthesizes everything with the Web Audio API at runtime:

- **Ambient chord bed** that shifts harmony per phase — open intro, minor/tense
  problem, bright major resolve. Each tone is a slow-blooming sine/triangle pad
  with a long tail, rendered on a 24-second loop.
- **Sparse bell motif** on top, so it reads as music rather than a drone.
- **Sound effects** — a filtered-noise whoosh on seeks and scene jumps, a low
  sawtooth tension hit when the bottleneck appears, and a rising two-note chime
  when the solution resolves.
- **Sidechain ducking** — the music bed drops to 22% gain while the voiceover
  speaks (`setVoiceActive`), so narration always stays intelligible.

Shipping audio as media files would have bloated the repo and broken the instant-
fallback rule if a fetch failed. Synthesis is instant, weighs nothing, and every
method degrades to a no-op when Web Audio is unavailable.

The context is created inside the play handler (browser autoplay policy requires
a user gesture), and the mute button controls music and speech together.

**Voiceover** is `window.speechSynthesis`, with a preference list that picks a
natural English voice (`samantha`, `google us english`, `microsoft aria`, …) when
one is available. The player re-fires the voiceover when you seek into a scene and
syncs an `onstart`/`onend` pair to duck the music.

---

## 5. Supporting systems

### `lib/scraper.ts` — the Discovery input

Deliberately dependency-free. It fetches the homepage plus five high-signal paths
(`/about`, `/services`, `/solutions`, `/careers`, `/contact` — six URLs total)
with plain HTTP,
strips tags, and extracts brand colors and metadata. No Playwright or Firecrawl
on the hot path — a stage demo cannot afford a headless browser boot.

Budgets: 5s total, 4000 chars per page, 12000 chars combined. It never throws;
it returns `{ ok: false, error }` and Discovery falls back.

### `lib/llm.ts` — the provider layer

A minimal OpenAI-compatible chat-completions client. Works with OpenAI directly
or Groq by swapping base URL and key; Groq is checked first. Includes
`extractJson`, which pulls the first balanced JSON object out of a model response
that may have wrapped it in prose or markdown fences.

It distinguishes three failure modes with typed errors, because they need
different responses:

- `LlmTimeoutError` — hit the 6s deadline
- `LlmNotConfiguredError` — no key at all; the note tells you the exact fix
- plain `Error` — the request failed (bad key, rate limit, 500)

### `types/pipeline.ts` — the contract

Strict types for every agent input and output. `AGENT_ORDER` is the single source
of truth for step ordering. Two type guards (`isPipelineResult`,
`isPipelineError`) exist for narrowing the API response — see Known Issues.

### The API route

`app/api/generate-outreach/route.ts` runs the five steps sequentially, validates
the domain against a regex, and returns `PipelineResult`. The outer `catch` builds
a fully-mocked result with `status: 200` rather than a 500, so the client always
has something to render.

---

## 6. Configuration

Copy `.env.example` to `.env.local` and set **one** key:

```bash
# Option A — Groq (checked first; free tier, fast)
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile

# Option B — OpenAI
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

Without a key the app runs entirely on mock data and shows an amber
**"Fallback used"** badge. With a key it flips to green **"All live"**.

`.env.local` is gitignored.

### Scripts

```bash
npm run dev        # next dev
npm run build      # production build
npm start          # serve the build
npm run typecheck  # tsc --noEmit
```

There is no ESLint config in the repo, so `npm run lint` drops into Next's
interactive setup wizard. Use `npm run typecheck` for verification.

---

## 7. Current state

The project builds clean and typechecks clean under both the pinned TypeScript
(5.9.3) and the current release (7.0.2).

### Verified this session

| Check | Result |
|-------|--------|
| `tsc --noEmit --noUnusedLocals` | clean |
| `next build` | compiles, 5 static pages |
| Pipeline run (no key) | `HTTP 200`, all 5 steps, honest fallback notes |
| Scene spans | `0-6`, `6-24`, `24-45` |
| Cartoon beats | `6s-24s`, `24s-45s` |
| Voiceover word counts | **Exceeds budget — see Known Issues #1** |
| Outbound scrape | `fazer.com` → HTTP 200, 22KB, real content |
| Landing copy | zero "20-second" strings remain |

Note that "verified" for voiceover means the *timeline wiring* (scene boundaries,
beat ranges, total duration) is correct — the *pacing* of the words within those
boundaries is not, as documented in Known Issues #1.

### Not verified

- **Audio output.** The engine was confirmed to construct oscillators and the
  transport reports "Voiceover + score playing", but I did not measure the actual
  master output signal. Worth a listen.
- **Live LLM path.** Every verification run used the mock path (no key present
  on this machine). The 45s word budgets are in the prompt, but the model's
  compliance with them is unproven.

---

## 8. Known issues and dead code

### 1. Voiceover outruns its own word budget (real bug)

The project budgets voiceover at **~2.5 words/second**, and the Video Script
prompt states this explicitly (scene 1 ~14 words, scene 2 ~45, scene 3 ~52). The
mock generator does not honour it. Measured across all four sample domains:

| Domain | Scene 1 (6s) | Scene 2 (18s) | Scene 3 (21s) |
|--------|--------------|---------------|---------------|
| fazer.com | 25w = **4.17 w/s** (+67%) | 62w = 3.44 w/s (+38%) | 60w = 2.86 w/s (+14%) |
| northwindlogistics.com | 28w = **4.67 w/s** (+87%) | 60w = 3.33 w/s (+33%) | 64w = 3.05 w/s (+22%) |
| lumenstack.io | 26w = **4.33 w/s** (+73%) | 56w = 3.11 w/s (+24%) | 54w = 2.57 w/s (+3%) |
| keystoneindustrial.com | 26w = **4.33 w/s** (+73%) | 65w = 3.61 w/s (+44%) | 58w = 2.76 w/s (+10%) |

Overall rate is 3.27 w/s against a 2.5 w/s target.

**Impact.** Scene 1 is the worst offender: 25 words delivered in a 6-second slot
needs ~10s at a natural pace, so the intro voiceover is cut off mid-sentence when
the timeline advances to the problem beat. Scenes 2 and 3 land rushed.

**Where.** `mockVideoScript` in `lib/mockData.ts` — the hand-written scene
voiceovers. The live-model prompt carries the correct budgets, so this affects
the **fallback path specifically** (which is the path that runs on stage without
an API key, i.e. what you see by default).

**Fix.** Trim each scene's voiceover to its budget (15 / 45 / 53 words), or make
`buildCaptionCues` and the scene boundaries derive from the actual word count
rather than a fixed timeline.

### 2. Dead exports — safe to delete

| Symbol | File | Note |
|--------|------|------|
| `withDeadline` | `lib/llm.ts` | Unused; deadlines are handled via `AbortController` |
| `LlmUnavailableError` | `lib/llm.ts` | Superseded by `LlmNotConfiguredError` |
| `isPipelineResult` | `types/pipeline.ts` | Unused type guard |
| `isPipelineError` | `types/pipeline.ts` | Unused type guard |
| `CARTOON_PRESETS` | `lib/cartoonPresets.ts` | Internal `PRESETS` is used directly |

`app/page.tsx` imports `buildMockPipelineOutputs` and leans on the mock layer for
its offline safety net — intentional, not dead code.

### 3. Declared but unused

- `@keyframes velho-flow-success` in `app/globals.css` is never referenced by any
  element. Every other `velho-anim-*` class is applied somewhere in
  `CartoonAnimator.tsx`.

### 4. Other

- No ESLint configuration.
- Upgrading to TypeScript 7 surfaces four pre-existing `TS2882` errors
  (`side-effect import of './globals.css'` and `'server-only'`). These are
  independent of this project's config and relate to how TS 7 handles side-effect
  imports without declarations. Not a regression — confirmed by reproducing them
  with the deprecated `baseUrl` option still present.
- `lib/sceneRenderer.ts` was deleted in favour of the vector `CartoonAnimator.tsx`.
