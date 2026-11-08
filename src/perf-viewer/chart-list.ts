import { chartMax, drawChart } from "./chart";
import type { PerfLogData } from "./log-file";
import { formatValue, METRICS, type Metric } from "./metrics";
import { summarize } from "./series";
import { rowsInWindow, type TimeWindow } from "./time-window";

/** One chart's DOM, kept between redraws so the page does not flicker. */
interface ChartElements {
  metric: Metric;
  section: HTMLElement;
  summary: HTMLElement;
  canvas: HTMLCanvasElement;
}

export interface ChartList {
  /** Makes a chart for each metric the log has. Call again when that may have changed. */
  build(data: PerfLogData): void;
  /** Redraws every chart for the window; returns how many frames are in it. */
  redraw(data: PerfLogData, window: TimeWindow, showInputs?: boolean): number;
  /** Shows a message instead of charts. */
  showMessage(text: string): void;
}

/** A column of charts, one per metric, in the container. */
export function mountCharts(container: HTMLElement): ChartList {
  let charts: ChartElements[] = [];
  let built: PerfLogData | null = null;

  const build = (data: PerfLogData): void => {
    charts = [];
    for (const metric of METRICS) {
      if (metric.available && !metric.available(data)) continue;
      const section = document.createElement("section");
      section.className = "chart";
      const heading = document.createElement("h3");
      const title = document.createElement("span");
      title.textContent = metric.unit === "" ? metric.label : `${metric.label} (${metric.unit})`;
      const summary = document.createElement("span");
      summary.className = "summary";
      heading.append(title, summary);
      const canvas = document.createElement("canvas");
      section.append(heading, canvas);
      charts.push({ metric, section, summary, canvas });
    }
    container.replaceChildren(...charts.map((chart) => chart.section));
    built = data;
  };

  const redraw = (data: PerfLogData, window: TimeWindow, showInputs = true): number => {
    // A live feed may gain a metric (the heap) after the first rows.
    const wanted = METRICS.filter((metric) => !metric.available || metric.available(data));
    if (built !== data || wanted.length !== charts.length) build(data);
    const rows = rowsInWindow(data.rows, window);
    const dpr = globalThis.devicePixelRatio || 1;
    for (const { metric, summary, canvas } of charts) {
      const stats = summarize(rows, metric.value);
      summary.textContent = stats
        ? `avg ${formatValue(metric, stats.avg)} · min ${formatValue(metric, stats.min)}` +
          ` · max ${formatValue(metric, stats.max)}`
        : "no data in this window";
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      // Setting the size clears the canvas, so only do it when it changed.
      if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
      if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawChart(ctx, rows, metric, {
        width,
        height,
        window,
        start: data.start,
        sceneChanges: data.sceneChanges,
        maxValue: chartMax(rows, metric),
        showInputs,
      });
    }
    return rows.length;
  };

  const showMessage = (text: string): void => {
    charts = [];
    built = null;
    const hint = document.createElement("p");
    hint.className = "empty";
    hint.textContent = text;
    container.replaceChildren(hint);
  };

  return { build, redraw, showMessage };
}
