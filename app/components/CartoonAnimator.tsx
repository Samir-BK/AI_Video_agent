"use client";

import { useMemo } from "react";
import * as LucideIcons from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type {
  BottleneckCategory,
  BrandPalette,
  CartoonActor,
  CartoonAnimationScene,
  CartoonAnimationType,
} from "@/types/pipeline";
import { BOTTLENECK_CATEGORY_LABELS } from "@/types/pipeline";
import { CARTOON_TIMELINE } from "@/lib/cartoonPresets";
import {
  iconForLabel,
  variantForCompany,
  type BackdropMotif,
  type CartoonVariant,
} from "@/lib/cartoonPersonalize";
import {
  problemPlacements,
  solutionGeometry,
  type ActorPlacement,
} from "@/app/components/cartoonLayouts";

/**
 * Dynamic cartoon SVG/CSS renderer for the 45-second video.
 *
 * Instead of a canvas loop, every beat is authored as vector artwork and
 * animated declaratively with CSS keyframes (see `globals.css`). That means:
 *   - the visual is specific to the company's bottleneck category,
 *   - motion is GPU-composited and keeps running even if React re-renders,
 *   - `prefers-reduced-motion` degrades to a clean static diagram.
 *
 * The stage is deliberately WORDLESS. All narration lives in the voiceover and
 * the single caption strip owned by `VideoPlayer`, so the artwork never competes
 * with — or duplicates — a wall of on-screen prose.
 *
 * Four phases map onto the fixed storyboard:
 *   intro    (0-6s)   company identity + target website graphic
 *   problem  (6-24s)  cartoonish bottleneck animation (red/amber)
 *   solution (24-38s) Velho AI pipeline (green/blue)
 *   booking  (38-45s) one-click meeting end card
 */

export type CartoonPhase = "intro" | "problem" | "solution" | "booking";

export interface CartoonAnimatorProps {
  phase: CartoonPhase;
  /** The two beats authored for this company (problem, then solution). */
  cartoonScene: CartoonAnimationScene | null;
  category: BottleneckCategory;
  companyName: string;
  domain: string;
  glyph: string;
  industry: string;
  palette: BrandPalette;
  /** Seconds elapsed in the 45s timeline — drives the intro progress ring. */
  elapsedSec: number;
  paused: boolean;
  /** Storyboard playback rate — CSS loops follow the same clock. */
  playRate?: number;
  className?: string;
}

/** The drawing surface. Everything is authored against this viewBox. */
const VIEW_W = 640;
const VIEW_H = 360;

/* ------------------------------------------------------------------ */
/* Icon resolution                                                     */
/* ------------------------------------------------------------------ */

const ICON_REGISTRY = LucideIcons as unknown as Record<string, LucideIcon>;

const toPascalCase = (value: string): string =>
  value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");

/**
 * Resolve "FileSpreadsheet", "file-spreadsheet" or a raw path string to a
 * renderable icon. Unknown names degrade to a neutral glyph rather than
 * breaking the whole animation.
 */
export const resolveIcon = (name?: string, label?: string): LucideIcon => {
  const lookup = (candidate: string): LucideIcon | null => {
    const trimmed = candidate.trim();
    const hit = ICON_REGISTRY[trimmed] ?? ICON_REGISTRY[toPascalCase(trimmed)];
    // Lucide exports non-component helpers too; only accept renderables.
    return hit && (typeof hit === "function" || typeof hit === "object") ? hit : null;
  };
  if (name) {
    const direct = lookup(name) ?? lookup(`${name}Icon`);
    if (direct) return direct;
  }
  // LLMs invent icon names ("TruckDelay"); infer from the actor's name instead
  // of drawing the same sparkle for every unknown.
  if (label || name) {
    const inferred = lookup(iconForLabel(`${label ?? ""} ${name ?? ""}`, "Sparkles"));
    if (inferred) return inferred;
  }
  return ICON_REGISTRY.Sparkles!;
};

const ANIM_CLASS: Record<CartoonAnimationType, string> = {
  shake: "velho-anim-shake",
  bounce: "velho-anim-bounce",
  pulse: "velho-anim-pulse",
  slide_in: "velho-anim-slide-in",
  spin_gear: "velho-anim-spin-gear",
  fade_red_to_green: "velho-anim-fade-red-to-green",
};

/* ------------------------------------------------------------------ */
/* Layout tables — one tailored composition per bottleneck category    */
/* ------------------------------------------------------------------ */

