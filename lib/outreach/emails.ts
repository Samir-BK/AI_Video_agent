import "server-only";

import { callLlm, extractJson, isLlmConfigured } from "@/lib/llm";
import type { ProblemOutput, SolutionOutput } from "@/types/pipeline";
import type {
  CostEstimate,
  ExecRole,
  LeaderProfile,
  OutreachLanguage,
  RoleEmail,
  SourcedFact,
} from "@/types/outreach";
import { ROLE_LABELS } from "@/types/outreach";

/**
 * Role-specific emails. One LLM call writes every requested role from the
 * same verified fact set; each email is validated and falls back to a
 * deterministic template if it breaks a rule. Footer, greeting and links are
 * always built in code, never by the model.
 */

export interface RoleLinks {
  videoUrl: string;
  unsubscribeUrl: string;
  token: string;
}

export interface RoleRequest {
  role: ExecRole;
  /** Roles with no leader whose angle is folded into this email. */
  mergedRoles: ExecRole[];
}

export interface EmailContext {
  companyName: string;
  language: OutreachLanguage;
  leaders: LeaderProfile[];
  facts: SourcedFact[];
  estimate: CostEstimate;
  problem: ProblemOutput;
  solution: SolutionOutput;
  roles: RoleRequest[];
  links: Partial<Record<ExecRole, RoleLinks>>;
  senderName: string;
  /** Low confidence: say less, claim less. */
  weak: boolean;
}

export interface EmailWriteResult {
  emails: RoleEmail[];
  usedLlm: boolean;
  note: string;
}

const MAX_SUBJECT = 60;

const BANNED = [
  /\bre:/i,
  /revolution/i,
  /game[- ]?chang/i,
  /cutting[- ]edge/i,
  /synerg/i,
  /leverage/i,
  /unlock/i,
  /i hope this (email|message) finds you/i,
  /\breplace (your|the) (team|people|staff|workers)/i,
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u,
];

const ROLE_THEMES: Record<OutreachLanguage, Record<ExecRole, string>> = {
  en: {
    CEO: "Growth and strategy: the manual work standing between you and your stated goals",
    COO: "Operations: where your team's hours go, and how to free them up",
    CFO: "Cost: what the manual work costs per month, in euros",
    CTO: "Systems: connecting the tools you already run instead of copying data by hand",
    SALES: "Sales: faster quotes and order handling, more time for customers",
    HR: "People: less routine work for a growing team, without adding headcount",
    SERVICE: "Service and supply: incoming orders, emails and purchases handled faster",
  },
  fi: {
    CEO: "Kasvu ja strategia: manuaalinen työ julkaistujen tavoitteiden tiellä",
    COO: "Operatiivinen toiminta: mihin tiimin tunnit kuluvat ja miten ne vapautetaan",
    CFO: "Kustannukset: mitä manuaalinen työ maksaa kuukaudessa",
    CTO: "Järjestelmät: nykyiset työkalut yhteen ilman tiedon kopiointia käsin",
    SALES: "Myynti: nopeammat tarjoukset ja tilaukset, enemmän aikaa asiakkaille",
    HR: "Henkilöstö: vähemmän rutiinityötä kasvavalle tiimille",
    SERVICE: "Asiakaspalvelu ja hankinnat: tilaukset, viestit ja ostot nopeammin",
  },
};

const ROLE_ANGLE: Record<ExecRole, string> = {
  CEO: "growth and strategy; connect the bottleneck to a stated goal or a 'why now' signal",
  COO: "operations; hours, volumes, where the bottleneck sits in the process; say 'free up your team's hours', never 'replace people'",
  CFO: "money; the monthly EUR estimate (always call it an estimate) and, if given, the share of operating profit; never mention payback time",
  CTO: "systems and data flow; the fix integrates with the systems they already run (ERP, email, spreadsheets) rather than adding another tool; mention data stays in their systems",
  SALES: "sales speed; quotes, order confirmations and customer replies that wait on manual work; more time with customers",
  HR: "people; routine work that grows with headcount (hiring admin, onboarding, repetitive requests); never 'replace people', say 'free up hours'",
  SERVICE: "customer service, purchasing and supply chain; incoming emails, orders and purchase orders handled by hand; response times",
};

/**
 * Words that make a fact more relevant to a role, so two leaders at the same
 * company open their emails with different facts (an IT job ad for the CTO,
 * a customer-service ad for the service head).
 */
