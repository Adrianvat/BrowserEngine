import { describe, expect, it } from "vitest";
import type { LogRow } from "../../src/perf-viewer/log-file";
import {
  canScroll,
  formatTime,
  rowsInWindow,
  selectWindow,
  TIME_RANGES,
} from "../../src/perf-viewer/time-window";

function row(time: number): LogRow {
  return {
    frame: 0,
    time,
    scene: "",
    frameMs: 16,
    updateMs: 0,
    renderMs: 0,
    steps: 1,
    entities: 0,
    heapBytes: null,
    fps: 60,
    inputs: [],
  };
}

describe("TIME_RANGES", () => {
  it("offers a minute, ten minutes, an hour and everything", () => {
    expect(TIME_RANGES.map((range) => range.ms)).toEqual([60_000, 600_000, 3_600_000, null]);
  });
});

describe("selectWindow", () => {
  const log = { start: 5000, end: 5000 + 3_600_000 }; // an hour

  it("gives the whole log for 'all data' or a range at least as long as the log", () => {
    expect(selectWindow(log, null, 0.5)).toEqual({ from: 5000, to: 3_605_000 });
    expect(selectWindow(log, 3_600_000, 0.5)).toEqual({ from: 5000, to: 3_605_000 });
    expect(selectWindow(log, 7_200_000, 0)).toEqual({ from: 5000, to: 3_605_000 });
  });

  it("slides a shorter range along the log with the offset", () => {
    expect(selectWindow(log, 60_000, 0)).toEqual({ from: 5000, to: 65_000 });
    expect(selectWindow(log, 60_000, 1)).toEqual({ from: 3_545_000, to: 3_605_000 });
    expect(selectWindow(log, 60_000, 0.5)).toEqual({ from: 1_775_000, to: 1_835_000 });
  });

  it("clamps the offset", () => {
    expect(selectWindow(log, 60_000, -1)).toEqual(selectWindow(log, 60_000, 0));
    expect(selectWindow(log, 60_000, 2)).toEqual(selectWindow(log, 60_000, 1));
  });

  it("shows at least a second, so a tiny log still has an axis", () => {
    expect(selectWindow({ start: 100, end: 100 }, null, 1)).toEqual({ from: 100, to: 1100 });
    expect(selectWindow({ start: 100, end: 400 }, 60_000, 1)).toEqual({ from: 100, to: 1100 });
  });
});

describe("canScroll", () => {
  it("is true only when the log is longer than the range", () => {
    const log = { start: 0, end: 100_000 };
    expect(canScroll(log, 60_000)).toBe(true);
    expect(canScroll(log, 600_000)).toBe(false);
    expect(canScroll(log, 100_000)).toBe(false);
    expect(canScroll(log, null)).toBe(false);
  });
});

describe("rowsInWindow", () => {
  const rows = [10, 20, 30, 30, 40, 50].map(row);

  it("keeps the rows inside the window, both ends included", () => {
    expect(rowsInWindow(rows, { from: 20, to: 30 }).map((r) => r.time)).toEqual([20, 30, 30]);
    expect(rowsInWindow(rows, { from: 15, to: 45 }).map((r) => r.time)).toEqual([20, 30, 30, 40]);
  });

  it("handles windows beyond or around the rows", () => {
    expect(rowsInWindow(rows, { from: 0, to: 100 })).toHaveLength(6);
    expect(rowsInWindow(rows, { from: 60, to: 100 })).toEqual([]);
    expect(rowsInWindow(rows, { from: 0, to: 5 })).toEqual([]);
    expect(rowsInWindow([], { from: 0, to: 5 })).toEqual([]);
  });
});

describe("formatTime", () => {
  it("writes minutes and seconds, with hours when needed", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(65_000)).toBe("1:05");
    expect(formatTime(3_600_000)).toBe("1:00:00");
    expect(formatTime(3_725_400)).toBe("1:02:05");
    expect(formatTime(-5)).toBe("0:00");
  });
});
