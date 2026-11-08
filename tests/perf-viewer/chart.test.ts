import { describe, expect, it } from "vitest";
import {
  CHART_COLORS,
  chartMax,
  drawChart,
  gridLabel,
  inputMarkers,
  PLOT_MARGIN,
  plotBox,
  type ChartView,
} from "../../src/perf-viewer/chart";
import type { LogRow } from "../../src/perf-viewer/log-file";
import { formatValue, METRICS, type Metric } from "../../src/perf-viewer/metrics";
import { recordingCanvas, type Call } from "../helpers/recording-canvas";

function row(
  time: number,
  frameMs: number,
  scene = "play",
  heapBytes: number | null = null,
  inputs: string[] = [],
): LogRow {
  return {
    frame: 0,
    time,
    scene,
    frameMs,
    updateMs: 0.5,
    renderMs: 1,
    steps: 1,
    entities: 3,
    heapBytes,
    fps: 60,
    inputs,
  };
}

function metric(id: string): Metric {
  const found = METRICS.find((m) => m.id === id);
  if (!found) throw new Error(`No metric ${id}`);
  return found;
}

// A 300 x 112 chart: the plot spans x 56..288 (232 px) and y 32..92 (60 px).
const WIDTH = 300;
const HEIGHT = 112;

function view(overrides: Partial<ChartView> = {}): ChartView {
  return {
    width: WIDTH,
    height: HEIGHT,
    window: { from: 1000, to: 11_000 },
    start: 1000,
    sceneChanges: [],
    maxValue: 20,
    ...overrides,
  };
}

function calls(name: string, calls: Call[]): Call[] {
  return calls.filter((call) => call[0] === name);
}

describe("metrics", () => {
  it("cover every logged value, and the heap only when the log has it", () => {
    expect(METRICS.map((m) => m.id)).toEqual([
      "frame", "update", "render", "fps", "steps", "entities", "heap",
    ]);
    const heap = metric("heap");
    expect(heap.available?.({ hasHeap: false } as never)).toBe(false);
    expect(heap.value(row(0, 16, "play", 2 * 1024 * 1024))).toBe(2);
    expect(heap.value(row(0, 16))).toBeNull();
  });

  it("formatValue adds the unit and uses the metric's decimals", () => {
    expect(formatValue(metric("frame"), 16.666)).toBe("16.7 ms");
    expect(formatValue(metric("entities"), 12)).toBe("12");
  });

  it("gridLabel keeps halves on integer metrics", () => {
    expect(gridLabel(metric("entities"), 2.5)).toBe("2.5");
    expect(gridLabel(metric("entities"), 5)).toBe("5");
    expect(gridLabel(metric("update"), 2.5)).toBe("2.50 ms");
  });
});

describe("chartMax", () => {
  it("rounds the largest value up, never below the metric's minimum scale", () => {
    expect(chartMax([row(0, 12), row(1, 14)], metric("frame"))).toBe(20); // min scale 16.7 -> 20
    expect(chartMax([row(0, 12), row(1, 140)], metric("frame"))).toBe(200);
    expect(chartMax([row(0, 12)], metric("update"))).toBe(0.5); // follows the data
    expect(chartMax([], metric("update"))).toBe(1);
  });
});

describe("plotBox", () => {
  it("leaves room for the labels", () => {
    expect(plotBox(WIDTH, HEIGHT)).toEqual({ left: 56, top: 32, width: 232, height: 60 });
    expect(PLOT_MARGIN).toEqual({ left: 56, right: 12, top: 32, bottom: 20 });
    expect(plotBox(10, 10)).toEqual({ left: 56, top: 32, width: 1, height: 1 });
  });
});

