import type {
  CartoonActor,
  CartoonAnimationScene,
  CartoonAnimationType,
  ProblemOutput,
  SolutionOutput,
} from "@/types/pipeline";

/**
 * Turns the category preset into a storyboard about THIS company: actors come
 * from its own broken systems, the flow chain uses its own symptoms and
 * solution steps, and icons are inferred from what each thing actually is.
 * Pure + deterministic, safe for both the live and mock paths.
 */

/** Keyword -> Lucide icon name. First match wins. */
const ICON_KEYWORDS: Array<[RegExp, string]> = [
  [/excel|sheet|spreadsheet|csv|tracker|takeoff/i, "FileSpreadsheet"],
  [/outlook|e-?mail|inbox|gmail|mailbox/i, "Mail"],
  [/whatsapp|chat|teams|slack|message/i, "MessageCircle"],
  [/phone|call|voicemail|twilio|sms/i, "PhoneCall"],
  [/paper|clipboard|job sheet|checklist|form|qc log/i, "ClipboardList"],
  [/calendar|booking|appointment|roster|shift|schedul/i, "CalendarDays"],
  [/whiteboard|kanban|jira|trello|asana|board/i, "KanbanSquare"],
  [/crm|hubspot|salesforce|pipedrive/i, "Contact"],
  [/erp|sap|epicor|netsuite|oracle|dynamics/i, "Database"],
  [/mes|scada|plant|machine|shop floor/i, "Factory"],
  [/tms|fleet|truck|driver|route|deliver|freight/i, "Truck"],
  [/gps|map|location|site/i, "MapPin"],
  [/photo|camera|image|gallery/i, "Camera"],
  [/pdf|document|drawing|contract|letter|template|word/i, "FileText"],
  [/invoice|billing|xero|quickbooks|sage|accounting|payment/i, "Receipt"],
  [/quote|bid|tender|rfq|price|estimat/i, "CircleDollarSign"],
  [/sharepoint|dropbox|drive|folder|storage/i, "FolderOpen"],
  [/patient|clinic|health|medical|dental/i, "Stethoscope"],
  [/ticket|support|helpdesk|zendesk/i, "LifeBuoy"],
  [/inventory|stock|warehouse|pallet/i, "Package"],
  [/time|hours|timesheet|clock/i, "Clock"],
  [/customer|client|account/i, "Users"],
  [/api|integration|sync/i, "Network"],
  [/report|dashboard|analytics/i, "BarChart3"],
];

export const iconForLabel = (label: string, fallback = "Sparkles"): string => {
  for (const [pattern, icon] of ICON_KEYWORDS) {
    if (pattern.test(label)) return icon;
  }
  return fallback;
};

/** Stable FNV-1a hash. */
export const seedHash = (input: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
};

/** Strip vendor noise and parentheticals so a label fits a chip. */
export const shortLabel = (value: string, maxWords = 3): string => {
  const cleaned = (value.replace(/\([^)]*\)/g, "").split(/[/|,;:–—]/)[0] ?? value)
    .replace(/["“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const words = cleaned.split(" ").filter(Boolean).slice(0, maxWords);
  return words.join(" ") || value.slice(0, 20);
};

const MANUAL_VERB =
  /\b(re-?typ\w*|re-?key\w*|cop(?:y|ied)\w*|chas\w*|call\w*|duplicat\w*|reconcil\w*|print\w*|scan\w*|rebuil\w*|keyed|typed|entered)\b[^.,;]*/i;

/** Pull a short "manual step" phrase out of a symptom sentence. */
export const symptomStep = (symptom: string): string => {
  const match = symptom.match(MANUAL_VERB);
  return shortLabel(match ? match[0] : symptom, 3);
};

const uniqueBy = <T,>(items: T[], key: (item: T) => string): T[] => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item).toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** Split "A -> B -> C" crammed into one string; cap at 4 nodes. */
export const normalizeFlow = (steps: string[]): string[] => {
  const nodes = steps
    .flatMap((step) => step.split(/\s*(?:-+>|→|➔|=>)\s*/))
    .map((step) => step.trim())
    .filter((step) => step && !/^[-–—>➔→]+$/.test(step));
  const unique = uniqueBy(nodes, (n) => n).slice(0, 4);
  return unique.flatMap((node, i) => (i === 0 ? [node] : ["-->", node]));
};

const PROBLEM_MOTIONS: CartoonAnimationType[] = ["shake", "pulse", "shake", "bounce"];

export interface PersonalizeInput {
  companyName: string;
  problem: Pick<ProblemOutput, "symptoms" | "brokenSystems" | "department">;
  solution: Pick<SolutionOutput, "steps">;
}

/**
 * Replace the generic preset props with the company's own systems and steps.
 * The preset survives only as filler when the company data is thin.
 */