type ActorTone = "danger" | "warn" | "success" | "info" | "neutral";

/** Category-specific "debris" that drifts around the problem stage. */
const CATEGORY_DEBRIS: Record<BottleneckCategory, string[]> = {
  quoting_and_order_intake: ["FileText", "Mail", "CircleDollarSign", "FileSpreadsheet", "Paperclip"],
  field_reporting: ["ClipboardList", "Camera", "MapPin", "PhoneCall", "Truck"],
  scheduling: ["CalendarDays", "BellRing", "Clock", "PhoneCall", "Users"],
  cross_system_data: ["Copy", "Database", "FileSpreadsheet", "Unplug", "Keyboard"],
};

const PROBLEM_TONES: ActorTone[] = ["danger", "warn", "danger", "warn"];
const SOLUTION_TONES: ActorTone[] = ["success", "success", "success"];

const TONE_COLORS: Record<ActorTone, string> = {
  danger: "#F43F5E",
  warn: "#FB923C",
  success: "#10B981",
  info: "#38BDF8",
  neutral: "#94A3B8",
};

const ENGINE_KEYWORDS = ["velho", "engine", "ai ", "hub", "core", "automation"];

const isEngineActor = (name: string): boolean => {
  const lower = name.toLowerCase();
  return ENGINE_KEYWORDS.some((keyword) => lower.includes(keyword));
};

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

/** Word-wrap into at most `maxLines` lines of ~`maxChars` characters. */
const wrapText = (value: string, maxChars: number, maxLines = 2): string[] => {
  const words = value.trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars || current === "") {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines.length > 0 ? lines : [value];
};

const isArrowToken = (value: string): boolean => /^[-–—>➔]+$/.test(value.trim());

/** Pull the human-readable nodes out of a `["A", "-->", "B"]` chain. */
const flowNodes = (steps: string[]): string[] => {
  const nodes = steps.map((step) => step.trim()).filter((step) => step && !isArrowToken(step));
  return nodes.length > 0 ? nodes.slice(0, 4) : steps.filter(Boolean).slice(0, 3);
};

/* ------------------------------------------------------------------ */
/* Building blocks                                                     */
/* ------------------------------------------------------------------ */

interface IconGlyphProps {
  name?: string;
  x: number;
  y: number;
  size: number;
  color: string;
  strokeWidth?: number;
  className?: string;
}

/** A Lucide icon placed at an SVG coordinate via Lucide's x/y props. */
function IconGlyph({
  name,
  x,
  y,
  size,
  color,
  strokeWidth = 1.7,
  className,
  label,
}: IconGlyphProps & { label?: string }) {
  const Icon = resolveIcon(name, label);
  return (
    <g className={className} style={{ color }}>
      <Icon
        x={x - size / 2}
        y={y - size / 2}
        width={size}
        height={size}
        strokeWidth={strokeWidth}
      />
    </g>
  );
}

interface ActorNodeProps {
  actor: CartoonActor;
  placement: ActorPlacement;
  tone: ActorTone;
  accent: string;
  isEngine?: boolean;
  /** Override the tone colour (brand-tinted solution actors). */
  colorOverride?: string;
}

