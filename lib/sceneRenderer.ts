import type { BrandPalette } from "@/types/pipeline";

/**
 * Pure canvas drawing for the 20-second video player's graphic layer.
 *
 * Each scene gets a distinct, recognizable motion language so the video reads
 * as three deliberate beats rather than one generic animation:
 *   scene 1 -> accumulating load (the problem)
 *   scene 2 -> converging nodes (the automation)
 *   scene 3 -> rising trend (the outcome)
 *
 * All drawing is deterministic given (scene, progress, time) so pausing and
 * seeking render identical frames.
 */

export interface SceneRenderOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** 1-based scene index. */
  sceneId: number;
  /** Progress within the current scene, 0..1. */
  progress: number;
  /** Monotonic time in ms, used for continuous ambient motion. */
  timeMs: number;
  palette: BrandPalette;
  /** Stable per-domain seed so visuals differ between companies. */
  seed: number;
}

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace("#", "");
  const full =
    clean.length === 3
      ? `${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`
      : clean;
  const value = Number.parseInt(full, 16);
  if (Number.isNaN(value)) return [56, 189, 248];
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
};

const rgba = (hex: string, alpha: number): string => {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInOutSine = (t: number): number =>
  -(Math.cos(Math.PI * t) - 1) / 2;

/** Deterministic pseudo-random in [0,1) from an integer seed. */
const rand = (n: number): number => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

/* ------------------------------------------------------------------ */
/* Shared layers                                                       */
/* ------------------------------------------------------------------ */

const drawBackdrop = ({
  ctx,
  width,
  height,
  palette,
  timeMs,
}: SceneRenderOptions): void => {
  ctx.fillStyle = "#08090d";
  ctx.fillRect(0, 0, width, height);

  // Slow-drifting brand glow.
  const drift = Math.sin(timeMs / 4200) * width * 0.06;
  const glow = ctx.createRadialGradient(
    width * 0.3 + drift,
    height * 0.32,
    0,
    width * 0.3 + drift,
    height * 0.32,
    Math.max(width, height) * 0.72,
  );
  glow.addColorStop(0, rgba(palette.primary, 0.22));
  glow.addColorStop(0.45, rgba(palette.secondary, 0.09));
  glow.addColorStop(1, "rgba(8, 9, 13, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // Faint technical grid.
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
  ctx.lineWidth = 1;
  const cell = Math.max(28, Math.round(width / 26));
  const offset = (timeMs / 90) % cell;
  for (let x = -cell + offset; x < width + cell; x += cell) {
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, height);
    ctx.stroke();
  }
  for (let y = -cell + offset; y < height + cell; y += cell) {
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(width, Math.round(y) + 0.5);
    ctx.stroke();
  }
  ctx.restore();
};

const drawVignette = ({ ctx, width, height }: SceneRenderOptions): void => {
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.35,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.78,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
};

/* ------------------------------------------------------------------ */
/* Scene 1 — accumulating load                                         */
/* ------------------------------------------------------------------ */

const drawSceneOne = (options: SceneRenderOptions): void => {
  const { ctx, width, height, progress, palette, timeMs, seed } = options;
  const eased = easeOutCubic(Math.min(1, progress * 1.35));

  const barWidth = Math.min(width * 0.4, 190);
  const barHeight = 13;
  const gap = 9;
  const total = 7;
  const baseX = width * 0.5 - barWidth / 2;
  const baseY = height * 0.5 - ((barHeight + gap) * total) / 2;

  // Stacked documents building up, tilting as pressure increases.
  for (let i = 0; i < total; i += 1) {
    const appearAt = (i / total) * 0.85;
    if (eased < appearAt) continue;

    const localT = Math.min(1, (eased - appearAt) / 0.15);
    const wobble = Math.sin(timeMs / 700 + i * 1.3) * 1.6;
    const tilt = (rand(i + seed) - 0.5) * 0.05 * (1 + eased);
    const y = baseY + i * (barHeight + gap) + wobble;

    ctx.save();
    ctx.translate(baseX + barWidth / 2, y + barHeight / 2);
    ctx.rotate(tilt);
    ctx.globalAlpha = localT;

    // Document body.
    const isLast = i === total - 1;
    ctx.fillStyle = isLast
      ? rgba(palette.primary, 0.32)
      : "rgba(255, 255, 255, 0.07)";
    ctx.strokeStyle = isLast
      ? rgba(palette.accent, 0.75)
      : "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const w = barWidth * (0.72 + rand(i * 3 + seed) * 0.28);
    const h = barHeight * localT;
    const radius = 4;
    ctx.roundRect(-w / 2, -h / 2, w, h, radius);
    ctx.fill();
    ctx.stroke();

    // Text lines inside the document.
    if (localT > 0.6 && w > 80) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
      const lineY = -h / 2 + h * 0.5 - 1.5;
      ctx.fillRect(-w / 2 + 10, lineY, w * 0.42, 2.5);
      ctx.fillRect(-w / 2 + 10, lineY + 5, w * 0.26, 2.5);
    }
    ctx.restore();
  }

  // Rising "hours lost" counter bar.
  const gaugeY = baseY + total * (barHeight + gap) + 14;
  const gaugeW = barWidth;
  ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
  ctx.beginPath();
  ctx.roundRect(baseX, gaugeY, gaugeW, 5, 3);
  ctx.fill();

  const fill = gaugeW * easeInOutSine(Math.min(1, progress));
  const gaugeGradient = ctx.createLinearGradient(baseX, 0, baseX + gaugeW, 0);
  gaugeGradient.addColorStop(0, rgba(palette.secondary, 0.9));
  gaugeGradient.addColorStop(1, rgba(palette.accent, 0.95));
  ctx.fillStyle = gaugeGradient;
  ctx.beginPath();
  ctx.roundRect(baseX, gaugeY, Math.max(fill, 3), 5, 3);
  ctx.fill();

  // Pulsing warning dot next to the gauge.
  const pulse = 0.5 + Math.sin(timeMs / 260) * 0.5;
  ctx.fillStyle = rgba(palette.accent, 0.35 + pulse * 0.5);
  ctx.beginPath();
  ctx.arc(baseX - 12, gaugeY + 2.5, 3 + pulse * 1.6, 0, Math.PI * 2);
  ctx.fill();
};

