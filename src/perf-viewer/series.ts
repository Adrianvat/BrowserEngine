import type { LogRow } from "./log-file";
import type { TimeWindow } from "./time-window";

/** Reads one value from a row; null when the row has none (e.g. heap where not reported). */
export type ValueOf = (row: LogRow) => number | null;

/** The values of one pixel column of a chart. */
export interface Bucket {
  min: number;
  max: number;
  avg: number;
  count: number;
}

/**
 * Squeezes the rows into `columns` equal slices of the window: one bucket per column,
 * null where no row fell. Drawing min-max bands from these shows spikes a line would miss.
 */
export function bucketize(
  rows: LogRow[],
  value: ValueOf,
  window: TimeWindow,
  columns: number,
): (Bucket | null)[] {
  const buckets: (Bucket | null)[] = new Array<Bucket | null>(columns).fill(null);
  const span = window.to - window.from;
  if (columns <= 0 || span <= 0) return buckets;
  for (const row of rows) {
    const v = value(row);
    if (v === null) continue;
    const column = Math.min(columns - 1, Math.floor(((row.time - window.from) / span) * columns));
    if (column < 0) continue;
    const bucket = buckets[column];
    if (!bucket) {
      buckets[column] = { min: v, max: v, avg: v, count: 1 };
    } else {
      bucket.min = Math.min(bucket.min, v);
      bucket.max = Math.max(bucket.max, v);
      bucket.avg += (v - bucket.avg) / (bucket.count + 1);
      bucket.count++;
    }
  }
  return buckets;
}

export interface Summary {
  min: number;
  max: number;
  avg: number;
  count: number;
}

/** Min, max and mean of the value over the rows; null when no row has it. */
export function summarize(rows: LogRow[], value: ValueOf): Summary | null {
  let summary: Summary | null = null;
  for (const row of rows) {
    const v = value(row);
    if (v === null) continue;
    if (!summary) {
      summary = { min: v, max: v, avg: v, count: 1 };
    } else {
      summary.min = Math.min(summary.min, v);
      summary.max = Math.max(summary.max, v);
      summary.avg += (v - summary.avg) / (summary.count + 1);
      summary.count++;
    }
  }
  return summary;
}

/**
 * The top of a chart's scale: the smallest 1, 2 or 5 × 10^n (or 2.5 × 10^n) at or above
 * the value, so grid lines land on round numbers. At least 1.
 */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * power;
    if (candidate >= value) return candidate;
  }
  return 10 * power;
}

/** Tick spacings for the time axis, in ms, from a second to a day. */
const TIME_STEPS = [
  1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000,
  1_800_000, 3_600_000, 7_200_000, 10_800_000, 21_600_000, 43_200_000, 86_400_000,
];

/** The smallest round tick spacing that keeps ticks at least `minPixels` apart. */
export function timeStep(spanMs: number, widthPixels: number, minPixels = 80): number {
  for (const step of TIME_STEPS) {
    if ((step / spanMs) * widthPixels >= minPixels) return step;
  }
  return TIME_STEPS[TIME_STEPS.length - 1];
}