/** A cartoon "character": animated disc + icon + status badge + name. */
function ActorNode({
  actor,
  placement,
  tone,
  accent,
  isEngine = false,
  colorOverride,
}: ActorNodeProps) {
  const color = colorOverride ?? (isEngine ? "#22D3EE" : TONE_COLORS[tone]);
  const { x, y, size, delay } = placement;
  const radius = size / 2 + (isEngine ? 4 : 0);
  const spin = actor.animation_type === "spin_gear";
  const badgeAngle = -Math.PI / 3;
  const badgeX = x + Math.cos(badgeAngle) * (radius + 5);
  const badgeY = y + Math.sin(badgeAngle) * (radius + 5);

  return (
    <g>
      {/* Halo */}
      {isEngine ? (
        <circle
          cx={x}
          cy={y}
          r={radius + 13}
          fill="none"
          stroke={accent}
          strokeWidth={1}
          strokeDasharray="4 6"
          className="velho-svg-anim velho-anim-spin-gear"
          style={{ animationDirection: "reverse", animationDuration: "14s", opacity: 0.5 }}
        />
      ) : null}

      {/* Body */}
      <g
        className={`velho-svg-anim ${ANIM_CLASS[actor.animation_type]}`}
        style={{ animationDelay: `${delay}s` }}
      >
        <circle
          cx={x}
          cy={y}
          r={radius + 9}
          fill={isEngine ? `${color}22` : "rgba(255,255,255,0.03)"}
          stroke={isEngine ? `${color}66` : "rgba(255,255,255,0.07)"}
          strokeWidth={isEngine ? 1.6 : 1}
        />
        <circle cx={x} cy={y} r={radius} fill="#0b0d13" stroke={color} strokeWidth={2} />
        <IconGlyph
          name={actor.icon}
          label={actor.name}
          x={x}
          y={y}
          size={size * (isEngine ? 0.66 : 0.56)}
          color={color}
          strokeWidth={isEngine ? 1.5 : 1.8}
          className={spin ? "velho-svg-anim velho-anim-spin-gear" : undefined}
        />
      </g>

      {/* Status badge — the emotional beat of the cartoon */}
      <g
        className="velho-svg-anim velho-anim-pop-in"
        style={{ animationDelay: `${delay + 0.35}s` }}
      >
        <circle cx={badgeX} cy={badgeY} r={9} fill={color} stroke="#0b0d13" strokeWidth={1.6} />
        <IconGlyph
          name={tone === "success" || tone === "info" ? "Check" : "X"}
          x={badgeX}
          y={badgeY}
          size={11}
          color="#0b0d13"
          strokeWidth={3}
        />
      </g>

      {/* Name plate */}
      <text
        x={x}
        y={y + radius + 24}
        textAnchor="middle"
        className="velho-anim-rise"
        style={{
          animationDelay: `${delay + 0.15}s`,
          fill: "rgba(255,255,255,0.82)",
          fontSize: 11.5,
          fontWeight: 600,
        }}
      >
        {wrapText(actor.name, 16, 2).map((line, i) => (
          <tspan key={i} x={x} dy={i === 0 ? 0 : 13}>
            {truncate(line, 18)}
          </tspan>
        ))}
      </text>
    </g>
  );
}

interface FlowChainProps {
  steps: string[];
  mode: "problem" | "solution";
  accent: string;
  y: number;
  /** Base animation delay in seconds. */
  delayBase: number;
}

