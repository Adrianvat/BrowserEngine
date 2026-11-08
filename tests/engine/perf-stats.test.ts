import { afterEach, describe, expect, it, vi } from "vitest";
import { Series } from "../../src/engine/perf/series";
import {
  FPS_WINDOW,
  HISTORY,
  PerfStats,
  readHeapBytes,
  type FrameSample,
} from "../../src/engine/perf/stats";

function values(series: Series): number[] {
  const out: number[] = [];
  for (let i = 0; i < series.length; i++) out.push(series.at(i));
  return out;
}

describe("Series", () => {
  it("starts empty with zero readings", () => {
    const series = new Series(3);
    expect(series.length).toBe(0);
    expect(series.last).toBe(0);
    expect(series.average).toBe(0);
    expect(series.max).toBe(0);
    expect(values(series)).toEqual([]);
  });

  it("keeps values oldest first", () => {
    const series = new Series(3);
    series.push(1);
    series.push(2);
    expect(values(series)).toEqual([1, 2]);
    expect(series.length).toBe(2);
    expect(series.last).toBe(2);
  });

  it("drops the oldest value once full", () => {
    const series = new Series(3);
    for (const value of [1, 2, 3, 4, 5]) series.push(value);
    expect(series.length).toBe(3);
    expect(values(series)).toEqual([3, 4, 5]);
    expect(series.last).toBe(5);
  });

  it("averages and maxes over the kept values only", () => {
    const series = new Series(3);
    for (const value of [100, 2, 4, 6]) series.push(value);
    expect(series.average).toBe(4);
    expect(series.max).toBe(6);
  });

  it("max is the real maximum, even of negative values", () => {
    const series = new Series(2);
    series.push(-3);
    series.push(-1);
    expect(series.max).toBe(-1);
  });

  it("at() rejects indices outside the kept values", () => {
    const series = new Series(2);
    series.push(1);
    expect(() => series.at(1)).toThrow(RangeError);
    expect(() => series.at(-1)).toThrow(RangeError);
  });

  it("clear forgets everything", () => {
    const series = new Series(2);
    series.push(1);
    series.clear();
    expect(series.length).toBe(0);
    expect(series.last).toBe(0);
    series.push(7);
    expect(values(series)).toEqual([7]);
  });

  it("rejects a capacity that is not a positive integer", () => {
    expect(() => new Series(0)).toThrow("positive integer");
    expect(() => new Series(1.5)).toThrow("positive integer");
  });
});

function sample(overrides: Partial<FrameSample> = {}): FrameSample {
  return {
    time: 1000,
    scene: "main",
    frame: 16,
    update: 1,
    render: 2,
    steps: 1,
    entities: 5,
    heapBytes: null,
    inputs: [],
    ...overrides,
  };
}

describe("PerfStats", () => {
  it("keeps three seconds of 60 fps history", () => {
    expect(HISTORY).toBe(180);
    expect(new PerfStats().frameTime.capacity).toBe(HISTORY);
  });

  it("records each frame's figures", () => {
    const stats = new PerfStats();
    stats.record(sample({ frame: 10, update: 1, render: 2, steps: 2, entities: 7, heapBytes: 50 }));
    stats.record(sample({ frame: 20, update: 3, render: 4, steps: 1, entities: 8, heapBytes: 60 }));
    expect(values(stats.frameTime)).toEqual([10, 20]);
    expect(values(stats.updateTime)).toEqual([1, 3]);
    expect(values(stats.renderTime)).toEqual([2, 4]);
    expect(stats.steps).toBe(1);
    expect(stats.entities).toBe(8);
    expect(stats.heapBytes).toBe(60);
    expect(stats.frames).toBe(2);
  });

  it("has no FPS reading until half a second has passed", () => {
    const stats = new PerfStats();
    for (let i = 0; i < 10; i++) stats.record(sample({ frame: 16 }));
    expect(stats.fps).toBe(0);
  });

  it("reads the FPS from the frames in each half-second window", () => {
    const stats = new PerfStats();
    // 25 frames of 20 ms = 500 ms: the window closes on the 25th.
    for (let i = 0; i < 24; i++) stats.record(sample({ frame: 20 }));
    expect(stats.fps).toBe(0);
    stats.record(sample({ frame: 20 }));
    expect(stats.fps).toBe(50);
    expect(FPS_WINDOW).toBe(500);
  });

  it("keeps the last reading while the next window fills up, then replaces it", () => {
    const stats = new PerfStats();
    for (let i = 0; i < 25; i++) stats.record(sample({ frame: 20 }));
    expect(stats.fps).toBe(50);
    for (let i = 0; i < 10; i++) stats.record(sample({ frame: 40 }));
    expect(stats.fps).toBe(50);
    for (let i = 0; i < 3; i++) stats.record(sample({ frame: 40 }));
    expect(stats.fps).toBe(25);
  });

  it("a single long frame closes a window on its own", () => {
    const stats = new PerfStats();
    stats.record(sample({ frame: 2000 }));
    expect(stats.fps).toBe(1); // 0.5 rounds up
  });

  it("reset forgets everything", () => {
    const stats = new PerfStats();
    for (let i = 0; i < 30; i++) stats.record(sample({ frame: 20, heapBytes: 10 }));
    stats.reset();
    expect(stats.fps).toBe(0);
    expect(stats.frames).toBe(0);
    expect(stats.frameTime.length).toBe(0);
    expect(stats.updateTime.length).toBe(0);
    expect(stats.renderTime.length).toBe(0);
    expect(stats.steps).toBe(0);
    expect(stats.entities).toBe(0);
    expect(stats.heapBytes).toBeNull();
    // The FPS window starts over too.
    for (let i = 0; i < 24; i++) stats.record(sample({ frame: 20 }));
    expect(stats.fps).toBe(0);
  });
});

describe("readHeapBytes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads Chromium's performance.memory", () => {
    vi.stubGlobal("performance", { now: () => 0, memory: { usedJSHeapSize: 12345 } });
    expect(readHeapBytes()).toBe(12345);
  });

  it("is null where the browser does not report it", () => {
    vi.stubGlobal("performance", { now: () => 0 });
    expect(readHeapBytes()).toBeNull();
    vi.stubGlobal("performance", { now: () => 0, memory: {} });
    expect(readHeapBytes()).toBeNull();
  });
});