export const personalizeScenes = (
  base: CartoonAnimationScene[],
  input: PersonalizeInput,
): CartoonAnimationScene[] => {
  const { problem, solution } = input;
  const [problemBeat, solutionBeat] = base;
  if (!problemBeat || !solutionBeat) return base;

  const systems = uniqueBy(
    problem.brokenSystems.map((s) => shortLabel(s, 2)),
    (s) => s,
  ).slice(0, 3);

  /* ---- Problem beat: their tools, then the stuck team ---- */
  const problemActors: CartoonActor[] = systems.map((name, i) => ({
    name,
    icon: iconForLabel(name, problemBeat.actors[i]?.icon ?? "AlertTriangle"),
    animation_type: PROBLEM_MOTIONS[i % PROBLEM_MOTIONS.length]!,
  }));
  problemActors.push({
    name: `${shortLabel(problem.department, 2)} Team`,
    icon: "UserX",
    animation_type: "bounce",
  });

  const firstSystem = systems[0] ?? "Inbound Request";
  const lastSystem = systems[systems.length - 1] ?? firstSystem;
  const manualStep = problem.symptoms[0] ? symptomStep(problem.symptoms[0]) : "Manual Re-Entry";
  const problemFlow = normalizeFlow([
    firstSystem,
    manualStep,
    lastSystem !== firstSystem ? `${lastSystem} Errors` : "Delays & Errors",
  ]);

  /* ---- Solution beat: their solution steps around the engine ---- */
  const steps = solution.steps.slice(0, 3);
  const inputLabel = shortLabel(steps[0]?.title ?? "Capture", 3);
  const outputLabel = shortLabel(steps[steps.length - 1]?.title ?? "Automated Output", 3);
  const solutionActors: CartoonActor[] = [
    {
      name: inputLabel,
      icon: iconForLabel(`${steps[0]?.title ?? ""} ${steps[0]?.description ?? ""}`, "Inbox"),
      animation_type: "slide_in",
    },
    { name: "Velho AI Engine", icon: "Cog", animation_type: "spin_gear" },
    {
      name: outputLabel,
      icon: iconForLabel(
        `${steps[steps.length - 1]?.title ?? ""} ${steps[steps.length - 1]?.outcome ?? ""}`,
        "BadgeCheck",
      ),
      animation_type: "fade_red_to_green",
    },
  ];
  const solutionFlow = normalizeFlow([
    firstSystem,
    "Velho AI Engine",
    ...steps.slice(1).map((s) => shortLabel(s.title, 3)),
  ]);

  return [
    {
      ...problemBeat,
      actors: problemActors.length >= 3 ? problemActors.slice(0, 4) : problemBeat.actors,
      flow_diagram_steps: problemFlow.length >= 5 ? problemFlow : problemBeat.flow_diagram_steps,
    },
    {
      ...solutionBeat,
      actors: steps.length >= 2 ? solutionActors : solutionBeat.actors,
      flow_diagram_steps: solutionFlow.length >= 5 ? solutionFlow : solutionBeat.flow_diagram_steps,
    },
  ];
};

/**
 * Clean up LLM-authored beats: repair unknown icons, split crammed flow
 * strings, and pad a too-short flow from the company data.
 */
export const sanitizeAuthoredScene = (
  scene: CartoonAnimationScene,
  fallback: CartoonAnimationScene,
): CartoonAnimationScene => {
  const actors = scene.actors.map((actor) => ({
    ...actor,
    name: shortLabel(actor.name, 3),
    // Unknown Lucide names are repaired client-side from the actor name.
    icon: actor.icon || iconForLabel(actor.name, "Sparkles"),
  }));
  const flow = normalizeFlow(scene.flow_diagram_steps);
  return {
    ...scene,
    actors: actors.length >= 2 ? actors : fallback.actors,
    flow_diagram_steps: flow.length >= 5 ? flow : fallback.flow_diagram_steps,
  };
};

/* ------------------------------------------------------------------ */
/* Visual variant — each company gets its own composition              */
/* ------------------------------------------------------------------ */

/** Problem stage layouts: how the chaos is arranged. */
export type ProblemLayout = "pileup" | "orbit" | "conveyor" | "split";
/** Solution stage layouts: how the fix flows. */
export type SolutionLayout = "hub" | "pipeline" | "funnel";
/** Ambient background motif. */
export type BackdropMotif = "dots" | "grid" | "waves" | "diagonal";

export interface CartoonVariant {
  problemLayout: ProblemLayout;
  solutionLayout: SolutionLayout;
  backdrop: BackdropMotif;
  /** Rotates the scattered "debris" icons on the problem stage. */
  debrisSeed: number;
}

const PROBLEM_LAYOUTS: ProblemLayout[] = ["pileup", "orbit", "conveyor", "split"];
const SOLUTION_LAYOUTS: SolutionLayout[] = ["hub", "pipeline", "funnel"];
const BACKDROPS: BackdropMotif[] = ["dots", "grid", "waves", "diagonal"];

/** Deterministic per-domain variant, so a company always gets the same film. */
export const variantForCompany = (seedKey: string): CartoonVariant => {
  const h = seedHash(seedKey.toLowerCase());
  return {
    problemLayout: PROBLEM_LAYOUTS[h % PROBLEM_LAYOUTS.length]!,
    solutionLayout: SOLUTION_LAYOUTS[(h >>> 3) % SOLUTION_LAYOUTS.length]!,
    backdrop: BACKDROPS[(h >>> 6) % BACKDROPS.length]!,
    debrisSeed: (h >>> 9) % 997,
  };
};
