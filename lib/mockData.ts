import type {
  DiscoveryOutput,
  EmailOutput,
  ProblemOutput,
  SolutionOutput,
  VideoScriptOutput,
} from "@/types/pipeline";

/* ------------------------------------------------------------------ */
/* Deterministic helpers                                               */
/* ------------------------------------------------------------------ */

/**
 * Stable 32-bit hash so the same domain always produces the same mock.
 * A live demo that reshuffles on every re-run looks broken.
 */
export const hashString = (input: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
};

export const normalizeDomain = (raw: string): string => {
  const trimmed = raw.trim().toLowerCase();
  const withoutScheme = trimmed.replace(/^https?:\/\//, "");
  const withoutWww = withoutScheme.replace(/^www\./, "");
  return withoutPath(withoutWww);
};

const withoutPath = (value: string): string => {
  const slash = value.indexOf("/");
  return slash === -1 ? value : value.slice(0, slash);
};

const pick = <T,>(items: readonly T[], seed: number, offset = 0): T => {
  const index = (seed + offset * 7919) % items.length;
  // Safe: index is always within bounds for a non-empty array.
  return items[index] as T;
};

export const titleCase = (value: string): string =>
  value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/**
 * Common second halves of squashed brand domains. "northwindlogistics" reads
 * as "Northwind Logistics" instead of "Northwindlogistics", which matters
 * because the company name is rendered in the video and the CEO email.
 */
const COMPOUND_SUFFIXES = [
  "logistics",
  "industrial",
  "systems",
  "solutions",
  "services",
  "software",
  "labs",
  "stack",
  "works",
  "group",
  "partners",
  "digital",
  "tech",
  "data",
  "cloud",
  "health",
  "energy",
  "capital",
  "media",
  "robotics",
  "automation",
  "manufacturing",
] as const;

/** Derive a human company name from a domain: "fazer.com" -> "Fazer". */
export const companyNameFromDomain = (domain: string): string => {
  const base = (domain.split(".")[0] ?? domain).replace(/[^a-z0-9]/gi, "");

  for (const suffix of COMPOUND_SUFFIXES) {
    if (base.length > suffix.length + 2 && base.endsWith(suffix)) {
      const head = base.slice(0, base.length - suffix.length);
      return `${titleCase(head)} ${titleCase(suffix)}`;
    }
  }

  return titleCase(base);
};

/* ------------------------------------------------------------------ */
/* Domain archetypes                                                   */
/* ------------------------------------------------------------------ */

type Archetype = {
  id: string;
  industry: string;
  tagline: (name: string) => string;
  businessModel: (name: string) => string;
  offerings: string[];
  markets: string[];
  palette: DiscoveryOutput["brand"]["palette"];
  glyph: string;
  tone: string;
  operationalSignals: string[];
  problem: {
    title: string;
    summary: (name: string) => string;
    department: string;
    symptoms: string[];
    brokenSystems: string[];
    risk: string;
  };
  solution: {
    architectureName: (name: string) => string;
    summary: (name: string) => string;
    steps: { title: string; description: (name: string) => string; velhoCapability: string; outcome: string }[];
    integrations: string[];
  };
  scenes: { title: string; graphicCue: string; icon: string }[];
};

const ARCHETYPES: readonly Archetype[] = [
  {
    id: "construction",
    industry: "Construction & Specialty Contracting",
    tagline: (n) => `${n} builds on schedule — with quotes that land in hours, not days.`,
    businessModel: (n) =>
      `${n} wins commercial fit-out and specialty trade work through competitive tender. Revenue comes from project margin, so bid volume and quote turnaround speed directly set annual throughput.`,
    offerings: ["Commercial fit-out", "Design-build delivery", "Facility maintenance", "Emergency callouts"],
    markets: ["Regional metro", "Multi-site retail", "Industrial parks"],
    palette: { primary: "#F59E0B", secondary: "#B45309", accent: "#FDE68A" },
    glyph: "🏗️",
    tone: "Direct, safety-first, schedule-obsessed",
    operationalSignals: [
      "Careers page lists a 'Estimating Coordinator' with manual takeoff duties",
      "Project gallery shows 40+ active sites per region",
      "No customer portal — enquiries route to a generic info@ inbox",
    ],
    problem: {
      title: "Manual Quote Intake Bottleneck",
      summary: (n) =>
        `${n}'s estimating team rebuilds every bid from scratch in spreadsheets, so quote turnaround is gated by whoever has spare hours.`,
      department: "Estimating & Preconstruction",
      symptoms: [
        "RFQ PDFs arrive by email and get re-typed into Excel",
        "Scope takeoffs are duplicated between estimating and site teams",
        "Quote revisions live in attachments, not a single source of truth",
      ],
      brokenSystems: ["Outlook inbox", "Excel takeoff sheets", "Sage/QuickBooks", "Site photo galleries"],
      risk: "Bids slip past the client's decision window and margin erodes on rushed numbers.",
    },
    solution: {
      architectureName: (n) => `${n} Bid Engine`,
      summary: (n) =>
        `Velho turns every inbound RFQ into a structured, priced draft quote in minutes, so ${n}'s estimators review instead of rebuild.`,
      steps: [
        {
          title: "Capture",
          description: (n) => `Inbound RFQ emails, drawings and site photos for ${n} are ingested automatically and parsed into structured scope line items.`,
          velhoCapability: "Document Intelligence",
          outcome: "Zero manual re-typing of RFQ content",
        },
        {
          title: "Price",
          description: () => "Historical win/loss data plus live supplier rates generate a costed draft with margin guardrails applied.",
          velhoCapability: "Decision Automation",
          outcome: "Draft quote ready in under 10 minutes",
        },
        {
          title: "Approve & Send",
          description: () => "Estimators get a one-screen review, then the branded quote is issued and tracked until the client responds.",
          velhoCapability: "Workflow Orchestration",
          outcome: "Same-day turnaround on standard bids",
        },
      ],
      integrations: ["Outlook / Microsoft 365", "Sage 200", "Procore", "Dropbox"],
    },
    scenes: [
      { title: "Your bids are waiting on a spreadsheet", graphicCue: "Inbox stacking with PDF attachments", icon: "FileStack" },
      { title: "Velho reads every RFQ instantly", graphicCue: "Document parsing into structured line items", icon: "ScanLine" },
      { title: "Same-day quotes, better margin", graphicCue: "Timeline compressing with margin gauge", icon: "TrendingUp" },
    ],
  },
  {
    id: "logistics",
    industry: "Logistics & Field Service",
    tagline: (n) => `${n} moves freight on time — and finally knows where every job stands.`,
    businessModel: (n) =>
      `${n} earns on per-load and per-visit margin. Profitability depends on dispatch density and eliminating the dead time between a completed job and a billable invoice.`,
    offerings: ["Regional freight", "Dedicated routes", "Last-mile delivery", "On-site servicing"],
    markets: ["Regional corridors", "E-commerce fulfilment", "Manufacturing inbound"],
    palette: { primary: "#0EA5E9", secondary: "#0369A1", accent: "#7DD3FC" },
    glyph: "🚚",
    tone: "Operational, no-nonsense, uptime-driven",
    operationalSignals: [
      "Drivers submit job sheets as photos at end of shift",
      "Dispatch board is a shared whiteboard plus group chat",
      "Billing reconciles proof-of-delivery three weeks late",
    ],
    problem: {
      title: "Field Reporting Gap",
      summary: (n) =>
        `Job completion data for ${n} arrives hours late and half-illegible, so dispatch, billing and customers all work from stale information.`,
      department: "Dispatch & Field Operations",
      symptoms: [
        "Proof-of-delivery photos sit in personal phones overnight",
        "Dispatchers call drivers for status instead of seeing it",
        "Invoices go out weeks after the job is done",
      ],
      brokenSystems: ["Paper job sheets", "WhatsApp group chat", "Legacy TMS", "Accounting export"],
      risk: "Unbilled work, missed SLAs and customer churn to a competitor with live tracking.",
    },
    solution: {
      architectureName: (n) => `${n} Live Ops Layer`,
      summary: (n) =>
        `Velho closes the loop between the field and the back office so ${n} bills on completion, not on paperwork.`,
      steps: [
        {
          title: "Capture in the field",
          description: (n) => `${n}'s drivers confirm jobs in a two-tap mobile flow that works offline and syncs when signal returns.`,
          velhoCapability: "Mobile Capture",
          outcome: "Job status visible in real time",
        },
        {
          title: "Reconcile automatically",
          description: () => "Proof-of-delivery is matched to the load record and exceptions are flagged before they become disputes.",
          velhoCapability: "Document Intelligence",
          outcome: "Billing triggered within minutes of completion",
        },
        {
          title: "Bill and alert",
          description: () => "Invoices issue automatically and customers receive proactive status updates without a dispatcher lifting a phone.",
          velhoCapability: "Workflow Orchestration",
          outcome: "Invoice cycle cut from 21 days to 2",
        },
      ],
      integrations: ["Legacy TMS", "Xero", "Twilio SMS", "Google Maps Platform"],
    },
    scenes: [
      { title: "Your dispatch board is a group chat", graphicCue: "Scattered chat bubbles over a route map", icon: "MessageSquareWarning" },
      { title: "Velho captures the job at the door", graphicCue: "Mobile two-tap confirm with GPS pin", icon: "MapPin" },
      { title: "Bill the same day, every day", graphicCue: "Invoice generated beside completed route", icon: "Receipt" },
    ],
  },
  {
    id: "saas",
    industry: "B2B SaaS & Technology",
    tagline: (n) => `${n} ships software fast — onboarding should move just as fast.`,
    businessModel: (n) =>
      `${n} sells recurring subscriptions with a land-and-expand motion. Growth is constrained by implementation time and the manual work needed to get each new account live.`,
    offerings: ["Platform subscription", "Implementation services", "Premium support", "API access"],
    markets: ["Mid-market", "Enterprise", "Partner channel"],
    palette: { primary: "#8B5CF6", secondary: "#5B21B6", accent: "#C4B5FD" },
    glyph: "⚡",
    tone: "Product-led, precise, metrics-driven",
    operationalSignals: [
      "Solutions engineers maintain a 40-row onboarding tracker in Sheets",
      "Implementation runbooks are duplicated per customer",
      "Support tickets reference screenshots instead of telemetry",
    ],
    problem: {
      title: "Manual Onboarding Drag",
      summary: (n) =>
        `Every ${n} implementation is a bespoke chain of spreadsheet checklists, so time-to-first-value stretches and expansion revenue stalls.`,
      department: "Customer Success & Implementation",
      symptoms: [
        "Onboarding status lives in a spreadsheet nobody trusts",
        "Solutions engineers re-answer the same configuration questions",
        "Time-to-first-value is measured anecdotally, not tracked",
      ],
      brokenSystems: ["Google Sheets tracker", "Jira", "HubSpot", "Slack support channels"],
      risk: "Slow activation suppresses net revenue retention and invites churn at renewal.",
    },
    solution: {
      architectureName: (n) => `${n} Activation Engine`,
      summary: (n) =>
        `Velho turns ${n}'s implementation playbook into an automated, observable pipeline that runs itself.`,
      steps: [
        {
          title: "Ingest the deal",
          description: (n) => `Closed-won data from ${n}'s CRM automatically provisions the onboarding workspace with the right checklist.`,
          velhoCapability: "System Integration",
          outcome: "Zero manual workspace setup",
        },
        {
          title: "Guide the build",
          description: () => "Each configuration step is sequenced with in-app guidance and blockers surfaced to the right engineer instantly.",
          velhoCapability: "Process Automation",
          outcome: "Onboarding handoffs eliminated",
        },
        {
          title: "Prove activation",
          description: () => "First-value milestones are tracked automatically and feed straight into the retention dashboard.",
          velhoCapability: "Analytics Layer",
          outcome: "Time-to-first-value cut by 60%",
        },
      ],
      integrations: ["Salesforce / HubSpot", "Jira", "Slack", "Snowflake"],
    },
    scenes: [
      { title: "Onboarding lives in a spreadsheet", graphicCue: "Grid of rows, one cell glowing red", icon: "TableProperties" },
      { title: "Velho runs the playbook for you", graphicCue: "Automated checklist ticking in sequence", icon: "ListChecks" },
      { title: "Activation in days, not quarters", graphicCue: "Retention curve bending upward", icon: "LineChart" },
    ],
  },
  {
    id: "manufacturing",
    industry: "Manufacturing & Industrial Supply",
    tagline: (n) => `${n} runs the line — the paperwork shouldn't run the plant.`,
    businessModel: (n) =>
      `${n} produces to order and to stock, earning on throughput and yield. Margin is set by how tightly order intake, scheduling and quality data stay in sync.`,
    offerings: ["Contract manufacturing", "Custom components", "Assembly", "Quality testing"],
    markets: ["OEM supply", "Aftermarket parts", "Export contracts"],
    palette: { primary: "#10B981", secondary: "#047857", accent: "#6EE7B7" },
    glyph: "🏭",
    tone: "Precise, compliance-aware, throughput-focused",
    operationalSignals: [
      "Order intake arrives as PDFs and is keyed into the ERP by hand",
      "Quality checks are logged on clipboards then typed up",
      "Scheduling runs on a whiteboard next to the shop floor",
    ],
    problem: {
      title: "Cross-System Data Entry",
      summary: (n) =>
        `The same order data is typed into three systems at ${n}, so errors surface on the shop floor instead of at intake.`,
      department: "Order Management & Quality",
      symptoms: [
        "Order details are keyed into ERP, MES and a scheduling sheet",
        "Quality non-conformances are discovered days after the run",
        "Expedite requests bypass the plan entirely",
      ],
      brokenSystems: ["ERP (SAP/Epicor)", "MES", "Paper QC logs", "Whiteboard scheduler"],
      risk: "Rework, missed ship dates and compliance exposure on audited contracts.",
    },
    solution: {
      architectureName: (n) => `${n} Order Integrity Layer`,
      summary: (n) =>
        `Velho reads incoming orders once and writes them everywhere, so ${n}'s floor runs on accurate data from minute one.`,
      steps: [
        {
          title: "Parse once",
          description: (n) => `Inbound POs and drawings for ${n} are converted into a validated order record with mismatches flagged.`,
          velhoCapability: "Document Intelligence",
          outcome: "Single source of order truth",
        },
        {
          title: "Sync everywhere",
          description: () => "The validated record propagates to ERP, MES and the schedule without a single re-key.",
          velhoCapability: "System Integration",
          outcome: "Entry errors eliminated at source",
        },
        {
          title: "Catch drift early",
          description: () => "Live QC capture flags deviations during the run, not after the parts have shipped.",
          velhoCapability: "Quality Analytics",
          outcome: "Rework reduced by 35%",
        },
      ],
      integrations: ["SAP / Epicor", "Ignition SCADA", "NetSuite", "SharePoint"],
    },
    scenes: [
      { title: "The same order, typed three times", graphicCue: "One PO branching into three terminal screens", icon: "CopyX" },
      { title: "Velho writes it once, everywhere", graphicCue: "Single record syncing across system nodes", icon: "Network" },
      { title: "Ship on time, audit-clean", graphicCue: "QC dashboard green across the board", icon: "BadgeCheck" },
    ],
  },
  {
    id: "professional-services",
    industry: "Professional & Financial Services",
    tagline: (n) => `${n} advises clients on their time — so let Velho give yours back.`,
    businessModel: (n) =>
      `${n} bills on time and materials or fixed-fee engagement. Realization rate is everything, and it drops every time a professional does admin instead of advisory work.`,
    offerings: ["Advisory engagements", "Compliance & audit", "Managed services", "Retainer support"],
    markets: ["SME clients", "Corporate accounts", "Regulated sectors"],
    palette: { primary: "#6366F1", secondary: "#4338CA", accent: "#A5B4FC" },
    glyph: "📊",
    tone: "Credible, detail-oriented, relationship-led",
    operationalSignals: [
      "Client onboarding requires 12 documents collected by email",
      "Engagement letters are edited per client from old Word files",
      "Time capture happens weekly, from memory",
    ],
    problem: {
      title: "Billable Time Leaking to Admin",
      summary: (n) =>
        `Senior people at ${n} spend a third of the week on document chasing and status updates instead of chargeable advisory work.`,
      department: "Client Delivery & Operations",
      symptoms: [
        "Document collection chased manually over multiple emails",
        "Engagement letters rebuilt from stale templates",
        "Weekly timesheets reconstructed from memory",
      ],
      brokenSystems: ["Outlook", "SharePoint", "Practice management system", "Word templates"],
      risk: "Realization rate slides while utilization looks healthy, hiding margin loss.",
    },
    solution: {
      architectureName: (n) => `${n} Client Ops Engine`,
      summary: (n) =>
        `Velho automates the document-heavy edges of ${n}'s engagements so partners stay in advisory work.`,
      steps: [
        {
          title: "Collect",
          description: (n) => `${n}'s client document requests chase themselves, with automatic reminders and a live completion view.`,
          velhoCapability: "Workflow Automation",
          outcome: "Client onboarding time cut by 70%",
        },
        {
          title: "Draft",
          description: () => "Engagement letters and reports assemble from approved templates with client data already populated.",
          velhoCapability: "Document Generation",
          outcome: "Zero blank-page drafting",
        },
        {
          title: "Capture",
          description: () => "Time entries are inferred from calendar and activity, then confirmed in a single weekly review.",
          velhoCapability: "Ambient Capture",
          outcome: "Realization rate up 9 points",
        },
      ],
      integrations: ["Microsoft 365", "Clio / Practice Engine", "DocuSign", "Xero"],
    },
    scenes: [
      { title: "Your best people are chasing PDFs", graphicCue: "Senior advisor buried in email threads", icon: "MailSearch" },
      { title: "Velho handles the document trail", graphicCue: "Auto-chasing checklist with green ticks", icon: "FileCheck2" },
      { title: "More advisory. Better realization.", graphicCue: "Billable ratio bar filling up", icon: "Percent" },
    ],
  },
];

const ARCHETYPE_KEYWORDS: Record<string, string[]> = {
  construction: ["build", "construct", "contract", "trade", "roof", "plumb", "electric", "fitout", "fazer", "property", "homes", "realty"],
  logistics: ["logist", "freight", "transport", "haul", "cargo", "ship", "courier", "deliver", "fleet", "move"],
  saas: ["tech", "soft", "app", "cloud", "data", "ai", "digital", "saas", "io", "dev", "code", "platform"],
  manufacturing: ["manu", "industr", "factory", "fabricat", "steel", "plastic", "machine", "component", "supply", "mill"],
  "professional-services": ["consult", "advis", "legal", "law", "account", "financ", "capital", "audit", "tax", "partner", "group"],
};

export const selectArchetype = (domain: string): Archetype => {
  const seed = hashString(domain);
  for (const [id, keywords] of Object.entries(ARCHETYPE_KEYWORDS)) {
    if (keywords.some((keyword) => domain.includes(keyword))) {
      const match = ARCHETYPES.find((a) => a.id === id);
      if (match) return match;
    }
  }
  return pick(ARCHETYPES, seed);
};

/* ------------------------------------------------------------------ */
/* Mock generators — one per agent                                     */
/* ------------------------------------------------------------------ */

export const mockDiscovery = (domain: string): DiscoveryOutput => {
  const archetype = selectArchetype(domain);
  const seed = hashString(domain);
  const companyName = companyNameFromDomain(domain);
  const sizeBands = ["10-50", "50-200", "200-500", "500-1,000"] as const;

  return {
    domain,
    companyName,
    tagline: archetype.tagline(companyName),
    businessModel: archetype.businessModel(companyName),
    industry: archetype.industry,
    companySize: pick(sizeBands, seed, 3),
    markets: archetype.markets,
    operationalSignals: archetype.operationalSignals,
    offerings: archetype.offerings,
    brand: {
      palette: archetype.palette,
      glyph: archetype.glyph,
      tone: archetype.tone,
    },
  };
};

export const mockProblem = (domain: string): ProblemOutput => {
  const archetype = selectArchetype(domain);
  const companyName = companyNameFromDomain(domain);
  const seed = hashString(domain);
  const severities = ["high", "critical", "high", "medium"] as const;
  const hoursLost = 18 + (seed % 26);

  return {
    title: archetype.problem.title,
    summary: archetype.problem.summary(companyName),
    severity: pick(severities, seed, 5),
    department: archetype.problem.department,
    symptoms: archetype.problem.symptoms,
    impact: {
      hoursLostPerWeek: hoursLost,
      estimatedCost: `$${(hoursLost * 0.42).toFixed(0)}k/yr in lost capacity`,
      risk: archetype.problem.risk,
    },
    brokenSystems: archetype.problem.brokenSystems,
  };
};

export const mockSolution = (domain: string): SolutionOutput => {
  const archetype = selectArchetype(domain);
  const companyName = companyNameFromDomain(domain);
  const seed = hashString(domain);
  const deltas = ["12x faster", "9x faster", "14x faster", "7x faster"] as const;

  return {
    architectureName: archetype.solution.architectureName(companyName),
    summary: archetype.solution.summary(companyName),
    steps: archetype.solution.steps.map((step, index) => ({
      order: index + 1,
      title: step.title,
      description: step.description(companyName),
      velhoCapability: step.velhoCapability,
      outcome: step.outcome,
    })),
    headlineMetric: {
      label: archetype.problem.title,
      value: `${100 - (seed % 70)}% manual effort removed`,
      delta: pick(deltas, seed, 2),
    },
    integrations: archetype.solution.integrations,
    timeToValue: `${2 + (seed % 3)} weeks to production`,
  };
};

export const mockVideoScript = (domain: string): VideoScriptOutput => {
  const archetype = selectArchetype(domain);
  const companyName = companyNameFromDomain(domain);
  const problem = archetype.problem;

  const scenes = [
    {
      id: 1,
      startSec: 0,
      endSec: 7,
      title: archetype.scenes[0]?.title ?? "The bottleneck",
      voiceover: `${companyName}, here's what we noticed. ${problem.summary(companyName)}`,
      overlays: [
        { text: companyName, position: "top" as const, emphasis: "secondary" as const },
        { text: problem.title, position: "center" as const, emphasis: "primary" as const },
        { text: "This is costing you capacity every week.", position: "bottom" as const, emphasis: "accent" as const },
      ],
      graphicCue: archetype.scenes[0]?.graphicCue ?? "Problem visual",
      icon: archetype.scenes[0]?.icon ?? "AlertTriangle",
      transition: "fade" as const,
    },
    {
      id: 2,
      startSec: 7,
      endSec: 14,
      title: archetype.scenes[1]?.title ?? "The solution",
      voiceover: `Velho fixes this with ${archetype.solution.architectureName(companyName)}. ${archetype.solution.steps[0]?.outcome ?? "Automated intake"}. No new system to learn.`,
      overlays: [
        { text: "The Velho fix", position: "top" as const, emphasis: "secondary" as const },
        { text: archetype.solution.architectureName(companyName), position: "center" as const, emphasis: "primary" as const },
        { text: archetype.solution.steps[0]?.outcome ?? "Automated intake", position: "bottom" as const, emphasis: "accent" as const },
      ],
      graphicCue: archetype.scenes[1]?.graphicCue ?? "Solution visual",
      icon: archetype.scenes[1]?.icon ?? "Sparkles",
      transition: "slide" as const,
    },
    {
      id: 3,
      startSec: 14,
      endSec: 20,
      title: archetype.scenes[2]?.title ?? "The outcome",
      voiceover: `${archetype.solution.steps[2]?.outcome ?? "Measurable results"} in ${2 + (hashString(domain) % 3)} weeks. We built a working prototype for ${companyName}. Want to see it?`,
      overlays: [
        { text: "The result", position: "top" as const, emphasis: "secondary" as const },
        { text: archetype.solution.steps[2]?.outcome ?? "Measurable results", position: "center" as const, emphasis: "primary" as const },
        { text: "Prototype ready — reply to see it live.", position: "bottom" as const, emphasis: "accent" as const },
      ],
      graphicCue: archetype.scenes[2]?.graphicCue ?? "Outcome visual",
      icon: archetype.scenes[2]?.icon ?? "TrendingUp",
      transition: "zoom" as const,
    },
  ];

  return {
    durationSec: 20,
    headline: archetype.tagline(companyName),
    scenes,
    voiceStyle: "Confident, warm, unhurried. Pause after the problem statement.",
  };
};

export const mockEmail = (
  domain: string,
  videoUrl?: string,
): EmailOutput => {
  const archetype = selectArchetype(domain);
  const companyName = companyNameFromDomain(domain);
  const problem = archetype.problem;
  const url =
    videoUrl ?? `https://velho.ai/v/${encodeURIComponent(domain)}`;

  const bodySentences = [
    `I looked at ${companyName}'s ${archetype.problem.department.toLowerCase()} workflow and found something worth 30 seconds of your time: ${problem.title.toLowerCase()}.`,
    `Right now ${problem.symptoms[0]?.toLowerCase() ?? "the process runs manually"}, which is quietly costing roughly ${problem.brokenSystems.length * 9} hours a week across the team.`,
    `We built ${archetype.solution.architectureName(companyName)} — ${archetype.solution.steps[0]?.outcome.toLowerCase() ?? "automated intake"} — and it runs on the systems you already have.`,
    `I recorded a 20-second walkthrough using ${companyName}'s own workflow, not a generic demo: ${url}`,
  ];

  const callToAction =
    "If it's useful, reply with a time this week and I'll walk you through the live version.";

  const signoff = "— Velho Applied Intelligence";

  const plainText = [
    `Subject: ${problem.title} at ${companyName} — 20 second video`,
    "",
    `Hi ${companyName} team,`,
    "",
    ...bodySentences,
    "",
    callToAction,
    "",
    signoff,
  ].join("\n");

  return {
    recipientRole: "CEO",
    subject: `${problem.title} at ${companyName} — 20 second video`,
    greeting: `Hi ${companyName} team,`,
    bodySentences,
    callToAction,
    signoff,
    videoUrl: url,
    plainText,
  };
};

/* ------------------------------------------------------------------ */
/* Whole-pipeline mock (instant, never throws)                         */
/* ------------------------------------------------------------------ */

export const buildMockPipelineOutputs = (domain: string) => {
  const videoScript = mockVideoScript(domain);
  return {
    discovery: mockDiscovery(domain),
    problem: mockProblem(domain),
    solution: mockSolution(domain),
    videoScript,
    email: mockEmail(domain),
  };
};

/** Example domains offered as one-click chips in the UI. */
export const SAMPLE_DOMAINS = [
  "fazer.com",
  "northwindlogistics.com",
  "lumenstack.io",
  "keystoneindustrial.com",
] as const;
