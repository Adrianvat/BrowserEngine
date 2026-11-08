import type { LogRow } from "./log-file";
import { formatValue, type Metric } from "./metrics";
import { bucketize, niceMax, timeStep } from "./series";
import { formatTime, type TimeWindow } from "./time-window";

/** Room around the plot for labels, in CSS pixels: two rows above it (scenes, then inputs). */
export const PLOT_MARGIN = { left: 56, right: 12, top: 32, bottom: 20 } as const;

/** Input markers closer together than this (px) share one label, so labels stay readable. */
const INPUT_LABEL_SPACING = 36;

export const CHART_COLORS = {
  background: "#18181b",
  grid: "#3f3f46",
  text: "#a1a1aa",
  reference: "#f87171",
  scene: "#e5e7eb",
  input: "#22d3ee",
} as const;

export interface ChartView {
  /** Size of the drawing area in CSS pixels. */
  width: number;
  height: number;
  window: TimeWindow;
  /** The log's first time: the time axis counts from it. */
  start: number;
  /** Scene changes to mark; those outside the window are skipped. */
  sceneChanges: readonly { time: number; scene: string }[];
  /** Top of the value axis. Use `niceMax` of the largest value (and reference) to get one. */
  maxValue: number;
  /** Mark the frames in which keys were pressed. Default true. */
  showInputs?: boolean;
}

/** A vertical marker: the keys pressed in the frames that share this pixel column. */
export interface InputMarker {
  /** Pixel column within the plot. */
  column: number;
  /** E.g. "KeyA Space". */
  label: string;
}

/** Where the rows with key presses fall, one marker per pixel column. */
export function inputMarkers(rows: LogRow[], window: TimeWindow, columns: number): InputMarker[] {
  const markers: InputMarker[] = [];
  const span = window.to - window.from;
  if (columns <= 0 || span <= 0) return markers;
  for (const row of rows) {
    if (row.inputs.length === 0) continue;
    const column = Math.min(columns - 1, Math.floor(((row.time - window.from) / span) * columns));
    if (column < 0) continue;
    const last = markers[markers.length - 1];
    if (last && last.column === column) last.label += ` ${row.inputs.join(" ")}`;
    else markers.push({ column, label: row.inputs.join(" ") });
  }
  return markers;
}

/** Tints a hex color like "#60a5fa" with an alpha. */
function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A grid line's label: integer metrics still show a half (e.g. "2.5") rather than rounding it. */
export function gridLabel(metric: Metric, value: number): string {
  if (metric.decimals > 0 || Number.isInteger(value)) return formatValue(metric, value);
  return formatValue({ ...metric, decimals: 1 }, value);
}

/** The plot's pixel box within the chart. */
export function plotBox(width: number, height: number) {
  const left = PLOT_MARGIN.left;
  const top = PLOT_MARGIN.top;
  return {
    left,
    top,
    width: Math.max(1, Math.floor(width - left - PLOT_MARGIN.right)),
    height: Math.max(1, height - top - PLOT_MARGIN.bottom),
  };
}

/** The top of the value axis for these rows: round, and never below the metric's minScale. */
export function chartMax(rows: LogRow[], metric: Metric): number {
  let max = metric.minScale ?? 0;
  for (const row of rows) {
    const v = metric.value(row);
    if (v !== null && v > max) max = v;
  }
  return niceMax(max);
}

/**
 * Draws one metric over the window: a min-max band and a mean line per pixel column,
 * value grid lines, time ticks, the metric's reference line and scene-change markers.
 */
export function drawChart(
  ctx: CanvasRenderingContext2D,
  rows: LogRow[],
  metric: Metric,
  view: ChartView,
): void {
  const { width, height, window } = view;
  const plot = plotBox(width, height);
  const right = plot.left + plot.width;
  const bottom = plot.top + plot.height;
  const maxValue = view.maxValue > 0 ? view.maxValue : 1;
  const yOf = (value: number) => bottom - (Math.min(value, maxValue) / maxValue) * plot.height;
  const xOf = (time: number) =>
    plot.left + ((time - window.from) / (window.to - window.from)) * plot.width;

  ctx.save();
  ctx.fillStyle = CHART_COLORS.background;
  ctx.fillRect(0, 0, width, height);
  ctx.font = "11px system-ui, sans-serif";
  ctx.lineWidth = 1;

  // Value grid: four bands with a label at each line.
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const value = (maxValue * i) / 4;
    const y = Math.round(yOf(value)) + 0.5;
    ctx.strokeStyle = CHART_COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.fillStyle = CHART_COLORS.text;
    ctx.fillText(gridLabel(metric, value), plot.left - 6, y);
  }

  // Time ticks, counted from the log's start.
  const step = timeStep(window.to - window.from, plot.width);
  const firstTick = Math.ceil((window.from - view.start) / step) * step + view.start;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let time = firstTick; time <= window.to; time += step) {
    const x = Math.round(xOf(time)) + 0.5;
    ctx.strokeStyle = CHART_COLORS.grid;
    ctx.beginPath();
    ctx.moveTo(x, bottom);
    ctx.lineTo(x, bottom + 4);
    ctx.stroke();
    ctx.fillStyle = CHART_COLORS.text;
    ctx.fillText(formatTime(time - view.start), x, bottom + 6);
  }

  // The data: a band from each column's min to its max, then the means joined up.
  const buckets = bucketize(rows, metric.value, window, plot.width);
  ctx.fillStyle = withAlpha(metric.color, 0.35);
  for (const [column, bucket] of buckets.entries()) {
    if (!bucket) continue;
    const top = yOf(bucket.max);
    const base = yOf(bucket.min);
    ctx.fillRect(plot.left + column, top, 1, Math.max(1, base - top));
  }
  // Joined across empty columns, so a short log (fewer frames than pixels) still reads as a line.
  ctx.strokeStyle = metric.color;
  ctx.beginPath();
  let pen = false;
  for (const [column, bucket] of buckets.entries()) {
    if (!bucket) continue;
    const x = plot.left + column + 0.5;
    const y = yOf(bucket.avg);
    if (pen) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    pen = true;
  }
  ctx.stroke();

  if (metric.reference !== undefined && metric.reference <= maxValue) {
    const y = Math.round(yOf(metric.reference)) + 0.5;
    ctx.strokeStyle = CHART_COLORS.reference;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(plot.left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  for (const change of view.sceneChanges) {
    if (change.time < window.from || change.time > window.to) continue;
    const x = Math.round(xOf(change.time)) + 0.5;
    ctx.strokeStyle = CHART_COLORS.scene;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = CHART_COLORS.scene;
    ctx.fillText(change.scene, Math.min(x + 3, right - 40), plot.top - 15);
  }

  // Key presses: a line in each frame's column; markers close together share a label.
  if (view.showInputs ?? true) {
    const labels: { x: number; text: string }[] = [];
    for (const marker of inputMarkers(rows, window, plot.width)) {
      const x = plot.left + marker.column + 0.5;
      ctx.strokeStyle = CHART_COLORS.input;
      ctx.beginPath();
      ctx.moveTo(x, plot.top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      const last = labels[labels.length - 1];
      if (last && x - last.x < INPUT_LABEL_SPACING) last.text += ` ${marker.label}`;
      else labels.push({ x, text: marker.label });
    }
    ctx.fillStyle = CHART_COLORS.input;
    for (const label of labels) {
      ctx.fillText(label.text, Math.min(label.x + 3, right - 40), plot.top - 3);
    }
  }
  ctx.restore();
}