describe("drawChart", () => {
  it("clears to the background and draws the value grid with labels", () => {
    const { canvas, calls: all, texts } = recordingCanvas(WIDTH, HEIGHT);
    drawChart(canvas.ctx, [], metric("frame"), view());
    expect(all[0]).toEqual(["save"]);
    expect(all[1]).toEqual(["fillRect", CHART_COLORS.background, 0, 0, WIDTH, HEIGHT]);
    const labels = texts.filter((text) => text.textAlign === "right");
    expect(labels.map((text) => [text.value, text.y])).toEqual([
      ["0.0 ms", 92.5],
      ["5.0 ms", 77.5],
      ["10.0 ms", 62.5],
      ["15.0 ms", 47.5],
      ["20.0 ms", 32.5],
    ]);
    expect(labels[0].x).toBe(50);
    expect(all.at(-1)).toEqual(["restore"]);
  });

  it("labels the time axis from the log's start at round steps", () => {
    const { canvas, texts } = recordingCanvas(WIDTH, HEIGHT);
    // Window 10 s long, 232 px wide: 5 s steps keep ticks 116 px apart. The window starts
    // 2 s into the log, so the 0:05 tick (log time 6000) is 30% of the way across.
    drawChart(canvas.ctx, [], metric("frame"), view({ window: { from: 3000, to: 13_000 } }));
    const ticks = texts.filter((text) => text.textAlign === "center");
    expect(ticks.map((text) => text.value)).toEqual(["0:05", "0:10"]);
    expect(ticks.map((text) => text.x)).toEqual([
      Math.round(56 + 0.3 * 232) + 0.5,
      Math.round(56 + 0.8 * 232) + 0.5,
    ]);
    expect(ticks[0].y).toBe(98);
  });

  it("draws a min-max band and a mean line per column, joined across empty columns", () => {
    const { canvas, calls: all } = recordingCanvas(WIDTH, HEIGHT);
    // Two rows in the first column (t=1000, 1001), one in the last (t=11000).
    const rows = [row(1000, 10), row(1001, 20), row(11_000, 5)];
    drawChart(canvas.ctx, rows, metric("frame"), view());
    const bands = calls("fillRect", all).filter((call) => call[1] === "rgba(96, 165, 250, 0.35)");
    expect(bands).toEqual([
      ["fillRect", "rgba(96, 165, 250, 0.35)", 56, 32, 1, 30], // 20 ms at the top, 10 ms mid
      ["fillRect", "rgba(96, 165, 250, 0.35)", 56 + 231, 77, 1, 1], // a single 5 ms sample
    ]);
    const lines = calls("stroke", all).filter((call) => call[1] === metric("frame").color);
    expect(lines).toHaveLength(1);
    const lineIndex = all.indexOf(lines[0]);
    expect(all.slice(lineIndex - 2, lineIndex)).toEqual([
      ["moveTo", 56.5, 47], // mean 15 ms
      ["lineTo", 56 + 231 + 0.5, 77],
    ]);
  });

  it("draws the reference line dashed when it is within the scale", () => {
    const { canvas, calls: all } = recordingCanvas(WIDTH, HEIGHT);
    drawChart(canvas.ctx, [], metric("frame"), view({ maxValue: 20 }));
    const reference = calls("stroke", all).filter((call) => call[1] === CHART_COLORS.reference);
    expect(reference).toHaveLength(1);
    const index = all.indexOf(reference[0]);
    // 16.67 of 20 -> 50 px up from the bottom of a 60 px plot, on the half pixel.
    expect(all.slice(index - 4, index)).toEqual([
      ["setLineDash", [4, 4]],
      ["beginPath"],
      ["moveTo", 56, 42.5],
      ["lineTo", 288, 42.5],
    ]);

    const { canvas: small, calls: few } = recordingCanvas(WIDTH, HEIGHT);
    drawChart(small.ctx, [], metric("frame"), view({ maxValue: 10 }));
    expect(calls("stroke", few).some((call) => call[1] === CHART_COLORS.reference)).toBe(false);
  });

  it("marks scene changes inside the window with a line and the scene's name", () => {
    const { canvas, calls: all, texts } = recordingCanvas(WIDTH, HEIGHT);
    const sceneChanges = [
      { time: 500, scene: "before" },
      { time: 6000, scene: "play" },
      { time: 12_000, scene: "after" },
    ];
    drawChart(canvas.ctx, [], metric("frame"), view({ sceneChanges }));
    const marks = calls("stroke", all).filter((call) => call[1] === CHART_COLORS.scene);
    expect(marks).toHaveLength(1);
    const index = all.indexOf(marks[0]);
    expect(all.slice(index - 2, index)).toEqual([
      ["moveTo", 172.5, 32],
      ["lineTo", 172.5, 92],
    ]);
    const label = texts.find((text) => text.value === "play");
    expect(label).toMatchObject({ x: 175.5, y: 17, textAlign: "left", textBaseline: "bottom" });
    expect(texts.map((text) => text.value)).not.toContain("before");
    expect(texts.map((text) => text.value)).not.toContain("after");
  });

  it("copes with a zero scale and rows without the value", () => {
    const { canvas, calls: all } = recordingCanvas(WIDTH, HEIGHT);
    expect(() =>
      drawChart(canvas.ctx, [row(1000, 16)], metric("heap"), view({ maxValue: 0 })),
    ).not.toThrow();
    const heapBand = "rgba(251, 146, 60, 0.35)";
    expect(calls("fillRect", all).filter((call) => call[1] === heapBand)).toEqual([]);
  });

  it("marks frames with key presses; markers close together share a label", () => {
    const { canvas, calls: all, texts } = recordingCanvas(WIDTH, HEIGHT);
    const rows = [
      row(1000, 16, "play", null, ["KeyA"]),
      row(1001, 16, "play", null, ["Space"]), // same column as the first
      row(1200, 16, "play", null, ["KeyD"]), // 4.6 px on: its own line, the first label
      row(6000, 16, "play", null, ["Enter"]),
      row(8000, 16),
    ];
    drawChart(canvas.ctx, rows, metric("frame"), view());
    const lines = calls("stroke", all).filter((call) => call[1] === CHART_COLORS.input);
    expect(lines).toHaveLength(3);
    const first = all.indexOf(lines[0]);
    expect(all.slice(first - 2, first)).toEqual([
      ["moveTo", 56.5, 32],
      ["lineTo", 56.5, 92],
    ]);
    const labels = texts.filter((text) => text.fillStyle === CHART_COLORS.input);
    expect(labels.map((text) => [text.value, text.x, text.y])).toEqual([
      ["KeyA Space KeyD", 59.5, 29],
      ["Enter", 172.5 + 3, 29],
    ]);
  });

  it("can leave the key presses out", () => {
    const { canvas, calls: all, texts } = recordingCanvas(WIDTH, HEIGHT);
    const rows = [row(1000, 16, "play", null, ["KeyA"])];
    drawChart(canvas.ctx, rows, metric("frame"), view({ showInputs: false }));
    expect(calls("stroke", all).some((call) => call[1] === CHART_COLORS.input)).toBe(false);
    expect(texts.map((text) => text.value)).not.toContain("KeyA");
  });
});

describe("inputMarkers", () => {
  it("groups presses by pixel column and skips frames without any", () => {
    const rows = [
      row(0, 16, "play", null, ["KeyA"]),
      row(1, 16, "play", null, ["KeyB", "KeyC"]),
      row(5, 16),
      row(9, 16, "play", null, ["KeyD"]),
    ];
    expect(inputMarkers(rows, { from: 0, to: 10 }, 2)).toEqual([
      { column: 0, label: "KeyA KeyB KeyC" },
      { column: 1, label: "KeyD" },
    ]);
    expect(inputMarkers(rows, { from: 0, to: 0 }, 2)).toEqual([]);
  });
});
