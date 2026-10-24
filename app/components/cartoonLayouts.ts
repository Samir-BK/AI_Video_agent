import type { ProblemLayout, SolutionLayout } from "@/lib/cartoonPersonalize";

/**
 * Stage geometry for the cartoon. Each company is assigned one problem and
 * one solution composition (deterministically, from its domain), so two
 * companies in the same category no longer get an identical film.
 * Everything is authored against the 640x360 viewBox and keeps actors in
 * y ∈ [100, 200] so the flow chain (y≈252) and caption scrim stay clear.
 */

export interface ActorPlacement {
  x: number;
  y: number;
  size: number;
  /** Animation delay in seconds, so actors arrive in sequence. */
  delay: number;
}

/** Spread `count` points evenly across [left, right]. */
const spread = (count: number, left: number, right: number): number[] =>
  count <= 1
    ? [(left + right) / 2]
    : Array.from({ length: count }, (_, i) => left + ((right - left) * i) / (count - 1));

export const problemPlacements = (layout: ProblemLayout, count: number): ActorPlacement[] => {
  const n = Math.max(1, Math.min(count, 4));
  const xs = spread(n, n >= 4 ? 120 : 150, n >= 4 ? 520 : 490);

  switch (layout) {
    case "orbit": {
      // Actors circle a central "jam" — the team caught in the middle.
      const cx = 320;
      const cy = 150;
      return Array.from({ length: n }, (_, i) => {
        const angle = Math.PI + (Math.PI * i) / Math.max(n - 1, 1);
        return {
          x: cx + Math.cos(angle) * 190,
          y: cy + Math.sin(angle) * 40 + 20,
          size: 46,
          delay: i * 0.22,
        };
      });
    }
    case "conveyor":
      // Items stuck on a stalled belt, in a straight line.
      return xs.map((x, i) => ({ x, y: 170, size: 46, delay: i * 0.3 }));
    case "split":
      // Two silos facing each other across a gap.
      return xs.map((x, i) => ({
        x: i < n / 2 ? x - 24 : x + 24,
        y: i % 2 === 0 ? 132 : 182,
        size: 48,
        delay: i * 0.25,
      }));
    case "pileup":
    default:
      // A zig-zag traffic jam of manual work.
      return xs.map((x, i) => ({
        x,
        y: i % 2 === 0 ? 124 : 182,
        size: i % 2 === 0 ? 48 : 52,
        delay: i * 0.22,
      }));
  }
};

export interface SolutionGeometry {
  engine: ActorPlacement;
  /** Non-engine actors, in order: inputs then outputs. */
  others: ActorPlacement[];
  /** Straight segments packets travel along: [x1, y1, x2, y2]. */
  lanes: Array<[number, number, number, number]>;
}

export const solutionGeometry = (layout: SolutionLayout, count: number): SolutionGeometry => {
  const n = Math.max(1, Math.min(count, 3));
  switch (layout) {
    case "pipeline": {
      // Left-to-right production line; the engine is the middle station.
      const engine = { x: 320, y: 158, size: 70, delay: 0.3 };
      const others = [
        { x: 130, y: 158, size: 46, delay: 0.1 },
        { x: 510, y: 158, size: 48, delay: 0.6 },
        { x: 510, y: 158, size: 48, delay: 0.6 },
      ].slice(0, n);
      return { engine, others, lanes: [[160, 158, 280, 158], [360, 158, 480, 158]] };
    }
    case "funnel": {
      // Many messy inputs converge into the engine, one clean output leaves.
      const engine = { x: 360, y: 150, size: 72, delay: 0.3 };
      const others = [
        { x: 150, y: 112, size: 42, delay: 0.1 },
        { x: 530, y: 150, size: 50, delay: 0.7 },
        { x: 150, y: 192, size: 42, delay: 0.25 },
      ].slice(0, n);
      const lanes: Array<[number, number, number, number]> = [
        [176, 116, 318, 146],
        [402, 150, 500, 150],
      ];
      if (n >= 3) lanes.push([176, 188, 318, 156]);
      return { engine, others, lanes };
    }
    case "hub":
    default: {
      const engine = { x: 344, y: 150, size: 76, delay: 0.3 };
      const others = [
        { x: 200, y: 150, size: 50, delay: 0.1 },
        { x: 488, y: 150, size: 50, delay: 0.55 },
        { x: 488, y: 150, size: 50, delay: 0.55 },
      ].slice(0, n);
      return { engine, others, lanes: [[230, 150, 298, 150], [392, 150, 458, 150]] };
    }
  }
};
