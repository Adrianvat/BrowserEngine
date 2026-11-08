import { describe, it, expect } from "vitest";
import { boxRound, roundOf, roundRound, type Hit } from "../../src/engine/physics/shapes";

/** A hit with its normal rounded, so expectations can use plain numbers. */
function rounded(hit: Hit | null) {
  if (!hit) return null;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return { nx: round(hit.nx), ny: round(hit.ny), depth: round(hit.depth) };
}

describe("roundOf", () => {
  it("makes a circle from the box's shorter side, centered", () => {
    expect(roundOf({ x: 10, y: 20, width: 30, height: 40 }, "circle")).toEqual({
      x1: 25,
      y1: 40,
      x2: 25,
      y2: 40,
      r: 15,
    });
  });

  it("runs a capsule along the box's longer side, between the centers of its caps", () => {
    expect(roundOf({ x: 0, y: 0, width: 20, height: 60 }, "capsule")).toEqual({
      x1: 10,
      y1: 10,
      x2: 10,
      y2: 50,
      r: 10,
    });
    expect(roundOf({ x: 0, y: 0, width: 60, height: 20 }, "capsule")).toEqual({
      x1: 10,
      y1: 10,
      x2: 50,
      y2: 10,
      r: 10,
    });
  });

  it("makes a capsule with equal sides a circle", () => {
    expect(roundOf({ x: 0, y: 0, width: 20, height: 20 }, "capsule")).toEqual(
      roundOf({ x: 0, y: 0, width: 20, height: 20 }, "circle"),
    );
  });
});

describe("roundRound", () => {
  const circle = (cx: number, cy: number, r: number) => ({ x1: cx, y1: cy, x2: cx, y2: cy, r });

  it("pushes two circles apart along the line between their centers", () => {
    expect(rounded(roundRound(circle(0, 0, 10), circle(16, 0, 10)))).toEqual({
      nx: 1,
      ny: 0,
      depth: 4,
    });
    expect(rounded(roundRound(circle(0, 0, 10), circle(9, 12, 10)))).toEqual({
      nx: 0.6,
      ny: 0.8,
      depth: 5,
    });
  });

  it("reports nothing for circles that touch or are apart", () => {
    expect(roundRound(circle(0, 0, 10), circle(20, 0, 10))).toBeNull();
    expect(roundRound(circle(0, 0, 10), circle(30, 0, 10))).toBeNull();
  });

  it("pushes concentric circles down, lacking any better direction", () => {
    expect(roundRound(circle(5, 5, 10), circle(5, 5, 4))).toEqual({ nx: 0, ny: 1, depth: 14 });
  });

  it("measures a capsule from the nearest point of its segment", () => {
    const capsule = { x1: 0, y1: 0, x2: 0, y2: 100, r: 10 };
    expect(rounded(roundRound(capsule, circle(15, 50, 10)))).toEqual({ nx: 1, ny: 0, depth: 5 });
    expect(rounded(roundRound(capsule, circle(0, -15, 10)))).toEqual({ nx: 0, ny: -1, depth: 5 });
    expect(roundRound(capsule, circle(25, 50, 10))).toBeNull();
  });

  it("handles two capsules, parallel or crossing", () => {
    const left = { x1: 0, y1: 0, x2: 0, y2: 100, r: 10 };
    const right = { x1: 15, y1: 20, x2: 15, y2: 120, r: 10 };
    expect(rounded(roundRound(left, right))).toEqual({ nx: 1, ny: 0, depth: 5 });
    const across = { x1: -50, y1: 50, x2: 50, y2: 50, r: 10 };
    expect(rounded(roundRound(left, across))).toEqual({ nx: 0, ny: 1, depth: 20 });
  });
});

describe("boxRound", () => {
  const box = { x: 0, y: 100, width: 100, height: 20 };
  const circle = (cx: number, cy: number, r: number) => ({ x1: cx, y1: cy, x2: cx, y2: cy, r });

  it("pushes a circle straight off a face", () => {
    expect(rounded(boxRound(box, circle(50, 93, 10)))).toEqual({ nx: 0, ny: -1, depth: 3 });
    expect(rounded(boxRound(box, circle(-8, 110, 10)))).toEqual({ nx: -1, ny: 0, depth: 2 });
  });

  it("pushes a circle diagonally off a corner", () => {
    // 6 px right of and 8 px above the corner: 10 px away, 5 px in.
    expect(rounded(boxRound(box, circle(106, 92, 15)))).toEqual({ nx: 0.6, ny: -0.8, depth: 5 });
  });

  it("reports nothing for a circle that touches or is apart", () => {
    expect(boxRound(box, circle(50, 90, 10))).toBeNull();
    expect(boxRound(box, circle(50, 50, 10))).toBeNull();
    expect(boxRound(box, circle(108, 92, 10))).toBeNull();
  });

  it("pushes a circle whose center is inside out through the nearest face", () => {
    expect(boxRound(box, circle(50, 103, 10))).toEqual({ nx: 0, ny: -1, depth: 13 });
    expect(boxRound(box, circle(2, 110, 10))).toEqual({ nx: -1, ny: 0, depth: 12 });
  });

  it("pushes a capsule whose segment is inside far enough to clear its whole length", () => {
    // Standing in the 20 px tall box: its bottom cap is 19 px below the top face.
    const standing = { x1: 50, y1: 104, x2: 50, y2: 116, r: 3 };
    expect(boxRound(box, standing)).toEqual({ nx: 0, ny: -1, depth: 19 });
    // Lying along the box: out through the top, not along its 70 px length.
    const lying = { x1: 10, y1: 110, x2: 70, y2: 110, r: 5 };
    expect(boxRound(box, lying)).toEqual({ nx: 0, ny: -1, depth: 15 });
  });

  it("measures a capsule from the point of its segment nearest the box", () => {
    const standing = { x1: 50, y1: 60, x2: 50, y2: 95, r: 10 }; // bottom cap 5 px into the top
    expect(rounded(boxRound(box, standing))).toEqual({ nx: 0, ny: -1, depth: 5 });
    const lying = { x1: 20, y1: 94, x2: 80, y2: 94, r: 10 };
    expect(rounded(boxRound(box, lying))).toEqual({ nx: 0, ny: -1, depth: 4 });
    const beside = { x1: -8, y1: 0, x2: -8, y2: 200, r: 10 };
    expect(rounded(boxRound(box, beside))).toEqual({ nx: -1, ny: 0, depth: 2 });
  });
});