const ROLE_TOPICS: Partial<Record<ExecRole, RegExp>> = {
  CTO: /\b(it|ict|erp|data|digi\w*|system\w*|järjestelm\w*|ohjelmisto\w*|software|developer|kehittäjä\w*|tietohallin\w*|integraat\w*)/iu,
  SALES: /(myyn\w*|sales|account|asiakkuus\w*|tarjou\w*|kasv\w*|growth|export|vien\w*|markkin\w*)/iu,
  HR: /(henkilöst\w*|rekry\w*|recruit\w*|hiring|palkka\w*|työntekij\w*|employ\w*|people|hr\b)/iu,
  SERVICE: /(asiakaspalvel\w*|customer service|tilau\w*|order\w*|hankin\w*|osto\w*|procure\w*|purchas\w*|logist\w*|toimitus\w*|supply)/iu,
};

const firstName = (name: string | null): string | null =>
  name ? (name.trim().split(/\s+/)[0] ?? null) : null;

const greetingFor = (leader: LeaderProfile | undefined, language: OutreachLanguage): string => {
  const first = firstName(leader?.name ?? null);
  if (language === "fi") return first ? `Hei ${first},` : "Hei,";
  return first ? `Hi ${first},` : "Hello,";
};

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const footerFor = (
  facts: SourcedFact[],
  links: RoleLinks,
  senderName: string,
  language: OutreachLanguage,
): string[] => {
  const hosts = [...new Set(facts.map((fact) => hostOf(fact.sourceUrl)))].slice(0, 4);
  if (language === "fi") {
    return [
      hosts.length
        ? `Lähteet: ${hosts.join(", ")} — kaikki tiedot ovat julkisia.`
        : "Kaikki tiedot ovat julkisista lähteistä.",
      `Jos tämä ei ole ajankohtaista, peru viestit tästä: ${links.unsubscribeUrl}`,
      senderName,
    ];
  }
  return [
    hosts.length
      ? `Sources: ${hosts.join(", ")} — all information is public.`
      : "All information is from public sources.",
    `Not relevant? Unsubscribe here: ${links.unsubscribeUrl}`,
    senderName,
  ];
};

const lowerFirst = (value: string): string =>
  value ? value.charAt(0).toLowerCase() + value.slice(1) : value;

const stripDot = (value: string): string => value.trim().replace(/[.!]+$/, "");

/**
 * The fact as a clause. A keyword-rule fact is the source sentence itself
 * (text === quote, possibly Finnish), so it is quoted verbatim, not reworded.
 */
const claimOf = (fact: SourcedFact): string =>
  fact.text === fact.quote ? `“${stripDot(fact.quote)}”` : lowerFirst(stripDot(fact.text));

/** Open-position title from a hiring fact ("Open position: X" -> "X"). */
const positionOf = (fact: SourcedFact): string =>
  stripDot(fact.text.replace(/^open position:\s*/i, ""));

/** Opening sentence phrased for the kind of fact it cites. */
const openingSentence = (
  fact: SourcedFact | undefined,
  companyName: string,
  language: OutreachLanguage,
): string => {
  if (language === "fi") {
    if (!fact) return `Tutustuimme yrityksenne (${companyName}) julkisiin tietoihin.`;
    if (fact.kind === "hiring") {
      return `Huomasimme, että haette parhaillaan tehtävään "${positionOf(fact)}".`;
    }
    return `Julkisista lähteistä nousi esiin yksi asia: ${claimOf(fact)}.`;
  }
  if (!fact) {
    return `We looked at ${companyName}'s public material and the way work flows through the business.`;
  }
  switch (fact.kind) {
    case "hiring":
      return `I noticed ${companyName} is currently hiring for "${positionOf(fact)}".`;
    case "strategy_goal":
      return `${companyName} has set a clear goal: ${claimOf(fact)}.`;
    case "why_now":
      return `I saw a recent change at ${companyName}: ${claimOf(fact)}.`;
    default:
      return `Reading ${companyName}'s public material, one point stood out: ${claimOf(fact)}.`;
  }
};

