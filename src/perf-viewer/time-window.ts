import type { LogRow } from "./log-file";

export interface TimeRange {
  label: string;
  /** Length in ms, or null for the whole log. */
  ms: number | null;
}

/** The ranges the page offers, in the order shown. */
export const TIME_RANGES: readonly TimeRange[] = [
  { label: "1 minute", ms: 60_000 },
  { label: "10 minutes", ms: 600_000 },
  { label: "1 hour", ms: 3_600_000 },
  { label: "All data", ms: null },
];

/** Shown when a log is shorter than a second, so the axis still has a width. */
const MIN_WINDOW_MS = 1000;

/** The stretch of the log the charts show, in log time (ms). */
export interface TimeWindow {
  from: number;
  to: number;
}

/**
 * Picks the window of `range` ms ending `offset` of the way through the log
 * (0: at the start, 1: at the end). A range that covers the log, or null, gives the whole log.
 */
export function selectWindow(
  log: { start: number; end: number },
  range: number | null,
  offset: number,
): TimeWindow {
  const duration = Math.max(log.end - log.start, MIN_WINDOW_MS);
  if (range === null || range >= duration) return { from: log.start, to: log.start + duration };
  const clamped = Math.min(Math.max(offset, 0), 1);
  const from = log.start + (duration - range) * clamped;
  return { from, to: from + range };
}

/** True when the log is longer than the range, so the window can be moved along it. */
export function canScroll(log: { start: number; end: number }, range: number | null): boolean {
  return range !== null && log.end - log.start > range;
}

/** Index of the first row at or after `time` (rows are in time order). */
function firstAtOrAfter(rows: LogRow[], time: number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (rows[mid].time < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** The rows whose time is within the window (inclusive of both ends). */
export function rowsInWindow(rows: LogRow[], window: TimeWindow): LogRow[] {
  const start = firstAtOrAfter(rows, window.from);
  let end = firstAtOrAfter(rows, window.to);
  while (end < rows.length && rows[end].time === window.to) end++;
  return rows.slice(start, end);
}

/** Milliseconds as "m:ss" or "h:mm:ss". */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value: number) => String(value).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${minutes}:${pad(seconds)}`;
}
