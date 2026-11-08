import type { Canvas } from "../render/canvas";
import type { Series } from "./series";
import type { PerfStats } from "./stats";

/** "compact" is one line (FPS and frame time); "full" is every figure with its graph. */
export type OverlayLayout = "compact" | "full";

export type OverlayCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** One frame's worth of time at 60 Hz, in ms: the graphs' reference line. */
export const FRAME_BUDGET_MS = 1000 / 60;

/** The tallest value a graph scales to. Taller samples are clipped, so a hitch can't flatten it. */
export const GRAPH_MAX_MS = 4 * FRAME_BUDGET_MS;

/** From FPS_GOOD up the FPS shows green; under FPS_BAD, red; in between, yellow. */
export const FPS_GOOD = 55;
export const FPS_BAD = 30;

const FONT_SIZE = 11;
/** Height of one line of text. */
const LINE = 14;
/** Space between the panel's edge and its contents. */
const PAD = 6;
/** Space between the panel and the canvas edge. */
const MARGIN = 8;
/** One pixel per sample, so this is also how many samples a graph shows. */
const GRAPH_WIDTH = 180;
const GRAPH_HEIGHT = 30;
/** Space below a graph. */
const GRAPH_GAP = 4;
/** Width of the now / avg / max columns. */
const COLUMN_WIDTH = 42;

const FULL_WIDTH = GRAPH_WIDTH + 2 * PAD;
const COMPACT_WIDTH = 128;
const COMPACT_HEIGHT = LINE + 2 * PAD;

export const COLORS = {
  background: "rgba(0, 0, 0, 0.7)",
  text: "#e5e7eb",
  dim: "#9ca3af",
  graphBackground: "rgba(255, 255, 255, 0.08)",
  budgetLine: "rgba(255, 255, 255, 0.35)",
  /** Bars of samples that took longer than one 60 Hz frame. */
  overBudget: "#f87171",
  frame: "#60a5fa",
  update: "#34d399",
  render: "#fbbf24",
  fpsGood: "#4ade80",
  fpsOk: "#facc15",
  fpsBad: "#f87171",
} as const;

function ms(value: number): string {
  return value.toFixed(1);
}

function fpsText(stats: PerfStats): { value: string; color: string } {
  if (stats.fps === 0) return { value: "-- fps", color: COLORS.dim };
  const color =
    stats.fps >= FPS_GOOD ? COLORS.fpsGood : stats.fps >= FPS_BAD ? COLORS.fpsOk : COLORS.fpsBad;
  return { value: `${stats.fps} fps`, color };
}

/** Draws text rows and graphs top to bottom inside the panel. */
class Panel {
  private y: number;

  constructor(
    private readonly ctx: CanvasRenderingContext2D,
    private readonly left: number,
    top: number,
    private readonly width: number,
  ) {
    this.y = top;
  }

  private get right(): number {
    return this.left + this.width;
  }

  private text(value: string, x: number, align: CanvasTextAlign, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.textAlign = align;
    this.ctx.fillText(value, x, this.y + 1);
  }

  /** A label on the left and a value on the right. */
  row(
    label: string,
    value: string,
    labelColor: string = COLORS.text,
    valueColor: string = COLORS.text,
  ): void {
    this.text(label, this.left, "left", labelColor);
    this.text(value, this.right, "right", valueColor);
    this.y += LINE;
  }

  /** A label on the left and right-aligned columns, the last one at the right edge. */
  columns(label: string, values: string[], color: string = COLORS.text): void {
    if (label !== "") this.text(label, this.left, "left", color);
    values.forEach((value, i) => {
      this.text(value, this.right - (values.length - 1 - i) * COLUMN_WIDTH, "right", color);
    });
    this.y += LINE;
  }

  /**
   * A bar per sample, newest at the right, with a line at one 60 Hz frame; bars over it
   * are red. Two frames fill the height, or up to four when a sample is that tall;
   * anything taller is clipped.
   */
  graph(series: Series, color: string): void {
    const { ctx } = this;
    const top = this.y;
    const bottom = top + GRAPH_HEIGHT;
    ctx.fillStyle = COLORS.graphBackground;
    ctx.fillRect(this.left, top, this.width, GRAPH_HEIGHT);

    const scale = Math.min(GRAPH_MAX_MS, Math.max(2 * FRAME_BUDGET_MS, series.max));
    const budgetY = bottom - Math.round((GRAPH_HEIGHT * FRAME_BUDGET_MS) / scale);
    ctx.fillStyle = COLORS.budgetLine;
    ctx.fillRect(this.left, budgetY, this.width, 1);

    const shown = Math.min(series.length, this.width);
    const first = series.length - shown;
    for (let i = 0; i < shown; i++) {
      const value = series.at(first + i);
      const height = Math.min(GRAPH_HEIGHT, Math.ceil((GRAPH_HEIGHT * value) / scale));
      if (height <= 0) continue;
      ctx.fillStyle = value > FRAME_BUDGET_MS ? COLORS.overBudget : color;
      ctx.fillRect(this.right - shown + i, bottom - height, 1, height);
    }
    this.y = bottom + GRAPH_GAP;
  }
}

function fullHeight(stats: PerfStats): number {
  const graphs = 3 * (LINE + GRAPH_HEIGHT + GRAPH_GAP);
  const footer = stats.heapBytes === null ? 2 * LINE : 3 * LINE;
  return 2 * PAD + 2 * LINE + graphs + footer;
}

function drawCompact(panel: Panel, stats: PerfStats): void {
  const fps = fpsText(stats);
  panel.row(fps.value, `${ms(stats.frameTime.last)} ms`, fps.color);
}

function drawFull(panel: Panel, stats: PerfStats): void {
  const fps = fpsText(stats);
  panel.row(fps.value, `${ms(stats.frameTime.last)} ms`, fps.color);
  panel.columns("", ["now", "avg", "max"], COLORS.dim);
  const series: [string, Series, string][] = [
    ["frame", stats.frameTime, COLORS.frame],
    ["update", stats.updateTime, COLORS.update],
    ["render", stats.renderTime, COLORS.render],
  ];
  for (const [label, values, color] of series) {
    panel.columns(label, [ms(values.last), ms(values.average), ms(values.max)]);
    panel.graph(values, color);
  }
  panel.row("steps", String(stats.steps));
  panel.row("entities", String(stats.entities));
  if (stats.heapBytes !== null) {
    panel.row("heap", `${(stats.heapBytes / (1024 * 1024)).toFixed(1)} MB`);
  }
}

/** Draws the overlay panel in the chosen corner of the canvas. */
export function drawPerfOverlay(
  canvas: Canvas,
  stats: PerfStats,
  layout: OverlayLayout,
  corner: OverlayCorner,
): void {
  const { ctx } = canvas;
  const width = layout === "compact" ? COMPACT_WIDTH : FULL_WIDTH;
  const height = layout === "compact" ? COMPACT_HEIGHT : fullHeight(stats);
  const x = corner.endsWith("right") ? canvas.width - width - MARGIN : MARGIN;
  const y = corner.startsWith("bottom") ? canvas.height - height - MARGIN : MARGIN;

  ctx.save();
  ctx.font = `${FONT_SIZE}px monospace`;
  ctx.textBaseline = "top";
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(x, y, width, height);
  const panel = new Panel(ctx, x + PAD, y + PAD, width - 2 * PAD);
  if (layout === "compact") drawCompact(panel, stats);
  else drawFull(panel, stats);
  ctx.restore();
}
