import { describe, expect, it } from "vitest";
import { PALETTE, parseHex, sameColor, toHex } from "../../src/sprite-editor/color";

describe("parseHex and toHex", () => {
  it("reads #rrggbb as an opaque color and writes it back", () => {
    expect(parseHex("#ff8000")).toEqual([255, 128, 0, 255]);
    expect(parseHex("FF8000")).toEqual([255, 128, 0, 255]);
    expect(parseHex(" #0a0b0c ")).toEqual([10, 11, 12, 255]);
    expect(toHex([255, 128, 0, 255])).toBe("#ff8000");
    expect(toHex([1, 2, 3, 0])).toBe("#010203");
  });

  it("rejects anything that isn't six hex digits", () => {
    expect(parseHex("#fff")).toBeNull();
    expect(parseHex("red")).toBeNull();
    expect(parseHex("#12345g")).toBeNull();
    expect(parseHex("")).toBeNull();
  });

  it("has a palette of valid colors", () => {
    expect(PALETTE.length).toBeGreaterThan(0);
    for (const hex of PALETTE) expect(toHex(parseHex(hex)!)).toBe(hex);
  });
});

describe("sameColor", () => {
  it("compares every channel, alpha included", () => {
    expect(sameColor([1, 2, 3, 4], [1, 2, 3, 4])).toBe(true);
    expect(sameColor([1, 2, 3, 4], [1, 2, 3, 5])).toBe(false);
    expect(sameColor([0, 0, 0, 0], [9, 9, 9, 0])).toBe(false);
  });
});
