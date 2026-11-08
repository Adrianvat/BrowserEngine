import { describe, expect, it } from "vitest";
import { formatFrames, parseFrames } from "../../src/editor/frames-text";

describe("parseFrames", () => {
  it("reads integers separated by commas and/or spaces", () => {
    expect(parseFrames("2, 3, 4, 5")).toEqual([2, 3, 4, 5]);
    expect(parseFrames("2 3,4 ,, 5 ")).toEqual([2, 3, 4, 5]);
    expect(parseFrames("7")).toEqual([7]);
  });

  it("keeps negatives so the range check can name them", () => {
    expect(parseFrames("-1, 2")).toEqual([-1, 2]);
  });

  it("gives an empty list for empty text", () => {
    expect(parseFrames("  ")).toEqual([]);
  });

  it("gives null when a part is not a whole number", () => {
    expect(parseFrames("1, two")).toBeNull();
    expect(parseFrames("1.5")).toBeNull();
    expect(parseFrames("1e2")).toBeNull();
  });
});

describe("formatFrames", () => {
  it("joins with comma and space", () => {
    expect(formatFrames([2, 3, 4])).toBe("2, 3, 4");
    expect(formatFrames([])).toBe("");
  });
});