/** The `node -> node -> node` diagram, with the final node carrying the verdict. */
function FlowChain({ steps, mode, accent, y, delayBase }: FlowChainProps) {
  const nodes = flowNodes(steps);
  const chipW = nodes.length >= 4 ? 112 : 128;
  const gap = nodes.length >= 4 ? 24 : 34;
  const chipH = 34;
  const total = nodes.length * chipW + (nodes.length - 1) * gap;
  const startX = (VIEW_W - total) / 2;
  const isSolution = mode === "solution";
  const terminalColor = isSolution ? "#10B981" : "#F43F5E";

  return (
    <g>
      {nodes.map((label, index) => {
        const isLast = index === nodes.length - 1;
        const isEngineNode = /velho|ai engine/i.test(label);
        const x = startX + index * (chipW + gap);
        const delay = delayBase + index * 0.22;

        const stroke = isEngineNode
          ? accent
          : isLast
            ? terminalColor
            : isSolution
              ? "rgba(148, 210, 255, 0.35)"
              : "rgba(255, 255, 255, 0.14)";
        const fill = isEngineNode
          ? `${accent}22`
          : isLast
            ? `${terminalColor}1f`
            : "rgba(255,255,255,0.04)";

        return (
          <g key={`${label}-${index}`}>
            {/* Connector */}
            {index > 0 ? (
              <g
                className="velho-svg-anim velho-anim-pop-in"
                style={{ animationDelay: `${delay - 0.14}s` }}
              >
                <line
                  x1={x - gap + 4}
                  y1={y + chipH / 2}
                  x2={x - 6}
                  y2={y + chipH / 2}
                  stroke={isSolution ? "#10B981" : "rgba(244, 63, 94, 0.6)"}
                  strokeWidth={1.6}
                  strokeDasharray="5 4"
                  className="velho-anim-dash-march"
                />
                <IconGlyph
                  name="ArrowRight"
                  x={x - gap / 2}
                  y={y + chipH / 2}
                  size={14}
                  color={isSolution ? "#10B981" : "#FB923C"}
                  strokeWidth={2.4}
                />
              </g>
            ) : null}

            {/* Chip */}
            <g
              className="velho-svg-anim velho-anim-pop-in"
              style={{ animationDelay: `${delay}s` }}
            >
              <rect
                x={x}
                y={y}
                width={chipW}
                height={chipH}
                rx={9}
                fill={fill}
                stroke={stroke}
                strokeWidth={isEngineNode || isLast ? 1.7 : 1}
              />
              {wrapText(label, nodes.length >= 4 ? 13 : 15, 2).map((rawLine, lineIndex, all) => {
                const line = truncate(rawLine, nodes.length >= 4 ? 14 : 16);
                return (
                <text
                  key={lineIndex}
                  x={x + chipW / 2}
                  y={y + chipH / 2 + (lineIndex - (all.length - 1) / 2) * 12 + 3.5}
                  textAnchor="middle"
                  style={{
                    fill: isEngineNode || isLast ? "#fff" : "rgba(255,255,255,0.68)",
                    fontSize: 9.5,
                    fontWeight: isEngineNode || isLast ? 700 : 500,
                  }}
                >
                  {line}
                </text>
                );
              })}
            </g>

            {/* Bottleneck / success marker on the terminal node */}
            {isLast ? (
              <g
                className={`velho-svg-anim ${isSolution ? "velho-anim-pop-in" : "velho-anim-pulse"}`}
                style={{ animationDelay: `${delay + 0.4}s` }}
              >
                <circle cx={x + chipW - 5} cy={y - 5} r={10} fill={terminalColor} stroke="#0b0d13" strokeWidth={1.6} />
                <IconGlyph
                  name={isSolution ? "Check" : "AlertTriangle"}
                  x={x + chipW - 5}
                  y={y - 5}
                  size={12}
                  color="#0b0d13"
                  strokeWidth={2.6}
                />
              </g>
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

interface CanvasFrameProps {
  title: string;
  categoryLabel: string;
  mode: "intro" | "problem" | "solution" | "booking";
  accent: string;
  backdrop: BackdropMotif;
  children: React.ReactNode;
}

/** The ambient background texture — varies per company. */
function BackdropPattern({ id, motif }: { id: string; motif: BackdropMotif }) {
  const ink = "rgba(255,255,255,0.055)";
  switch (motif) {
    case "grid":
      return (
        <pattern id={id} width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M32 0H0V32" fill="none" stroke={ink} strokeWidth="1" />
        </pattern>
      );
    case "waves":
      return (
        <pattern id={id} width="48" height="20" patternUnits="userSpaceOnUse">
          <path d="M0 10 Q12 2 24 10 T48 10" fill="none" stroke={ink} strokeWidth="1" />
        </pattern>
      );
    case "diagonal":
      return (
        <pattern id={id} width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
          <line x1="0" y1="0" x2="0" y2="18" stroke={ink} strokeWidth="1" />
        </pattern>
      );
    case "dots":
    default:
      return (
        <pattern id={id} width="26" height="26" patternUnits="userSpaceOnUse">
          <circle cx="1.4" cy="1.4" r="1" fill={ink} />
        </pattern>
      );
  }
}

/** Shared stage: ambient wash, backdrop motif, rounded frame and corner chrome. */
function CanvasFrame({ title, categoryLabel, mode, accent, backdrop, children }: CanvasFrameProps) {
  // Problem stays alarm-red; the solution blends success green with the brand.
  const wash =
    mode === "problem"
      ? "#F43F5E"
      : mode === "solution"
        ? "#10B981"
        : mode === "booking"
          ? "#6EE7B7"
          : accent;
  const dotId = `dots-${mode}`;
  const glowId = `glow-${mode}`;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="absolute inset-0 h-full w-full"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label={title}
    >
      <defs>
        <BackdropPattern id={dotId} motif={backdrop} />
        <radialGradient id={glowId} cx="50%" cy="42%" r="62%">
          <stop offset="0%" stopColor={wash} stopOpacity={mode === "intro" ? 0.2 : 0.16} />
          <stop offset="100%" stopColor="#08090d" stopOpacity={0} />
        </radialGradient>
      </defs>

      <rect width={VIEW_W} height={VIEW_H} fill="#08090d" />
      <rect width={VIEW_W} height={VIEW_H} fill={`url(#${glowId})`} />
      {/* Brand tint in the corner so every company's frame has its own colour. */}
      <circle cx={VIEW_W - 40} cy={VIEW_H - 30} r={220} fill={accent} opacity={0.07} />
      <rect width={VIEW_W} height={VIEW_H} fill={`url(#${dotId})`} />

      <rect
        x={12}
        y={12}
        width={VIEW_W - 24}
        height={VIEW_H - 24}
        rx={18}
        fill="none"
        stroke="rgba(255,255,255,0.07)"
        strokeWidth={1}
      />
      <rect x={12} y={12} width={VIEW_W - 24} height={3} rx={1.5} fill={wash} opacity={0.55} />

      {/* Mode chip */}
      <g>
        <rect x={26} y={26} width={categoryLabel.length * 7.2 + 22} height={21} rx={10.5} fill={`${wash}1f`} stroke={`${wash}55`} />
        <text x={37} y={41} style={{ fill: wash, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.6 }}>
          {categoryLabel.toUpperCase()}
        </text>
      </g>

      {children}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Phase: intro (0-6s)                                                 */
/* ------------------------------------------------------------------ */

interface IntroProps {
  companyName: string;
  domain: string;
  glyph: string;
  industry: string;
  palette: BrandPalette;
  accent: string;
  elapsedSec: number;
}

function IntroScene({
  companyName,
  domain,
  glyph,
  industry,
  palette,
  accent,
  elapsedSec,
}: IntroProps) {
  // The ring closes across the intro beat, whatever its length.
  const introDurationSec = Math.max(CARTOON_TIMELINE.problemStart, 1);
  const ringProgress = Math.min(1, Math.max(0, elapsedSec / introDurationSec));
  const ringRadius = 30;
  const circumference = 2 * Math.PI * ringRadius;

  return (
    <g>
      {/* Logo lockup */}
      <g className="velho-svg-anim velho-anim-pop-in">
        <circle cx={96} cy={104} r={ringRadius} fill="rgba(255,255,255,0.03)" />
        <circle cx={96} cy={104} r={ringRadius} fill={palette.primary} opacity={0.16} />
        <circle
          cx={96}
          cy={104}
          r={ringRadius}
          fill="none"
          stroke={accent}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - ringProgress)}
          transform={`rotate(-90 96 104)`}
        />
        <text x={96} y={115} textAnchor="middle" style={{ fontSize: 30 }}>
          {glyph}
        </text>
      </g>

      {/* Name + positioning */}
      <g className="velho-svg-anim velho-anim-rise" style={{ animationDelay: "0.25s" }}>
        <text x={148} y={96} style={{ fill: "#ffffff", fontSize: 30, fontWeight: 800, letterSpacing: -0.6 }}>
          {truncate(companyName, 22)}
        </text>
        <text x={148} y={120} style={{ fill: accent, fontSize: 13, fontWeight: 600, letterSpacing: 1.6 }}>
          {truncate(industry.toUpperCase(), 44)}
        </text>
      </g>

      {/* Website graphic */}
      <g className="velho-svg-anim velho-anim-slide-in" style={{ animationDelay: "0.5s" }}>
        <rect x={148} y={140} width={378} height={168} rx={12} fill="#0d1017" stroke="rgba(255,255,255,0.1)" />
        {/* Browser chrome */}
        <rect x={148} y={140} width={378} height={26} rx={12} fill="rgba(255,255,255,0.04)" />
        <rect x={148} y={156} width={378} height={10} fill="rgba(255,255,255,0.04)" />
        <circle cx={164} cy={153} r={3.4} fill="#F87171" />
        <circle cx={176} cy={153} r={3.4} fill="#FBBF24" />
        <circle cx={188} cy={153} r={3.4} fill="#34D399" />
        <rect x={204} y={146} width={250} height={14} rx={7} fill="rgba(255,255,255,0.05)" />
        <text x={212} y={156.5} style={{ fill: "rgba(255,255,255,0.55)", fontSize: 9.5 }}>
          {truncate(domain, 40)}
        </text>

        {/* Page hero */}
        <rect x={164} y={178} width={200} height={12} rx={4} fill={`${accent}66`} />
        <rect x={164} y={198} width={252} height={8} rx={4} fill="rgba(255,255,255,0.14)" />
        <rect x={164} y={212} width={226} height={8} rx={4} fill="rgba(255,255,255,0.1)" />
        <rect x={164} y={234} width={96} height={22} rx={11} fill={palette.primary} opacity={0.85} />
        <text x={212} y={249} textAnchor="middle" style={{ fill: "#0b0d13", fontSize: 10, fontWeight: 700 }}>
          THEIR SITE
        </text>

        {/* Content cards */}
        <rect x={286} y={178} width={112} height={78} rx={8} fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" />
        <rect x={298} y={192} width={88} height={7} rx={3.5} fill="rgba(255,255,255,0.2)" />
        <rect x={298} y={206} width={64} height={6} rx={3} fill="rgba(255,255,255,0.12)" />
        <rect x={298} y={224} width={40} height={20} rx={6} fill={`${accent}44`} />

        {/* Scanning beam, suggesting Velho's agents reading the site */}
        <rect
          x={164}
          y={178}
          width={2.5}
          height={112}
          fill={accent}
          className="velho-svg-anim velho-anim-float"
          opacity={0.7}
          style={{ animationDuration: "2.4s" }}
        />
      </g>

      {/* Personalization chip */}
      <g className="velho-svg-anim velho-anim-rise" style={{ animationDelay: "0.9s" }}>
        <rect x={148} y={322} width={252} height={24} rx={12} fill={`${accent}1c`} stroke={`${accent}44`} />
        <text x={160} y={338} style={{ fill: "rgba(255,255,255,0.8)", fontSize: 11, fontWeight: 600 }}>
          ✦ Prepared exclusively for {truncate(companyName, 18)}
        </text>
      </g>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Phase: problem + solution cartoon                                   */
/* ------------------------------------------------------------------ */

interface CartoonSceneProps {
  scene: CartoonAnimationScene;
  category: BottleneckCategory;
  companyName: string;
  accent: string;
  palette: BrandPalette;
  mode: "problem" | "solution";
  variant: CartoonVariant;
}

/** Returns the hex only if it is bright enough to read on the #08090d stage. */
const legibleOnDark = (hex: string | undefined): string | null => {
  const match = hex?.trim().match(/^#?([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!match) return null;
  const raw = match[1]!.length === 3 ? match[1]!.split("").map((c) => c + c).join("") : match[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const saturation = Math.max(r, g, b) - Math.min(r, g, b);
  // Too dark, or a near-grey that would read as "disabled".
  if (luminance < 0.28 || saturation < 0.12) return null;
  return `#${raw}`;
};

/** Small icons drifting around the problem stage — the "mess". */
function DebrisField({ category, seed }: { category: BottleneckCategory; seed: number }) {
  const icons = CATEGORY_DEBRIS[category];
  // Corners and edges only, so debris never sits on actors or the chain.
  const spots = [
    [58, 92], [584, 88], [66, 214], [580, 214], [190, 72], [450, 74],
  ] as const;
  return (
    <g opacity={0.5}>
      {spots.map(([x, y], i) => {
        const icon = icons[(seed + i) % icons.length]!;
        return (
          <g
            key={i}
            className="velho-svg-anim velho-anim-drift"
            style={{ animationDelay: `${(i * 0.7 + seed % 5) % 3}s`, animationDuration: `${3.2 + (i % 3) * 0.9}s` }}
          >
            <IconGlyph name={icon} x={x} y={y} size={16 + ((seed + i) % 3) * 3} color="#FB923C" strokeWidth={1.6} />
          </g>
        );
      })}
    </g>
  );
}

/** Problem-layout props that make each composition read differently. */
function ProblemProps({ variant, color }: { variant: CartoonVariant; color: string }) {
  switch (variant.problemLayout) {
    case "conveyor":
      // A stalled belt under the items.
      return (
        <g opacity={0.6}>
          <rect x={92} y={204} width={456} height={8} rx={4} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" />
          {Array.from({ length: 12 }, (_, i) => (
            <circle key={i} cx={104 + i * 39} cy={208} r={2} fill="rgba(255,255,255,0.25)" />
          ))}
        </g>
      );
    case "split":
      // A crack between two disconnected silos.
      return (
        <path
          d="M320 96 L310 124 L328 150 L312 178 L326 206"
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeDasharray="5 5"
          className="velho-anim-dash-march"
          opacity={0.7}
        />
      );
    case "orbit":
      // A tangled loop the work keeps circling.
      return (
        <ellipse
          cx={320}
          cy={170}
          rx={190}
          ry={44}
          fill="none"
          stroke={color}
          strokeOpacity={0.35}
          strokeDasharray="3 7"
          className="velho-anim-dash-march"
        />
      );
    case "pileup":
    default:
      // Tangled red connectors between neighbouring items.
      return null;
  }
}

/** Glowing data packets travelling along the solution lanes. */
function PacketLanes({ lanes, color }: { lanes: Array<[number, number, number, number]>; color: string }) {
  return (
    <g>
      {lanes.map(([x1, y1, x2, y2], i) => (
        <g key={i}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeOpacity={0.35} strokeWidth={2} strokeDasharray="4 5" className="velho-anim-dash-march" />
          {[0, 1].map((k) => (
            <circle key={k} r={3.4} fill={color}>
              <animateMotion
                dur="1.6s"
                begin={`${i * 0.4 + k * 0.8}s`}
                repeatCount="indefinite"
                path={`M${x1},${y1} L${x2},${y2}`}
              />
            </circle>
          ))}
        </g>
      ))}
    </g>
  );
}

function CartoonStage({ scene, category, companyName, accent, palette, mode, variant }: CartoonSceneProps) {
  const isSolution = mode === "solution";

  const actors = useMemo(() => {
    const list = scene.actors.length > 0 ? scene.actors : [];
    if (isSolution) {
      // Guarantee the Velho engine is the visual hinge of the solution beat.
      const withoutEngine = list.filter((entry) => !isEngineActor(entry.name));
      const engine = list.find((entry) => isEngineActor(entry.name)) ?? {
        name: "Velho AI Engine",
        icon: "Cog",
        animation_type: "spin_gear" as CartoonAnimationType,
      };
      return { engine, others: withoutEngine.slice(0, variant.solutionLayout === "funnel" ? 3 : 2) };
    }
    return { engine: null, others: list.slice(0, 4) };
  }, [isSolution, scene.actors, variant.solutionLayout]);

  const geometry = isSolution ? solutionGeometry(variant.solutionLayout, actors.others.length) : null;
  const placements: ActorPlacement[] = geometry
    ? geometry.others
    : problemPlacements(variant.problemLayout, actors.others.length);

  // Solution actors pick up the company's brand colour; the output stays green.
  const brandColor = legibleOnDark(palette.primary) ?? legibleOnDark(palette.accent) ?? "#38BDF8";

  return (
    <g>
      {/* NOTE: intentionally no prose here. The stage stays wordless so the
          artwork reads as motion design; narration belongs to the voiceover
          and the single caption strip in VideoPlayer. */}

      {isSolution ? (
        <PacketLanes lanes={geometry!.lanes} color="#10B981" />
      ) : (
        <>
          <DebrisField category={category} seed={variant.debrisSeed} />
          <ProblemProps variant={variant} color="#F43F5E" />
        </>
      )}

      {isSolution && actors.engine && geometry ? (
        <ActorNode actor={actors.engine} placement={geometry.engine} tone="info" accent={accent} isEngine />
      ) : null}

      {actors.others.map((actor, index) => {
        const placement = placements[index] ?? placements[placements.length - 1]!;
        const tone = isSolution
          ? (SOLUTION_TONES[index] ?? "success")
          : (PROBLEM_TONES[index % PROBLEM_TONES.length] ?? "danger");
        // In the funnel the middle slot is the output; elsewhere the last one.
        const isOutput =
          isSolution &&
          (variant.solutionLayout === "funnel" ? index === 1 : index === actors.others.length - 1);
        return (
          <ActorNode
            key={`${actor.name}-${index}`}
            actor={actor}
            placement={placement}
            tone={tone}
            accent={accent}
            colorOverride={isSolution && !isOutput ? brandColor : undefined}
          />
        );
      })}

      <FlowChain steps={scene.flow_diagram_steps} mode={mode} accent={accent} y={252} delayBase={1} />

      {/* Wordless status stamp — a quiet watermark, not a headline. */}
      <text
        x={VIEW_W - 26}
        y={338}
        textAnchor="end"
        style={{ fill: "rgba(255,255,255,0.24)", fontSize: 8.5, fontWeight: 600, letterSpacing: 0.8 }}
      >
        {isSolution ? "VELHO APPLIED INTELLIGENCE" : `${truncate(companyName.toUpperCase(), 28)} · CURRENT STATE`}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Phase: booking (38-45s) — one-click meeting end card                */
/* ------------------------------------------------------------------ */

function BookingScene({
  companyName,
  accent,
}: {
  companyName: string;
  accent: string;
}) {
  return (
    <g>
      <rect
        x={VIEW_W / 2 - 118}
        y={78}
        width={236}
        height={168}
        rx={22}
        fill="rgba(8,9,13,0.72)"
        stroke={`${accent}66`}
        strokeWidth={1.4}
      />
      <rect
        x={VIEW_W / 2 - 118}
        y={78}
        width={236}
        height={28}
        rx={22}
        fill={accent}
        opacity={0.22}
      />
      <circle cx={VIEW_W / 2} cy={148} r={28} fill={`${accent}24`} stroke={accent} strokeWidth={1.6} />
      <IconGlyph
        name="CalendarClock"
        x={VIEW_W / 2}
        y={148}
        size={26}
        color={accent}
        strokeWidth={2}
      />
      <text
        x={VIEW_W / 2}
        y={204}
        textAnchor="middle"
        style={{ fill: "#fff", fontSize: 15, fontWeight: 700, letterSpacing: 0.2 }}
      >
        15-minute walkthrough
      </text>
      <text
        x={VIEW_W / 2}
        y={224}
        textAnchor="middle"
        style={{ fill: "rgba(255,255,255,0.55)", fontSize: 11, fontWeight: 600 }}
      >
        One click for {truncate(companyName, 22)}
      </text>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export default function CartoonAnimator({
  phase,
  cartoonScene,
  category,
  companyName,
  domain,
  glyph,
  industry,
  palette,
  elapsedSec,
  paused,
  playRate = 1,
  className,
}: CartoonAnimatorProps) {
  const mode: CartoonPhase = phase ?? "intro";
  // A near-black or grey brand accent vanishes on the dark stage.
  const accent = legibleOnDark(palette.accent) ?? legibleOnDark(palette.primary) ?? "#7DD3FC";
  const categoryLabel = BOTTLENECK_CATEGORY_LABELS[category] ?? "Operations";
  const variant = useMemo(() => variantForCompany(domain || companyName), [domain, companyName]);

  const title =
    mode === "intro"
      ? `${companyName} — company intro`
      : mode === "problem"
        ? cartoonScene?.visual_metaphor ?? `${companyName} bottleneck`
        : mode === "booking"
          ? `Book a meeting with ${companyName}`
          : cartoonScene?.visual_metaphor ?? `${companyName} solution`;

  return (
    <div
      className={`absolute inset-0 ${paused ? "velho-anim-paused" : ""} ${className ?? ""}`}
      style={{ ["--velho-play-rate" as string]: String(playRate) }}
    >
      <CanvasFrame
        title={title}
        categoryLabel={
          mode === "intro"
            ? "Personalized intro"
            : mode === "booking"
              ? "Book a meeting"
              : categoryLabel
        }
        mode={mode}
        accent={accent}
        backdrop={variant.backdrop}
      >
        {mode === "intro" ? (
          <IntroScene
            companyName={companyName}
            domain={domain}
            glyph={glyph}
            industry={industry}
            palette={palette}
            accent={accent}
            elapsedSec={elapsedSec}
          />
        ) : mode === "booking" ? (
          <BookingScene companyName={companyName} accent={accent} />
        ) : cartoonScene ? (
          <CartoonStage
            key={`${mode}-${cartoonScene.scene_index}`}
            scene={cartoonScene}
            category={category in CATEGORY_DEBRIS ? category : "cross_system_data"}
            companyName={companyName}
            accent={accent}
            palette={palette}
            mode={mode === "problem" ? "problem" : "solution"}
            variant={variant}
          />
        ) : (
          <FallbackStage mode={mode} accent={accent} categoryLabel={categoryLabel} />
        )}
      </CanvasFrame>
    </div>
  );
}

/** Last-resort diagram when neither the agent nor the preset produced a beat. */
function FallbackStage({
  mode,
  accent,
  categoryLabel,
}: {
  mode: "problem" | "solution";
  accent: string;
  categoryLabel: string;
}) {
  const isSolution = mode === "solution";
  const nodes = isSolution
    ? ["Manual Input", "Velho AI Engine", "Automated Output"]
    : [categoryLabel, "Manual Re-Entry", "Errors & Delay"];

  return (
    <g>
      <text x={VIEW_W / 2} y={150} textAnchor="middle" style={{ fill: "rgba(255,255,255,0.7)", fontSize: 16, fontWeight: 700 }}>
        {isSolution ? "Velho automates the workflow" : "The manual bottleneck"}
      </text>
      <FlowChain
        steps={nodes.flatMap((node, index) => (index === 0 ? [node] : ["-->", node]))}
        mode={isSolution ? "solution" : "problem"}
        accent={accent}
        y={180}
        delayBase={0.3}
      />
    </g>
  );
}
