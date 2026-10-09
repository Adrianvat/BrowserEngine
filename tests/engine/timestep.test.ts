import { describe, it, expect } from "vitest";
import { advance, FIXED_STEP, MAX_FRAME_TIME } from "../../src/engine/core/timestep";

describe("advance", () => {
  it("uses 60 Hz steps and a 250 ms clamp by default", () => {
    expect(FIXED_STEP).toBe(1 / 60);
    expect(MAX_FRAME_TIME).toBe(0.25);
  });

  it("runs no step when less than one step of time has built up", () => {
    expect(advance(0, 0.0625, 0.125)).toEqual({ steps: 0, accumulator: 0.0625 });
  });

  it("runs exactly one step at the boundary", () => {
    expect(advance(0, 0.125, 0.125)).toEqual({ steps: 1, accumulator: 0 });
  });

  it("carries leftover time into the next frame", () => {
    expect(advance(0.0625, 0.125, 0.125)).toEqual({ steps: 1, accumulator: 0.0625 });
  });

  it("runs several steps after a long frame", () => {
    expect(advance(0, 0.375, 0.125, 1)).toEqual({ steps: 3, accumulator: 0 });
  });

  it("clamps huge elapsed time (e.g. a backgrounded tab)", () => {
    expect(advance(0, 5, 0.125, 0.25)).toEqual({ steps: 2, accumulator: 0 });
  });

  it("ignores negative elapsed time", () => {
    expect(advance(0.0625, -1, 0.125)).toEqual({ steps: 0, accumulator: 0.0625 });
  });
});
