import type {
  BottleneckCategory,
  CartoonActor,
  CartoonAnimationScene,
  CartoonAnimationType,
  DiscoveryOutput,
  ProblemOutput,
  SolutionOutput,
} from "@/types/pipeline";

/**
 * Category-aware cartoon presets.
 *
 * The Video Agent is asked to author these beats, but on stage the LLM can
 * time out, return junk, or hand back a category we don't recognise. This
 * module is the deterministic floor: every one of the four bottleneck
 * categories maps to a hand-authored problem + solution animation, so a
 * company always gets a specific, on-message cartoon rather than a generic
 * default. Nothing here depends on the network.
 */

export interface CartoonScenePreset {
  actors: CartoonActor[];
  visual_metaphor: string;
  flow_diagram_steps: string[];
  caption: (company: string) => string;
}

export interface CartoonPreset {
  category: BottleneckCategory;
  /** Short label used in the pipeline log / debugging. */
  label: string;
  /** Palette anchor for the problem beat. */
  problemHue: string;
  /** Palette anchor for the solution beat. */
  solutionHue: string;
  problem: CartoonScenePreset;
  solution: CartoonScenePreset;
}

/** Classify an arbitrary domain into one of the four known categories. */
const CATEGORY_KEYWORDS: Record<BottleneckCategory, string[]> = {
  quoting_and_order_intake: [
    "construct",
    "build",
    "trade",
    "roof",
    "plumb",
    "electric",
    "fitout",
    "contract",
    "manu",
    "industr",
    "factory",
    "fabricat",
    "steel",
    "component",
    "supply",
    "mill",
    "quote",
    "quote",
    "bid",
    "tender",
    "order",
  ],
  field_reporting: [
    "logist",
    "freight",
    "transport",
    "haul",
    "cargo",
    "ship",
    "courier",
    "deliver",
    "fleet",
    "field",
    "service",
    "maintenance",
    "inspect",
    "utility",
    "energy",
    "solar",
    "hvac",
  ],
  scheduling: [
    "clinic",
    "health",
    "dental",
    "dent",
    "medical",
    "care",
    "appoint",
    "book",
    "dispatch",
    "crew",
    "staff",
    "roster",
    "shift",
    "salon",
    "spa",
    "hospitality",
    "restaurant",
    "venue",
    "repair",
    "install",
  ],
  cross_system_data: [
    "tech",
    "soft",
    "app",
    "cloud",
    "data",
    "ai",
    "digital",
    "saas",
    "io",
    "dev",
    "code",
    "platform",
    "consult",
    "advis",
    "legal",
    "law",
    "account",
    "financ",
    "capital",
    "audit",
    "tax",
    "partner",
    "group",
  ],
};

/* ------------------------------------------------------------------ */
/* Reusable actor builders                                             */
/* ------------------------------------------------------------------ */

const actor = (
  name: string,
  icon: string,
  animation_type: CartoonAnimationType,
): CartoonActor => ({ name, icon, animation_type });

/* ------------------------------------------------------------------ */
/* The four fallback layouts                                           */
/* ------------------------------------------------------------------ */

