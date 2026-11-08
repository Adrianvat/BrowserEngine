import { describe, expect, it } from "vitest";
import type { LogRow } from "../../src/perf-viewer/log-file";
import { bucketize, niceMax, summarize, timeStep } from "../../src/perf-viewer/series";

function row(time: number, frameMs: number, heapBytes: number | null = null): LogRow {
  return {
    frame: 0,
    time,
    scene: "",
    frameMs,
    updateMs: 0,
    renderMs: 0,
    steps: 1,
    entities: 0,
    heapBytes,
    fps: 60,
    inputs: [],
  };
}

const frameMs = (r: LogRow) => r.frameMs;
const heap = (r: LogRow) => r.heapBytes;

describe("bucketize", () => {
  it("puts each row in the column for its time and keeps min, max and mean", () => {
    const rows = [row(0, 10), row(1, 30), row(2, 20), row(5, 7), row(9, 1), row(10, 99)];
    const buckets = bucketize(rows, frameMs, { from: 0, to: 10 }, 2);
    expect(buckets[0]).toEqual({ min: 10, max: 30, avg: 20, count: 3 });
    // The window's end lands in the last column.
    expect(buckets[1]).toMatchObject({ min: 1, max: 99, count: 3 });
    expect(buckets[1]?.avg).toBeCloseTo((7 + 1 + 99) / 3);
  });

  it("leaves columns with no rows null, and skips rows without the value", () => {
    const rows = [row(0, 10, null), row(5, 20, 500), row(6, 20, 700)];
    expect(bucketize(rows, frameMs, { from: 0, to: 10 }, 4)).toEqual([
      { min: 10, max: 10, avg: 10, count: 1 },
      null,
      { min: 20, max: 20, avg: 20, count: 2 },
      null,
    ]);
    expect(bucketize(rows, heap, { from: 0, to: 10 }, 4)).toEqual([
      null,
      null,
      { min: 500, max: 700, avg: 600, count: 2 },
      null,
    ]);
  });

  it("ignores rows before the window and gives nothing for a degenerate window", () => {
    const rows = [row(-1, 10), row(1, 10)];
    expect(bucketize(rows, frameMs, { from: 0, to: 10 }, 2)).toEqual([
      { min: 10, max: 10, avg: 10, count: 1 },
      null,
    ]);
    expect(bucketize(rows, frameMs, { from: 0, to: 0 }, 2)).toEqual([null, null]);
    expect(bucketize(rows, frameMs, { from: 0, to: 10 }, 0)).toEqual([]);
  });
});

describe("summarize", () => {
  it("finds min, max and mean over the rows that have the value", () => {
    const rows = [row(0, 10, null), row(1, 30, 100), row(2, 20, 300)];
    expect(summarize(rows, frameMs)).toEqual({ min: 10, max: 30, avg: 20, count: 3 });
    expect(summarize(rows, heap)).toEqual({ min: 100, max: 300, avg: 200, count: 2 });
  });

  it("is null when no row has the value", () => {
    expect(summarize([], frameMs)).toBeNull();
    expect(summarize([row(0, 10, null)], heap)).toBeNull();
  });
});

describe("niceMax", () => {
  it("rounds up to 1, 2, 2.5, 5 or 10 times a power of ten", () => {
    expect(niceMax(0.7)).toBe(1);
    expect(niceMax(1)).toBe(1);
    expect(niceMax(1.3)).toBe(2);
    expect(niceMax(2.2)).toBe(2.5);
    expect(niceMax(4)).toBe(5);
    expect(niceMax(16.7)).toBe(20);
    expect(niceMax(33.4)).toBe(50);
    expect(niceMax(60)).toBe(100);
    expect(niceMax(250)).toBe(250);
    expect(niceMax(0.012)).toBeCloseTo(0.02);
  });

  it("is 1 for zero, negative or NaN", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
    expect(niceMax(NaN)).toBe(1);
  });
});

describe("timeStep", () => {
  it("picks the smallest round step that keeps ticks far enough apart", () => {
    expect(timeStep(60_000, 1000)).toBe(5_000); // 12 ticks, 83 px apart
    expect(timeStep(60_000, 300)).toBe(30_000);
    expect(timeStep(600_000, 1000)).toBe(60_000);
    expect(timeStep(3_600_000, 1000)).toBe(300_000);
    expect(timeStep(10_000, 1000, 50)).toBe(1_000);
  });

  it("tops out at a day", () => {
    expect(timeStep(30 * 86_400_000, 100)).toBe(86_400_000);
  });
});