/** Facts most relevant to a role, best first. */
const factsForRole = (role: ExecRole, facts: SourcedFact[]): SourcedFact[] => {
  const order: Record<ExecRole, string[]> = {
    CEO: ["strategy_goal", "why_now", "leader_statement", "hiring", "financial", "company"],
    COO: ["hiring", "why_now", "strategy_goal", "leader_statement", "financial", "company"],
    CFO: ["financial", "strategy_goal", "why_now", "hiring", "leader_statement", "company"],
    CTO: ["why_now", "strategy_goal", "hiring", "leader_statement", "financial", "company"],
    SALES: ["strategy_goal", "hiring", "why_now", "leader_statement", "financial", "company"],
    HR: ["hiring", "why_now", "strategy_goal", "leader_statement", "financial", "company"],
    SERVICE: ["hiring", "why_now", "strategy_goal", "leader_statement", "financial", "company"],
  };
  const topic = ROLE_TOPICS[role];
  const onTopic = (fact: SourcedFact): number => (topic?.test(fact.text) ? 0 : 1);
  return [...facts].sort(
    (a, b) => onTopic(a) - onTopic(b) || order[role].indexOf(a.kind) - order[role].indexOf(b.kind),
  );
};

const truncateSubject = (subject: string): string => {
  if (subject.length <= MAX_SUBJECT) return subject;
  const cut = subject.slice(0, MAX_SUBJECT);
  return cut.slice(0, cut.lastIndexOf(" ")).trim() || cut.trim();
};

/** Deterministic email used when the model is unavailable or breaks a rule. */
const templateEmail = (
  request: RoleRequest,
  ctx: EmailContext,
): { subject: string; body: string[]; callToAction: string; facts: SourcedFact[] } => {
  const ranked = factsForRole(request.role, ctx.facts).filter((f) => f.kind !== "company");
  const lead = ranked[0];
  const second = ranked[1];
  const { estimate, companyName, problem, solution } = ctx;
  const hours = estimate.hoursPerMonth;

  if (ctx.language === "fi") {
    const generic =
      request.role === "CFO" || request.mergedRoles.includes("CFO")
        ? `Arviomme mukaan manuaalinen työ maksaa ${estimate.formula}.`
        : `Arviomme mukaan manuaalinen työ vie tiimiltänne noin ${hours} tuntia kuukaudessa.`;
    const angleFi: Partial<Record<ExecRole, string>> = {
      CTO: `Järjestelmien näkökulmasta kyse on usein tiedon siirtämisestä käsin järjestelmästä toiseen — arviomme mukaan noin ${hours} tuntia kuukaudessa. Ratkaisu liitetään nykyisiin järjestelmiinne, ei uutena erillisenä työkaluna.`,
      SALES: `Myynnissä tämä näkyy hitaampina tarjouksina ja tilausvahvistuksina — arviomme mukaan noin ${hours} tuntia kuukaudessa, jotka voisivat kulua asiakkaiden kanssa.`,
      HR: `Henkilöstön näkökulmasta kyse on toistuvasta työstä, joka kasvaa tiimin mukana — arviomme mukaan noin ${hours} tuntia kuukaudessa ilman lisärekrytointeja.`,
      SERVICE: `Asiakaspalvelussa ja hankinnoissa tämä tarkoittaa usein saapuvien viestien ja tilausten käsittelyä käsin — arviomme mukaan noin ${hours} tuntia kuukaudessa.`,
    };
    const body = [
      openingSentence(lead, companyName, "fi"),
      angleFi[request.role] ?? generic,
      `Teimme 45 sekunnin videon siitä, miltä ${solution.architectureName} voisi näyttää teillä.`,
    ];
    const subjectsFi: Record<ExecRole, string> = {
      CEO: `${companyName}: 45 sekunnin idea kasvutavoitteeseen`,
      COO: `${companyName}: ~${hours} h/kk takaisin tiimille`,
      CFO: `${companyName}: manuaalisen työn kuukausikustannus`,
      CTO: `${companyName}: nykyiset järjestelmät yhteen`,
      SALES: `${companyName}: nopeammat tarjoukset ja tilaukset`,
      HR: `${companyName}: rutiinityötä pois kasvavalta tiimiltä`,
      SERVICE: `${companyName}: tilaukset ja viestit nopeammin`,
    };
    return {
      subject: truncateSubject(subjectsFi[request.role]),
      body,
      callToAction: "Katso 45 sekunnin video:",
      facts: lead ? [lead] : [],
    };
  }

  const secondSignal = !second
    ? `Manual work like this is often what slows growth plans down.`
    : second.kind === "hiring"
      ? `You are also hiring for "${positionOf(second)}", so the workload is clearly growing.`
      : `That sits next to another signal: ${claimOf(second)}.`;

  const angle: Record<ExecRole, string> = {
    CEO: secondSignal,
    COO: `Our estimate is that ${lowerFirst(problem.title)} takes around ${hours} hours of your team's time each month.`,
    CFO: `Our estimate puts the cost at ${estimate.formula}${
      estimate.shareOfOperatingProfitPct !== null
        ? `, about ${estimate.shareOfOperatingProfitPct}% of operating profit per year`
        : ""
    }.`,
    CTO: `On the systems side, ${lowerFirst(problem.title)} usually means people copying data between tools — about ${hours} hours a month by our estimate. The fix connects to the systems you already run instead of adding another one.`,
    SALES: `For sales, that shows up as slower quotes and order confirmations — about ${hours} hours a month by our estimate that could go to customers instead.`,
    HR: `For a growing team, this is routine work that grows with headcount — about ${hours} hours a month by our estimate that your team could spend on people instead of paperwork.`,
    SERVICE: `In customer service and purchasing, it usually means incoming emails and orders handled by hand — about ${hours} hours a month by our estimate, and slower replies to customers.`,
  };

  // With no COO/CFO found, the CEO email carries their numbers too.
  if (request.role === "CEO" && request.mergedRoles.length > 0) {
    angle.CEO = `${angle.CEO} Our estimate is about ${hours} hours of manual work a month (${estimate.formula}).`;
  }

  const body = [
    openingSentence(lead, companyName, "en"),
    angle[request.role],
    `We made a 45-second video showing what ${solution.architectureName} could look like at ${companyName}, freeing up your team's hours rather than adding headcount.`,
  ];

  const subjects: Record<ExecRole, string> = {
    CEO: `${companyName}: a 45-second idea for your growth goal`,
    COO: `${companyName}: ~${hours} hours a month back for your team`,
    CFO: `${companyName}: the monthly cost of manual work`,
    CTO: `${companyName}: connecting the systems you already run`,
    SALES: `${companyName}: faster quotes and order handling`,
    HR: `${companyName}: routine work off a growing team`,
    SERVICE: `${companyName}: orders and emails handled faster`,
  };

  return {
    subject: truncateSubject(subjects[request.role]),
    body,
    callToAction: "Watch the 45-second video:",
    facts: [lead, request.role === "CEO" ? second : undefined].filter(
      (f): f is SourcedFact => f !== undefined,
    ),
  };
};

