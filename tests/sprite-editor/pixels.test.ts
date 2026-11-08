import { describe, expect, it } from "vitest";
import { TRANSPARENT, type Rgba } from "../../src/sprite-editor/color";
import {
  checkSize,
  clampRect,
  linePoints,
  MAX_SIZE,
  Pixels,
  rectBetween,
  rectContains,
} from "../../src/sprite-editor/pixels";

const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];

/** The sprite as text: "." for transparent, "R" red, "B" blue, "?" anything else. */
function picture(pixels: Pixels): string[] {
  const rows: string[] = [];
  for (let y = 0; y < pixels.height; y++) {
    let row = "";
    for (let x = 0; x < pixels.width; x++) {
      const color = pixels.get(x, y);
      if (color[3] === 0) row += ".";
      else if (color[0] === 255 && color[2] === 0) row += "R";
      else if (color[2] === 255 && color[0] === 0) row += "B";
      else row += "?";
    }
    rows.push(row);
  }
  return rows;
}

describe("Pixels", () => {
  it("starts transparent and reports whether a set changed anything", () => {
    const pixels = new Pixels(3, 2);
    expect(pixels.isBlank()).toBe(true);
    expect(pixels.get(1, 1)).toEqual(TRANSPARENT);
    expect(pixels.set(1, 1, RED)).toBe(true);
    expect(pixels.set(1, 1, RED)).toBe(false);
    expect(pixels.get(1, 1)).toEqual(RED);
    expect(pixels.isBlank()).toBe(false);
    expect(picture(pixels)).toEqual(["...", ".R."]);
  });

  it("ignores pixels outside the sprite", () => {
    const pixels = new Pixels(2, 2);
    expect(pixels.set(2, 0, RED)).toBe(false);
    expect(pixels.set(-1, 0, RED)).toBe(false);
    expect(pixels.set(0.5, 0, RED)).toBe(false);
    expect(pixels.get(5, 5)).toEqual(TRANSPARENT);
    expect(pixels.isBlank()).toBe(true);
  });

  it("rejects sizes the editor can't handle", () => {
    expect(() => new Pixels(0, 4)).toThrow("at least 1");
    expect(() => new Pixels(4, 2.5)).toThrow("whole numbers");
    expect(() => new Pixels(MAX_SIZE + 1, 4)).toThrow(`at most ${MAX_SIZE}`);
    expect(() => checkSize(NaN, 4)).toThrow("whole numbers");
    expect(() => new Pixels(2, 2, new Uint8ClampedArray(3))).toThrow("Expected 16 bytes");
  });

  it("clones without sharing pixels, and compares by content", () => {
    const pixels = new Pixels(2, 1);
    pixels.set(0, 0, RED);
    const copy = pixels.clone();
    expect(copy.equals(pixels)).toBe(true);
    copy.set(1, 0, BLUE);
    expect(pixels.get(1, 0)).toEqual(TRANSPARENT);
    expect(copy.equals(pixels)).toBe(false);
    expect(new Pixels(1, 2).equals(new Pixels(2, 1))).toBe(false);
  });

  it("stamps a square centered on the point, even sizes leaning down and right", () => {
    const one = new Pixels(5, 5);
    one.stamp(2, 2, 1, RED);
    expect(picture(one)).toEqual([".....", ".....", "..R..", ".....", "....."]);
    const two = new Pixels(5, 5);
    two.stamp(2, 2, 2, RED);
    expect(picture(two)).toEqual([".....", ".....", "..RR.", "..RR.", "....."]);
    const three = new Pixels(5, 5);
    three.stamp(2, 2, 3, RED);
    expect(picture(three)).toEqual([".....", ".RRR.", ".RRR.", ".RRR.", "....."]);
  });

  it("stamps partly outside the sprite, keeping what fits", () => {
    const pixels = new Pixels(3, 3);
    expect(pixels.stamp(0, 0, 3, RED)).toBe(true);
    expect(picture(pixels)).toEqual(["RR.", "RR.", "..."]);
    expect(pixels.stamp(-5, -5, 3, RED)).toBe(false);
  });

  it("draws a gap-free line between two points", () => {
    const pixels = new Pixels(5, 3);
    expect(pixels.line(0, 0, 4, 2, 1, RED)).toBe(true);
    expect(picture(pixels)).toEqual(["R....", ".RR..", "...RR"]);
    // The same line again changes nothing.
    expect(pixels.line(0, 0, 4, 2, 1, RED)).toBe(false);
  });

  it("erases with a transparent color", () => {
    const pixels = new Pixels(3, 1);
    pixels.line(0, 0, 2, 0, 1, RED);
    expect(pixels.stamp(1, 0, 1, TRANSPARENT)).toBe(true);
    expect(picture(pixels)).toEqual(["R.R"]);
  });

  it("fills the connected region of one color, through sides only", () => {
    const pixels = new Pixels(4, 3);
    // A red diagonal wall; the corners touch only diagonally.
    pixels.set(1, 0, RED);
    pixels.set(2, 1, RED);
    pixels.set(3, 2, RED);
    expect(pixels.fill(0, 0, BLUE)).toBe(true);
    expect(picture(pixels)).toEqual(["BR..", "BBR.", "BBBR"]);
    expect(pixels.fill(3, 0, BLUE)).toBe(true);
    expect(picture(pixels)).toEqual(["BRBB", "BBRB", "BBBR"]);
  });

  it("recolors a wall with fill and does nothing for a pixel already that color or outside", () => {
    const pixels = new Pixels(3, 1);
    pixels.set(1, 0, RED);
    expect(pixels.fill(1, 0, BLUE)).toBe(true);
    expect(picture(pixels)).toEqual([".B."]);
    expect(pixels.fill(1, 0, BLUE)).toBe(false);
    expect(pixels.fill(9, 0, BLUE)).toBe(false);
  });

  it("fills a whole blank sprite without blowing the stack", () => {
    const pixels = new Pixels(MAX_SIZE, MAX_SIZE);
    expect(pixels.fill(0, 0, RED)).toBe(true);
    expect(pixels.get(MAX_SIZE - 1, MAX_SIZE - 1)).toEqual(RED);
  });

  it("resizes anchored at the top-left, cropping or padding", () => {
    const pixels = new Pixels(3, 2);
    pixels.set(0, 0, RED);
    pixels.set(2, 1, BLUE);
    expect(picture(pixels.resized(2, 1))).toEqual(["R."]);
    expect(picture(pixels.resized(4, 3))).toEqual(["R...", "..B.", "...."]);
    expect(pixels.resized(3, 2).equals(pixels)).toBe(true);
  });
});

