import type { LogRow, PerfLogData } from "./log-file";
import type { ValueOf } from "./series";

/** One value of the log, as a chart shows it. */
export interface Metric {
  id: string;
  label: string;
  unit: string;
  color: string;
  value: ValueOf;
  /** Digits after the decimal point in labels. */
  decimals: number;
  /** A horizontal guide line, e.g. one 60 Hz frame for the timings. Drawn when in range. */
  reference?: number;
  /** The value axis reaches at least this high, so normal readings sit at a steady scale. */
  minScale?: number;
  /** Whether the log has this value at all. */
  available?: (log: PerfLogData) => boolean;
}

/** One frame's worth of time at 60 Hz, in ms. */
const FRAME_BUDGET_MS = 1000 / 60;

const MB = 1024 * 1024;

export const METRICS: readonly Metric[] = [
  {
    id: "frame",
    label: "Frame time",
    unit: "ms",
    color: "#60a5fa",
    value: (row: LogRow) => row.frameMs,
    decimals: 1,
    reference: FRAME_BUDGET_MS,
    minScale: FRAME_BUDGET_MS,
  },
  {
    id: "update",
    label: "Update time",
    unit: "ms",
    color: "#34d399",
    value: (row: LogRow) => row.updateMs,
    decimals: 2,
    reference: FRAME_BUDGET_MS,
  },
  {
    id: "render",
    label: "Render time",
    unit: "ms",
    color: "#fbbf24",
    value: (row: LogRow) => row.renderMs,
    decimals: 2,
    reference: FRAME_BUDGET_MS,
  },
  {
    id: "fps",
    label: "FPS",
    unit: "fps",
    color: "#4ade80",
    value: (row: LogRow) => row.fps,
    decimals: 0,
    reference: 60,
    minScale: 60,
  },
  {
    id: "steps",
    label: "Update steps per frame",
    unit: "",
    color: "#c084fc",
    value: (row: LogRow) => row.steps,
    decimals: 0,
  },
  {
    id: "entities",
    label: "Entities",
    unit: "",
    color: "#f472b6",
    value: (row: LogRow) => row.entities,
    decimals: 0,
  },
  {
    id: "heap",
    label: "JS heap",
    unit: "MB",
    color: "#fb923c",
    value: (row: LogRow) => (row.heapBytes === null ? null : row.heapBytes / MB),
    decimals: 1,
    available: (log) => log.hasHeap,
  },
];

/** A value with its unit, e.g. "16.7 ms" or "12". */
export function formatValue(metric: Metric, value: number): string {
  const text = value.toFixed(metric.decimals);
  return metric.unit === "" ? text : `${text} ${metric.unit}`;
}