const EMAIL_SYSTEM = `You write short, honest B2B emails from Velho (an AI automation partner in Finland) to company executives.
Tone: modest Finnish business style. First sentence gets straight to the point. No buzzwords, no flattery, no emojis, no "I hope this finds you well", never "replace people".
Use ONLY the numbered FACTS and the ESTIMATE given. Never invent numbers, names or claims. Call the estimate an estimate.
Each email: subject under 60 characters (no "Re:"), 3 to 5 short sentences in "body", a short "callToAction" that introduces the video link (do not write the link itself), and "factIds" listing the facts you used.
Each role's email must be genuinely different.
Respond with ONLY JSON: { "emails": [ { "role": "CEO"|"COO"|"CFO"|"CTO"|"SALES"|"HR"|"SERVICE", "subject": string, "body": string[], "callToAction": string, "factIds": string[] } ] }`;

interface RawEmail {
  role?: unknown;
  subject?: unknown;
  body?: unknown;
  callToAction?: unknown;
  factIds?: unknown;
}

const isClean = (texts: string[]): boolean =>
  texts.every((text) => !BANNED.some((pattern) => pattern.test(text)));

const validate = (
  raw: RawEmail | undefined,
  ctx: EmailContext,
): { subject: string; body: string[]; callToAction: string; facts: SourcedFact[] } | null => {
  if (!raw) return null;
  const subject = typeof raw.subject === "string" ? raw.subject.trim() : "";
  const body = Array.isArray(raw.body)
    ? raw.body.filter((s): s is string => typeof s === "string" && s.trim() !== "").map((s) => s.trim())
    : [];
  const callToAction = typeof raw.callToAction === "string" ? raw.callToAction.trim() : "";
  const ids = Array.isArray(raw.factIds)
    ? raw.factIds.filter((id): id is string => typeof id === "string")
    : [];

  if (!subject || body.length < 3 || body.length > 5 || !callToAction) return null;
  if (!isClean([subject, ...body, callToAction])) return null;
  if (body.some((sentence) => /https?:\/\//.test(sentence))) return null;

  const facts = ids
    .map((id) => ctx.facts.find((fact) => fact.id === id))
    .filter((fact): fact is SourcedFact => fact !== undefined);
  if (!ctx.weak && ctx.facts.some((f) => f.kind !== "company") && facts.length === 0) {
    return null;
  }

  return { subject: truncateSubject(subject), body, callToAction, facts };
};

const buildPrompt = (ctx: EmailContext): string => {
  const factLines = ctx.facts
    .map((fact) => `[${fact.id}] (${fact.kind}) ${fact.text}`)
    .join("\n");
  const leaders = ctx.roles
    .map(({ role, mergedRoles }) => {
      const leader = ctx.leaders.find((l) => l.role === role);
      const merged = mergedRoles.length
        ? ` Also cover the ${mergedRoles.join(" and ")} angle (no such executive was found).`
        : "";
      return `- ${role}: ${leader?.name ?? "name unknown"} (${leader?.title || role}). Angle: ${ROLE_ANGLE[role]}.${merged}`;
    })
    .join("\n");

  return [
    `COMPANY: ${ctx.companyName}`,
    `LANGUAGE: ${ctx.language === "fi" ? "Finnish" : "English"}`,
    `BOTTLENECK: ${ctx.problem.title} — ${ctx.problem.summary}`,
    `VELHO FIX: ${ctx.solution.architectureName} — ${ctx.solution.summary}`,
    `ESTIMATE (label as estimate): ${ctx.estimate.formula}${
      ctx.estimate.shareOfOperatingProfitPct !== null
        ? `; ≈${ctx.estimate.shareOfOperatingProfitPct}% of yearly operating profit`
        : ""
    }`,
    ctx.weak ? "CONFIDENCE: low — keep claims minimal." : "CONFIDENCE: normal",
    `FACTS:\n${factLines || "(none)"}`,
    `WRITE ONE EMAIL FOR EACH:\n${leaders}`,
  ].join("\n\n");
};

export const writeRoleEmails = async (ctx: EmailContext): Promise<EmailWriteResult> => {
  let rawEmails: RawEmail[] = [];
  let usedLlm = false;
  let note = "Written from templates (no LLM key)";

  if (isLlmConfigured() && ctx.roles.length > 0) {
    try {
      const response = await callLlm({
        messages: [
          { role: "system", content: EMAIL_SYSTEM },
          { role: "user", content: buildPrompt(ctx) },
        ],
        json: true,
        temperature: 0.4,
      });
      rawEmails = extractJson<{ emails?: RawEmail[] }>(response)?.emails ?? [];
      usedLlm = true;
      note = "Written by the model and validated";
    } catch (error) {
      note = `Templates used: ${error instanceof Error ? error.message.slice(0, 120) : "LLM error"}`;
    }
  }

  const emails = ctx.roles.map(({ role, mergedRoles }): RoleEmail => {
    const leader = ctx.leaders.find((l) => l.role === role);
    const links = ctx.links[role] ?? { videoUrl: "", unsubscribeUrl: "", token: "" };
    const live = validate(
      rawEmails.find((email) => email.role === role),
      ctx,
    );
    const content = live ?? templateEmail({ role, mergedRoles }, ctx);
    const usedFacts = content.facts.length ? content.facts : [];

    return {
      role,
      recipient: {
        name: leader?.name ?? null,
        title: leader?.title || ROLE_LABELS[role],
        email: leader?.email.address ?? null,
        emailMethod: leader?.email.method,
      },
      theme: ROLE_THEMES[ctx.language][role],
      subject: content.subject,
      greeting: greetingFor(leader, ctx.language),
      body: content.body,
      callToAction: content.callToAction,
      footer: footerFor(usedFacts.length ? usedFacts : ctx.facts, links, ctx.senderName, ctx.language),
      videoUrl: links.videoUrl,
      unsubscribeUrl: links.unsubscribeUrl,
      token: links.token,
      usedFacts,
      language: ctx.language,
      status: leader?.email.address ? "draft" : "no_address",
      writtenBy: live ? "live" : "template",
      mergedRoles,
    };
  });

  const templated = emails.filter((email) => email.writtenBy === "template").length;
  if (usedLlm && templated > 0) {
    note = `${note}; ${templated} email(s) replaced by templates after validation`;
  }
  return { emails, usedLlm, note };
};