const PRESETS: Record<BottleneckCategory, CartoonPreset> = {
  /* 1. Animated PDF invoice moving into an exploding spreadsheet. */
  quoting_and_order_intake: {
    category: "quoting_and_order_intake",
    label: "Quoting & Order Intake",
    problemHue: "#F43F5E",
    solutionHue: "#10B981",
    problem: {
      actors: [
        actor("Inbound RFQ PDF", "FileText", "shake"),
        actor("Manual Spreadsheet", "FileSpreadsheet", "pulse"),
        actor("Stressed Estimator", "UserX", "bounce"),
      ],
      visual_metaphor:
        "A PDF invoice slides off an overflowing inbox and lands on a spreadsheet that explodes into red cells as the estimator re-types it by hand.",
      flow_diagram_steps: [
        "Unstructured Email",
        "-->",
        "Manual Copy-Paste",
        "-->",
        "Exploding Spreadsheet",
      ],
      caption: (company) => `${company} re-types every quote by hand`,
    },
    solution: {
      actors: [
        actor("Velho AI Engine", "Cog", "spin_gear"),
        actor("Parsed Line Items", "ListChecks", "slide_in"),
        actor("ERP Quote Entry", "CircleDollarSign", "fade_red_to_green"),
      ],
      visual_metaphor:
        "The same PDF feeds into the Velho AI gear, which emits priced line items straight into the ERP with green checkmarks — no typing.",
      flow_diagram_steps: [
        "RFQ PDF",
        "-->",
        "Velho AI Engine",
        "-->",
        "Priced ERP Quote",
      ],
      caption: () => "Quotes built and priced in minutes, not days",
    },
  },

  /* 2. Animated clipboard with red missing checks -> auto-generated reports. */
  field_reporting: {
    category: "field_reporting",
    label: "Field Reporting",
    problemHue: "#FB923C",
    solutionHue: "#10B981",
    problem: {
      actors: [
        actor("Paper Job Sheet", "ClipboardX", "shake"),
        actor("Missing Field Checks", "AlertTriangle", "pulse"),
        actor("Dispatcher on the Phone", "PhoneCall", "bounce"),
      ],
      visual_metaphor:
        "A clipboard of paper job sheets is missing half its checks and has flown off-site; dispatch phones drivers one by one to find out what happened.",
      flow_diagram_steps: [
        "Paper Job Sheet",
        "-->",
        "Missing Checks",
        "-->",
        "Dispatch Chases by Phone",
      ],
      caption: (company) => `${company} learns job status by phone calls`,
    },
    solution: {
      actors: [
        actor("Two-Tap Mobile Capture", "Smartphone", "slide_in"),
        actor("Velho AI Engine", "Cog", "spin_gear"),
        actor("Auto-Generated Report", "ClipboardCheck", "fade_red_to_green"),
      ],
      visual_metaphor:
        "Drivers confirm a job in two taps on the phone; the Velho engine validates the capture and auto-generates a complete, timelined report.",
      flow_diagram_steps: [
        "Two-Tap Capture",
        "-->",
        "Velho AI Engine",
        "-->",
        "Live Report & Invoice",
      ],
      caption: () => "Complete field reports, generated the moment the job ends",
    },
  },

  /* 3. Animated calendar with overlapping ringing phones -> auto-dispatched routes. */
  scheduling: {
    category: "scheduling",
    label: "Scheduling & Dispatch",
    problemHue: "#F43F5E",
    solutionHue: "#0EA5E9",
    problem: {
      actors: [
        actor("Overlapping Calendar", "CalendarX", "shake"),
        actor("Ringing Phones", "BellRing", "shake"),
        actor("Double-Booked Tech", "UserX", "bounce"),
      ],
      visual_metaphor:
        "Two appointments land on the same slot while three phones ring at once; the technician is double-booked and nobody knows which job wins.",
      flow_diagram_steps: [
        "Booking Request",
        "-->",
        "Phone Tag & Overlaps",
        "-->",
        "Double-Booked Crew",
      ],
      caption: (company) => `${company} books jobs on top of each other`,
    },
    solution: {
      actors: [
        actor("Velho AI Engine", "Cog", "spin_gear"),
        actor("Auto-Dispatched Route", "Route", "slide_in"),
        actor("Confirmed Calendar", "CalendarCheck", "fade_red_to_green"),
      ],
      visual_metaphor:
        "Bookings flow into the Velho engine, which resolves conflicts and pushes a sequenced, confirmed route straight to the crew's calendar.",
      flow_diagram_steps: [
        "Booking Request",
        "-->",
        "Velho AI Engine",
        "-->",
        "Auto-Dispatched Route",
      ],
      caption: () => "Routes dispatched automatically, zero double-bookings",
    },
  },

  /* 4. Animated copy-paste arrow breaking between two disconnected systems. */
  cross_system_data: {
    category: "cross_system_data",
    label: "Cross-System Data",
    problemHue: "#A855F7",
    solutionHue: "#0EA5E9",
    problem: {
      actors: [
        actor("System A (ERP)", "Database", "pulse"),
        actor("Broken Copy-Paste Arrow", "Copy", "shake"),
        actor("System B (CRM)", "Server", "pulse"),
      ],
      visual_metaphor:
        "A copy-paste arrow snaps in mid-air between two disconnected systems, so the same record is re-keyed by hand and drifts out of sync.",
      flow_diagram_steps: [
        "System A Record",
        "-->",
        "Broken Copy-Paste",
        "-->",
        "System B Mismatch",
      ],
      caption: (company) => `${company} re-keys the same record twice`,
    },
    solution: {
      actors: [
        actor("Velho AI Engine", "Cog", "spin_gear"),
        actor("Synced Record", "RefreshCw", "slide_in"),
        actor("Connected Systems", "Network", "fade_red_to_green"),
      ],
      visual_metaphor:
        "The validated record flows through the Velho engine and writes itself into both systems at once, so every side shows the same green tick.",
      flow_diagram_steps: [
        "System A Record",
        "-->",
        "Velho AI Engine",
        "-->",
        "Synced Everywhere",
      ],
      caption: () => "One record, written everywhere, always in sync",
    },
  },
};