describe("Pixels regions", () => {
  it("copies a region, clears one, and draws one back with transparency showing through", () => {
    const pixels = new Pixels(4, 3);
    pixels.set(1, 1, RED);
    pixels.set(2, 1, BLUE);
    pixels.set(0, 0, BLUE);
    const region = pixels.region({ x: 1, y: 0, width: 2, height: 2 });
    expect(picture(region)).toEqual(["..", "RB"]);
    expect(pixels.clearRegion({ x: 1, y: 0, width: 2, height: 2 })).toBe(true);
    expect(picture(pixels)).toEqual(["B...", "....", "...."]);
    expect(pixels.clearRegion({ x: 1, y: 0, width: 2, height: 2 })).toBe(false);
    expect(pixels.draw(region, 2, 1)).toBe(true);
    expect(picture(pixels)).toEqual(["B...", "....", "..RB"]);
    // Drawn over other pixels, its transparent row leaves them alone.
    expect(pixels.draw(region, 2, 0)).toBe(true);
    expect(picture(pixels)).toEqual(["B...", "..RB", "..RB"]);
    // Drawn partly outside: only what fits lands (here its blue pixel, on the blue corner: no change).
    expect(pixels.draw(region, -1, -1)).toBe(false);
    expect(pixels.draw(region, -1, 1)).toBe(true);
    expect(picture(pixels)).toEqual(["B...", "..RB", "B.RB"]);
    expect(pixels.draw(region, 3, 2)).toBe(false);
    expect(pixels.clearRegion({ x: 10, y: 10, width: 2, height: 2 })).toBe(false);
  });

  it("finds the bounds of the opaque pixels", () => {
    const pixels = new Pixels(5, 4);
    expect(pixels.bounds()).toBeNull();
    pixels.set(3, 1, RED);
    expect(pixels.bounds()).toEqual({ x: 3, y: 1, width: 1, height: 1 });
    pixels.set(1, 3, BLUE);
    expect(pixels.bounds()).toEqual({ x: 1, y: 1, width: 3, height: 3 });
  });
});

describe("rectangles", () => {
  it("clamps to the sprite, or to nothing", () => {
    expect(clampRect({ x: -2, y: -1, width: 4, height: 3 }, 8, 8)).toEqual({ x: 0, y: 0, width: 2, height: 2 });
    expect(clampRect({ x: 6, y: 6, width: 4, height: 4 }, 8, 8)).toEqual({ x: 6, y: 6, width: 2, height: 2 });
    expect(clampRect({ x: 8, y: 0, width: 4, height: 4 }, 8, 8)).toBeNull();
    expect(clampRect({ x: -4, y: 0, width: 4, height: 4 }, 8, 8)).toBeNull();
  });

  it("spans two corner pixels in any order, and knows what it contains", () => {
    expect(rectBetween(3, 4, 1, 2)).toEqual({ x: 1, y: 2, width: 3, height: 3 });
    expect(rectBetween(2, 2, 2, 2)).toEqual({ x: 2, y: 2, width: 1, height: 1 });
    const rect = { x: 1, y: 2, width: 3, height: 3 };
    expect(rectContains(rect, 1, 2)).toBe(true);
    expect(rectContains(rect, 3, 4)).toBe(true);
    expect(rectContains(rect, 4, 4)).toBe(false);
    expect(rectContains(rect, 0, 2)).toBe(false);
  });
});

describe("linePoints", () => {
  it("includes both ends and steps one pixel at a time", () => {
    expect(linePoints(2, 2, 2, 2)).toEqual([[2, 2]]);
    expect(linePoints(0, 0, 3, 0)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(linePoints(0, 0, 0, -2)).toEqual([[0, 0], [0, -1], [0, -2]]);
    expect(linePoints(0, 0, 2, 2)).toEqual([[0, 0], [1, 1], [2, 2]]);
    const steep = linePoints(5, 9, 3, 0);
    expect(steep[0]).toEqual([5, 9]);
    expect(steep[steep.length - 1]).toEqual([3, 0]);
    expect(steep).toHaveLength(10);
  });
});