/* ------------------------------------------------------------------ */
/* Scene 2 — converging nodes                                          */
/* ------------------------------------------------------------------ */

interface Node {
  x: number;
  y: number;
  r: number;
  phase: number;
}

const drawSceneTwo = (options: SceneRenderOptions): void => {
  const { ctx, width, height, progress, palette, timeMs, seed } = options;

  const cx = width / 2;
  const cy = height * 0.5;
  const orbit = Math.min(width * 0.3, height * 0.34);

  const nodeCount = 6;
  const nodes: Node[] = [];
  for (let i = 0; i < nodeCount; i += 1) {
    const angle = (i / nodeCount) * Math.PI * 2 + rand(i + seed) * 0.5;
    nodes.push({
      x: cx + Math.cos(angle) * orbit,
      y: cy + Math.sin(angle) * orbit * 0.72,
      r: 3.5 + rand(i * 7 + seed) * 2.5,
      phase: rand(i * 13 + seed) * Math.PI * 2,
    });
  }

  const converge = easeInOutSine(Math.min(1, progress * 1.15));

  // Connecting lines that tighten toward the centre.
  ctx.lineWidth = 1.2;
  for (const node of nodes) {
    const t = converge;
    const endX = cx + (node.x - cx) * (1 - t * 0.82);
    const endY = cy + (node.y - cy) * (1 - t * 0.82);

    const gradient = ctx.createLinearGradient(node.x, node.y, cx, cy);
    gradient.addColorStop(0, rgba(palette.primary, 0.05 + t * 0.3));
    gradient.addColorStop(1, rgba(palette.accent, 0.1 + t * 0.55));

    ctx.strokeStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(node.x, node.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();

    // Travelling pulse along the connection.
    const pulseT = ((timeMs / 1400 + node.phase / 6.28) % 1);
    const px = node.x + (endX - node.x) * pulseT;
    const py = node.y + (endY - node.y) * pulseT;
    ctx.fillStyle = rgba(palette.accent, 0.85);
    ctx.beginPath();
    ctx.arc(px, py, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // Outer nodes.
  for (const node of nodes) {
    const bob = Math.sin(timeMs / 900 + node.phase) * 3;
    ctx.fillStyle = rgba(palette.primary, 0.9);
    ctx.beginPath();
    ctx.arc(node.x, node.y + bob, node.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = rgba(palette.accent, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(node.x, node.y + bob, node.r + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Central processing core.
  const coreR = 15 + converge * 9;
  const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3.1);
  halo.addColorStop(0, rgba(palette.accent, 0.5 * converge + 0.15));
  halo.addColorStop(1, "rgba(8,9,13,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR * 3.1, 0, Math.PI * 2);
  ctx.fill();

  // Rotating ring segments.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(timeMs / 1600);
  ctx.strokeStyle = rgba(palette.accent, 0.9);
  ctx.lineWidth = 2.4;
  for (let i = 0; i < 3; i += 1) {
    ctx.beginPath();
    ctx.arc(0, 0, coreR, (i * Math.PI * 2) / 3, (i * Math.PI * 2) / 3 + 1.1);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = rgba(palette.accent, 0.95);
  ctx.beginPath();
  ctx.arc(cx, cy, coreR * 0.42 + converge * 2, 0, Math.PI * 2);
  ctx.fill();
};

/* ------------------------------------------------------------------ */
/* Scene 3 — rising trend                                              */
/* ------------------------------------------------------------------ */

const drawSceneThree = (options: SceneRenderOptions): void => {
  const { ctx, width, height, progress, palette, timeMs, seed } = options;

  const chartW = Math.min(width * 0.62, 320);
  const chartH = Math.min(height * 0.34, 130);
  const left = width / 2 - chartW / 2;
  const top = height * 0.5 - chartH / 2 + 10;

  // Axis baseline.
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, top + chartH);
  ctx.lineTo(left + chartW, top + chartH);
  ctx.stroke();

  const points = 7;
  const coords: [number, number][] = [];
  for (let i = 0; i < points; i += 1) {
    const t = i / (points - 1);
    const x = left + t * chartW;
    // Accelerating upward curve with a little deterministic noise.
    const curve = Math.pow(t, 1.7);
    const noise = (rand(i * 5 + seed) - 0.5) * 0.09;
    const y = top + chartH - (curve + noise) * chartH * 0.92;
    coords.push([x, y]);
  }

  // Reveal the line progressively with the scene progress.
  const reveal = easeOutCubic(Math.min(1, progress * 1.1));
  const drawnPoints = Math.max(2, Math.ceil(reveal * points));
  const visible = coords.slice(0, drawnPoints);

  // Area fill under the visible line.
  const lastPoint = visible[visible.length - 1];
  if (lastPoint) {
    const areaGradient = ctx.createLinearGradient(0, top, 0, top + chartH);
    areaGradient.addColorStop(0, rgba(palette.primary, 0.32));
    areaGradient.addColorStop(1, "rgba(8,9,13,0)");

    ctx.beginPath();
    ctx.moveTo(visible[0]![0], top + chartH);
    for (const [x, y] of visible) ctx.lineTo(x, y);
    ctx.lineTo(lastPoint[0], top + chartH);
    ctx.closePath();
    ctx.fillStyle = areaGradient;
    ctx.fill();

    // Trend line.
    const lineGradient = ctx.createLinearGradient(left, 0, left + chartW, 0);
    lineGradient.addColorStop(0, palette.secondary);
    lineGradient.addColorStop(1, palette.accent);
    ctx.strokeStyle = lineGradient;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(visible[0]![0], visible[0]![1]);
    for (const [x, y] of visible) ctx.lineTo(x, y);
    ctx.stroke();

    // Leading marker with a pulsing halo.
    const pulse = 0.5 + Math.sin(timeMs / 240) * 0.5;
    ctx.fillStyle = rgba(palette.accent, 0.18 + pulse * 0.22);
    ctx.beginPath();
    ctx.arc(lastPoint[0], lastPoint[1], 11 + pulse * 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(lastPoint[0], lastPoint[1], 4, 0, Math.PI * 2);
    ctx.fill();

    // Data point dots.
    for (const [x, y] of visible) {
      ctx.fillStyle = rgba(palette.accent, 0.85);
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Floating achievement chips.
  const chips = ["Automated", "Same-day", "Measurable"];
  chips.forEach((label, index) => {
    const appearAt = 0.25 + index * 0.2;
    if (progress < appearAt) return;

    const t = Math.min(1, (progress - appearAt) / 0.25);
    const chipY = top - 22 - index * 0 + index * 0;
    const chipW = 92;
    const chipH = 22;
    const chipX = left + chartW - chipW - index * 6;

    ctx.save();
    ctx.globalAlpha = t;
    ctx.translate(0, (1 - t) * 8);

    ctx.fillStyle = rgba(palette.primary, 0.18);
    ctx.strokeStyle = rgba(palette.accent, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(chipX, chipY + index * 26 - 46, chipW, chipH, 11);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = rgba(palette.accent, 0.95);
    ctx.font =
      "600 11px ui-sans-serif, -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, chipX + chipW / 2, chipY + index * 26 - 46 + chipH / 2);
    ctx.restore();
  });
};

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export const renderScene = (options: SceneRenderOptions): void => {
  const { ctx, width, height, sceneId } = options;
  if (width <= 0 || height <= 0) return;

  ctx.save();
  ctx.clearRect(0, 0, width, height);

  drawBackdrop(options);

  if (sceneId === 1) drawSceneOne(options);
  else if (sceneId === 2) drawSceneTwo(options);
  else drawSceneThree(options);

  drawVignette(options);
  ctx.restore();
};

/**
 * Ensure the canvas backing store matches its CSS size and the device pixel
 * ratio, so drawings stay crisp on retina displays.
 */
export const resizeCanvas = (
  canvas: HTMLCanvasElement,
  cssWidth: number,
  cssHeight: number,
): CanvasRenderingContext2D | null => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const targetW = Math.max(1, Math.round(cssWidth * dpr));
  const targetH = Math.max(1, Math.round(cssHeight * dpr));

  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
};