export const CARTOON_PRESETS = PRESETS;

/* ------------------------------------------------------------------ */
/* Classification                                                      */
/* ------------------------------------------------------------------ */

/** Deterministic fallback order when no keyword matches a domain. */
const CATEGORY_SEQUENCE: readonly BottleneckCategory[] = [
  "cross_system_data",
  "quoting_and_order_intake",
  "field_reporting",
  "scheduling",
];

const simpleHash = (input: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
};

/**
 * Map free text (domain, bottleneck title, symptoms) onto a category.
 *
 * Resolution order:
 *   1. keyword scoring across the four families,
 *   2. the caller's `fallbackCategory` (e.g. the matched domain archetype),
 *   3. a stable hash so a given domain always lands on the same layout
 *      instead of reshuffling between runs.
 */
export const classifyBottleneck = (
  texts: Array<string | undefined | null>,
  seedKey = "",
  fallbackCategory?: BottleneckCategory,
): BottleneckCategory => {
  const haystack = texts
    .filter((text): text is string => typeof text === "string")
    .join(" ")
    .toLowerCase();

  let best: BottleneckCategory | null = null;
  let bestScore = 0;

  for (const category of Object.keys(CATEGORY_KEYWORDS) as BottleneckCategory[]) {
    let score = 0;
    for (const keyword of CATEGORY_KEYWORDS[category]) {
      if (haystack.includes(keyword)) score += keyword.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }

  if (best) return best;
  if (fallbackCategory) return fallbackCategory;
  return CATEGORY_SEQUENCE[simpleHash(seedKey) % CATEGORY_SEQUENCE.length]!;
};

export const isBottleneckCategory = (
  value: unknown,
): value is BottleneckCategory =>
  typeof value === "string" &&
  Object.prototype.hasOwnProperty.call(PRESETS, value);

/* ------------------------------------------------------------------ */
/* Scene builders (always valid, always specific)                      */
/* ------------------------------------------------------------------ */

export interface CartoonTimeline {
  problemStart: number;
  problemEnd: number;
  solutionStart: number;
  solutionEnd: number;
  bookingStart: number;
  bookingEnd: number;
}

/** Fixed 45s beat map: intro (0-6), problem (6-24), solution (24-38), book (38-45). */
export const CARTOON_TIMELINE: CartoonTimeline = {
  problemStart: 6,
  problemEnd: 24,
  solutionStart: 24,
  solutionEnd: 38,
  bookingStart: 38,
  bookingEnd: 45,
};

/** Total runtime of the personalized video, in seconds. */
export const VIDEO_DURATION_SEC = CARTOON_TIMELINE.bookingEnd;

export const buildCartoonScenes = (
  category: BottleneckCategory,
  companyName: string,
  timeline: CartoonTimeline = CARTOON_TIMELINE,
): CartoonAnimationScene[] => {
  const preset = PRESETS[category];

  return [
    {
      scene_index: 1,
      time_range: `${timeline.problemStart}s-${timeline.problemEnd}s`,
      type: "problem_animation",
      actors: preset.problem.actors,
      visual_metaphor: preset.problem.visual_metaphor,
      flow_diagram_steps: preset.problem.flow_diagram_steps,
      text_caption: preset.problem.caption(companyName),
    },
    {
      scene_index: 2,
      time_range: `${timeline.solutionStart}s-${timeline.solutionEnd}s`,
      type: "solution_animation",
      actors: preset.solution.actors,
      visual_metaphor: preset.solution.visual_metaphor,
      flow_diagram_steps: preset.solution.flow_diagram_steps,
      text_caption: preset.solution.caption(companyName),
    },
  ];
};

/**
 * One-call resolver used by both the mock and the live agent path: classify
 * the bottleneck, then build the two beats for it.
 */
export const resolveCartoonStoryboard = (
  seedKey: string,
  companyName: string,
  texts: Array<string | undefined | null>,
  fallbackCategory?: BottleneckCategory,
): { category: BottleneckCategory; scenes: CartoonAnimationScene[] } => {
  const category = classifyBottleneck(texts, seedKey, fallbackCategory);
  return {
    category,
    scenes: buildCartoonScenes(category, companyName),
  };
};

/* Keeps the domain types imported above meaningful for consumers of the
 * storyboard helpers. */
export type CartoonStoryboardInputs = {
  discovery: DiscoveryOutput;
  problem: ProblemOutput;
  solution: SolutionOutput;
};
